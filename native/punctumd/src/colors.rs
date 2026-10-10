//! A colour shows a swatch and its HEX, RGB, HSL and OKLCH forms; Enter copies
//! one. A port of extensions/colors/provider.js, with csscolorparser reading
//! what the JS couldn't.
//!
//!   #ff6644 · #f64 · ff6644 · rgb(255, 102, 68) · hsl(11 100% 63%) · oklch(70% 0.19 40)
//!
//! What the JS reads, it reads the same way, by the same rules: six hex
//! digits without # count only when one is a digit and one a letter, so
//! words like "decade" or "facade" stay words. On top of that, any CSS
//! colour function (rgb() with percentages or decimals, hsl(), hwb(), lab(),
//! lch(), oklab(), oklch()) and #rgba / #rrggbbaa hex. Colour names stay out:
//! "red" and "tan" are words first. An OKLCH row follows the other three.
//!
//! Which forms are listed is the "formats" setting: hex, rgb, hsl and oklch
//! unless you say otherwise, and hsv, hwb, lab, lch, oklab, cmyk, vec4,
//! decimal and 0x too.
//!
//! Two colours "on" (or "vs") each other give their WCAG contrast ratio and
//! the levels it passes: `#fff on #333`, `contrast #777 #fff`.
//!
//! A colour also shows its contrast on white and on black ("contrast": false
//! leaves them out).
//!
//! "pick" finds the screen colour picker, PowerToys-style: Enter runs the
//! manifest's "pick" action (the `pick` script beside the manifest), which
//! runs hyprpicker, keeps the colour in a short history, and then does what
//! "afterPick" says: "copy" (in the "copyFormat" form), "show" (the bar
//! opens on it) or "copy+show". Shift+Enter does "afterPickAlt". "Pick two
//! colours for contrast" picks a text colour and a background and opens the
//! bar on their contrast. `pick ` lists the history (the manifest's "picks"
//! load) and copies it as the "exports" you keep: CSS or SCSS variables,
//! JSON, Tailwind colours, a GIMP palette.

use std::sync::LazyLock;

use regex::Regex;

use serde_json::{Value, json};

use crate::apps::{prefixes_all, words};
use crate::clipboard::ago;
use crate::format::js_round;
use crate::{Answer, Context, Extension, Row};

static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(#)?([a-f0-9]{6}|[a-f0-9]{3})$").unwrap());
static RGB: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^rgba?\(\s*([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})\s*(?:[,/]\s*[0-9.]+%?\s*)?\)$")
        .unwrap()
});
static HASH_ALPHA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^#([a-f0-9]{4}|[a-f0-9]{8})$").unwrap());
static PICK_MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)^\s*pick\s(.*)$").unwrap());
static CONTRAST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:contrast\s+(?:of\s+)?)?(.+?)\s+(?:on|vs\.?|versus|against)\s+(.+?)\s*$").unwrap()
});
static CONTRAST_PAIR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*contrast\s+(\S+)\s+(?:and\s+)?(\S+)\s*$").unwrap());
static FUNCTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(rgba?|hsla?|hwba?|lab|lch|oklab|oklch)\(.*\)$").unwrap());

fn from_hex(q: &str) -> Option<[u8; 3]> {
    let m = HEX.captures(q)?;
    let digits = &m[2];
    if m.get(1).is_none()
        && (digits.len() == 3
            || !digits.bytes().any(|b| b.is_ascii_digit())
            || !digits.bytes().any(|b| b.is_ascii_alphabetic()))
    {
        return None;
    }
    let full: String =
        if digits.len() == 6 { digits.to_string() } else { digits.chars().flat_map(|c| [c, c]).collect() };
    let byte = |i: usize| u8::from_str_radix(&full[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

fn from_rgb(q: &str) -> Option<[u8; 3]> {
    let m = RGB.captures(q)?;
    let c = |i: usize| m[i].parse::<u32>().ok().map(|n| n.min(255) as u8);
    Some([c(1)?, c(2)?, c(3)?])
}

/// Any CSS colour function or #rgba hex the JS doesn't read; never a name.
fn from_css(q: &str) -> Option<csscolorparser::Color> {
    if !(FUNCTION.is_match(q) || HASH_ALPHA.is_match(q)) {
        return None;
    }
    csscolorparser::parse(q).ok()
}

fn hex2(n: u8) -> String {
    format!("{n:02x}")
}

/// The JS's own HSL, from the 8-bit channels, rounded as Math.round does.
fn hsl(r: u8, g: u8, b: u8) -> String {
    let (rf, gf, bf) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let l = (max + min) / 2.0;
    let (mut h, mut s) = (0.0, 0.0);
    if max != min {
        let d = max - min;
        s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        h = if max == rf {
            (gf - bf) / d + if gf < bf { 6.0 } else { 0.0 }
        } else if max == gf {
            (bf - rf) / d + 2.0
        } else {
            (rf - gf) / d + 4.0
        };
        h /= 6.0;
    }
    format!("hsl({}, {}%, {}%)", js_round(h * 360.0), js_round(s * 100.0), js_round(l * 100.0))
}

/// "oklch(70.2% 0.187 41.6)": lightness as a percentage, chroma and hue in
/// degrees, as CSS writes them; a grey has no hue, so it says 0.
fn oklch(color: &csscolorparser::Color) -> String {
    let [l, c, h, _] = color.to_oklcha();
    let hue = if c < 0.0005 { 0.0 } else { (h.to_degrees() + 360.0) % 360.0 };
    let tidy = |s: String| {
        if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s }
    };
    format!("oklch({}% {} {})", tidy(format!("{:.1}", l * 100.0)), tidy(format!("{c:.3}")), tidy(format!("{hue:.1}")))
}

/// A string with its trailing zeros (and point) gone: "0.190" → "0.19".
fn tidy(s: String) -> String {
    if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s }
}

fn fixed(v: f64, places: usize) -> String {
    let t = tidy(format!("{v:.places$}"));
    if t == "-0" { "0".into() } else { t }
}

fn pct(v: f64) -> String {
    format!("{}%", js_round(v * 100.0))
}

/// A float for a shader: "1.0", "0.4", "0.267".
fn float(v: f64) -> String {
    let t = fixed(v, 3);
    if t.contains('.') { t } else { t + ".0" }
}

const DEFAULT_FORMATS: [&str; 4] = ["hex", "rgb", "hsl", "oklch"];

/// One form of the colour, by the name the "formats" setting uses.
fn form(name: &str, [r, g, b]: [u8; 3], color: &csscolorparser::Color) -> Option<(&'static str, String)> {
    let hue = |h: f32, chroma: f32| if chroma < 0.0005 { 0.0 } else { (h as f64 + 360.0) % 360.0 };
    Some(match name {
        "hex" => ("HEX", format!("#{}{}{}", hex2(r), hex2(g), hex2(b)).to_uppercase()),
        "rgb" => ("RGB", format!("rgb({r}, {g}, {b})")),
        "hsl" => ("HSL", hsl(r, g, b)),
        "oklch" => ("OKLCH", oklch(color)),
        "hsv" => {
            let [h, s, v, _] = csscolorparser::Color::from_rgba8(r, g, b, 255).to_hsva();
            (
                "HSV",
                format!(
                    "hsv({}, {}, {})",
                    js_round(if s == 0.0 { 0.0 } else { h as f64 }),
                    pct(s as f64),
                    pct(v as f64)
                ),
            )
        }
        "hwb" => {
            let [h, w, bl, _] = csscolorparser::Color::from_rgba8(r, g, b, 255).to_hwba();
            let h = if w + bl >= 1.0 { 0.0 } else { h as f64 };
            ("HWB", format!("hwb({} {} {})", js_round(h), pct(w as f64), pct(bl as f64)))
        }
        "lab" => {
            let [l, a, bb, _] = color.to_laba();
            ("LAB", format!("lab({}% {} {})", fixed(l as f64, 1), fixed(a as f64, 2), fixed(bb as f64, 2)))
        }
        "lch" => {
            let [l, c, h, _] = color.to_lcha();
            (
                "LCH",
                format!(
                    "lch({}% {} {})",
                    fixed(l as f64, 1),
                    fixed(c as f64, 2),
                    fixed(hue(h.to_degrees(), c / 100.0), 1)
                ),
            )
        }
        "oklab" => {
            let [l, a, bb, _] = color.to_oklaba();
            ("OKLAB", format!("oklab({}% {} {})", fixed(l as f64 * 100.0, 1), fixed(a as f64, 3), fixed(bb as f64, 3)))
        }
        "cmyk" => {
            let (rf, gf, bf) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
            let k = 1.0 - rf.max(gf).max(bf);
            let ink = |c: f64| if k >= 1.0 { 0.0 } else { (1.0 - c - k) / (1.0 - k) };
            ("CMYK", format!("cmyk({}, {}, {}, {})", pct(ink(rf)), pct(ink(gf)), pct(ink(bf)), pct(k)))
        }
        "vec4" => (
            "VEC4",
            format!("vec4({}, {}, {}, 1.0)", float(r as f64 / 255.0), float(g as f64 / 255.0), float(b as f64 / 255.0)),
        ),
        "decimal" => ("DECIMAL", ((r as u32) << 16 | (g as u32) << 8 | b as u32).to_string()),
        "0x" => ("0x", format!("0x{}{}{}", hex2(r), hex2(g), hex2(b)).to_uppercase().replacen("0X", "0x", 1)),
        _ => return None,
    })
}

/// A colour as typed, by the rules above: [r, g, b] and the parsed colour.
fn parse(q: &str) -> Option<([u8; 3], csscolorparser::Color)> {
    let q = q.trim();
    match from_hex(q).or_else(|| from_rgb(q)) {
        Some(c) => Some((c, csscolorparser::Color::from_rgba8(c[0], c[1], c[2], 255))),
        None => from_css(q).map(|color| {
            let [r, g, b, _] = color.to_rgba8();
            ([r, g, b], color)
        }),
    }
}

/// WCAG relative luminance of an sRGB colour.
fn luminance([r, g, b]: [u8; 3]) -> f64 {
    let lin = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/// The WCAG contrast ratio of two colours, and as shown: cut, not rounded,
/// so 4.499 never reads as 4.5.
fn ratio(fg: [u8; 3], bg: [u8; 3]) -> (f64, String) {
    let (a, b) = (luminance(fg), luminance(bg));
    let r = (a.max(b) + 0.05) / (a.min(b) + 0.05);
    (r, fixed((r * 100.0).floor() / 100.0, 2))
}

fn level(ratio: f64, aaa: f64, aa: f64) -> &'static str {
    if ratio >= aaa {
        "AAA"
    } else if ratio >= aa {
        "AA"
    } else {
        "fails"
    }
}

/// "#fff on #333": the contrast ratio and the WCAG 2 levels it passes.
fn contrast(query: &str) -> Option<Row> {
    let m = CONTRAST.captures(query).or_else(|| CONTRAST_PAIR.captures(query))?;
    let (fg, bg) = (parse(&m[1])?.0, parse(&m[2])?.0);
    let (r, shown) = ratio(fg, bg);
    let hex = |c: [u8; 3]| format!("#{}{}{}", hex2(c[0]), hex2(c[1]), hex2(c[2]));
    Some(Row {
        title: format!("{shown}:1"),
        subtitle: format!(
            "Contrast of {} on {} · text {} · large text {}",
            hex(fg).to_uppercase(),
            hex(bg).to_uppercase(),
            level(r, 7.0, 4.5),
            level(r, 4.5, 3.0)
        ),
        score: 92.0,
        copy: shown,
        swatch: Some(hex(fg)),
        ..Default::default()
    })
}

const PICK_TITLE: &str = "Pick a colour from the screen";
const PICK_WORDS: &str = "color colour picker eyedropper hex hyprpicker";
const CONTRAST_TITLE: &str = "Pick two colours for contrast";
const CONTRAST_WORDS: &str = "color colour picker contrast accessibility wcag a11y";

/// What happens after a pick: "copy", "show" (the bar opens on the colour)
/// or "copy+show". Enter does "afterPick", Shift+Enter "afterPickAlt".
fn after(ctx: &Context, key: &str, default: &'static str) -> &'static str {
    match ctx.str_setting(key) {
        Some("copy") => "copy",
        Some("show") => "show",
        Some("copy+show") => "copy+show",
        _ => default,
    }
}

fn after_words(then: &str, format: &str) -> String {
    match then {
        "copy" => format!("copies its {format}"),
        "show" => "shows its forms".into(),
        _ => format!("copies its {format} and shows its forms"),
    }
}

/// The form a pick copies: one of "formats"' names; hex unless you say.
fn copy_format(ctx: &Context) -> String {
    let f = ctx.str_setting("copyFormat").unwrap_or("hex").to_lowercase();
    if form(&f, [0, 0, 0], &csscolorparser::Color::from_rgba8(0, 0, 0, 255)).is_some() { f } else { "hex".into() }
}

fn picker(ctx: &Context, score: f64) -> Row {
    let (main, alt) = (after(ctx, "afterPick", "copy+show"), after(ctx, "afterPickAlt", "copy"));
    let format = copy_format(ctx);
    let action = |then: &str| json!({ "kind": "action", "name": "pick", "args": [then, format] });
    Row {
        title: PICK_TITLE.into(),
        subtitle: format!(
            "Click any pixel: Enter {} · Shift+Enter {}",
            after_words(main, &format),
            after_words(alt, &format)
        ),
        icon: "󰈊".into(),
        score,
        group: Some("Commands".into()),
        run: Some(action(main)),
        alt: (alt != main).then(|| action(alt)),
        ..Default::default()
    }
}

fn contrast_picker(score: f64) -> Row {
    Row {
        title: CONTRAST_TITLE.into(),
        subtitle: "Click the text colour, then the background: their WCAG contrast".into(),
        icon: "󰈊".into(),
        score,
        group: Some("Commands".into()),
        run: Some(json!({ "kind": "action", "name": "pick_contrast" })),
        ..Default::default()
    }
}

/// The picked colours, copied as one of the "exports".
fn export(kind: &str, colors: &[[u8; 3]]) -> Option<(&'static str, String)> {
    let hex = |c: &[u8; 3]| format!("#{}{}{}", hex2(c[0]), hex2(c[1]), hex2(c[2]));
    let each =
        |f: &dyn Fn(usize, &[u8; 3]) -> String| colors.iter().enumerate().map(|(i, c)| f(i + 1, c)).collect::<Vec<_>>();
    Some(match kind {
        "css" => (
            "CSS variables",
            format!(":root {{\n{}\n}}\n", each(&|i, c| format!("  --picked-{i}: {};", hex(c))).join("\n")),
        ),
        "scss" => ("SCSS variables", each(&|i, c| format!("$picked-{i}: {};", hex(c))).join("\n") + "\n"),
        "json" => ("JSON", serde_json::to_string_pretty(&colors.iter().map(hex).collect::<Vec<_>>()).ok()? + "\n"),
        "tailwind" => (
            "Tailwind colours",
            format!("colors: {{\n{}\n}}\n", each(&|i, c| format!("  'picked-{i}': '{}',", hex(c))).join("\n")),
        ),
        "gpl" => (
            "a GIMP / Inkscape palette",
            format!(
                "GIMP Palette\nName: Punctum picks\n#\n{}\n",
                each(&|i, c| format!("{:3} {:3} {:3}\tpicked-{i} {}", c[0], c[1], c[2], hex(c))).join("\n")
            ),
        ),
        _ => return None,
    })
}

const DEFAULT_EXPORTS: [&str; 5] = ["css", "scss", "json", "tailwind", "gpl"];

/// "pick ": the pickers, the colours picked before (newest first), and
/// those colours as the "exports" you keep.
fn picked(ctx: &Context, filter: &str) -> Answer {
    let mut rows = vec![picker(ctx, 97.0), contrast_picker(96.9)];
    let text = ctx.load("picks").map_or("", |l| l.text.as_str());
    let now = ctx.now.as_millisecond() as f64;
    let filter = filter.trim().trim_start_matches('#').to_lowercase();
    let mut colors: Vec<[u8; 3]> = Vec::new();
    for line in text.lines() {
        let Some((when, hex)) = line.split_once(' ') else { continue };
        let Some(rgb) = from_hex(hex) else { continue };
        if !hex.starts_with('#') || !hex[1..].contains(filter.as_str()) || colors.len() >= 30 {
            continue;
        }
        colors.push(rgb);
        let shown = hex.to_uppercase();
        let at = when.parse::<f64>().map_or(0.0, |s| s * 1000.0);
        rows.push(Row {
            title: shown.clone(),
            subtitle: format!("Picked {} · Enter copies · Tab shows its forms", ago(at, now)),
            score: 96.0 - colors.len() as f64 * 0.001,
            copy: shown.clone(),
            swatch: Some(format!("#{}{}{}", hex2(rgb[0]), hex2(rgb[1]), hex2(rgb[2]))),
            group: Some("Picked".into()),
            complete: Some(shown),
            ..Default::default()
        });
    }
    if colors.is_empty() {
        let title = if filter.is_empty() {
            "Nothing picked yet".to_string()
        } else {
            format!("No picked colour has \"{filter}\"")
        };
        rows.push(Row { title, subtitle: "Picked colours".into(), score: 40.0, ..Default::default() });
        return Answer { rows, ttl_ms: Some(30_000) };
    }
    let kinds: Vec<String> = match ctx.settings.get("exports").and_then(Value::as_array) {
        Some(list) => list.iter().filter_map(Value::as_str).map(str::to_lowercase).collect(),
        None => DEFAULT_EXPORTS.iter().map(|k| k.to_string()).collect(),
    };
    for (i, kind) in kinds.iter().enumerate() {
        let Some((name, body)) = export(kind, &colors) else { continue };
        let n = colors.len();
        rows.push(Row {
            title: format!("Copy {n} picked colour{} as {name}", if n == 1 { "" } else { "s" }),
            subtitle: body.lines().take(3).collect::<Vec<_>>().join(" ").chars().take(120).collect(),
            icon: "󰆏".into(),
            score: 90.0 - i as f64 * 0.001,
            group: Some("Export".into()),
            run: Some(json!({ "kind": "copy", "target": body, "label": "copy" })),
            ..Default::default()
        });
    }
    Answer { rows, ttl_ms: Some(30_000) }
}

/// A colour's contrast on white and on black, after its forms.
fn on_white_and_black(rgb: [u8; 3], hex: &str, first: usize) -> Vec<Row> {
    [("white", [255, 255, 255]), ("black", [0, 0, 0])]
        .into_iter()
        .enumerate()
        .map(|(i, (name, bg))| {
            let (ratio, shown) = ratio(rgb, bg);
            Row {
                title: format!("{shown}:1 on {name}"),
                subtitle: format!("Contrast · text {} · large text {}", level(ratio, 7.0, 4.5), level(ratio, 4.5, 3.0)),
                score: 92.0 - (first + i) as f64 * 0.01,
                copy: shown,
                swatch: Some(hex.to_string()),
                ..Default::default()
            }
        })
        .collect()
}

pub struct Colors;

impl Extension for Colors {
    fn id(&self) -> &'static str {
        "colors"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        if let Some(m) = PICK_MODE.captures(query) {
            return picked(ctx, m.get(1).map_or("", |x| x.as_str()));
        }
        let Some((rgb, color)) = parse(query) else {
            if let Some(row) = contrast(query) {
                return vec![row].into();
            }
            // The picker, found as the bar's commands are: by words of its
            // title or keywords, ranked as a command would be.
            let q = query.trim().to_lowercase();
            let qw = words(&q);
            if q.chars().count() < 2 || qw.is_empty() {
                return Answer::default();
            }
            // As a command would rank: a title starting with the query, then
            // the query in its title, then in its keywords.
            let found = |title: &str, keywords: &str| {
                let tw = words(title);
                let in_title = prefixes_all(&qw, &tw);
                if title.to_lowercase().starts_with(&q) {
                    Some(88.5)
                } else if in_title {
                    Some(62.0)
                } else if prefixes_all(&qw, &[tw, words(keywords)].concat()) {
                    Some(56.0)
                } else {
                    None
                }
            };
            let mut rows = Vec::new();
            if let Some(score) = found(PICK_TITLE, PICK_WORDS) {
                rows.push(picker(ctx, score));
            }
            if let Some(score) = found(CONTRAST_TITLE, CONTRAST_WORDS) {
                rows.push(contrast_picker(score - 0.01));
            }
            return rows.into();
        };
        let hex = format!("#{}{}{}", hex2(rgb[0]), hex2(rgb[1]), hex2(rgb[2]));
        let wanted: Vec<String> = match ctx.settings.get("formats").and_then(Value::as_array) {
            Some(list) if !list.is_empty() => list.iter().filter_map(Value::as_str).map(str::to_lowercase).collect(),
            _ => DEFAULT_FORMATS.iter().map(|f| f.to_string()).collect(),
        };
        let values: Vec<(&str, String)> = wanted.iter().filter_map(|name| form(name, rgb, &color)).collect();
        let n = values.len();
        let mut rows: Vec<Row> = values
            .into_iter()
            .enumerate()
            .map(|(i, (label, text))| Row {
                title: text.clone(),
                subtitle: label.into(),
                score: 92.0 - i as f64 * 0.01,
                copy: text,
                swatch: Some(hex.clone()),
                ..Default::default()
            })
            .collect();
        // How it reads as text: on white and on black, unless "contrast" is off.
        if ctx.settings.get("contrast").and_then(Value::as_bool) != Some(false) {
            rows.extend(on_white_and_black(rgb, &hex, n));
        }
        rows.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn titles(q: &str) -> Vec<String> {
        let ctx =
            Context::new(&serde_json::Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &crate::NO_DATA);
        Colors.matches(q, &ctx).rows.into_iter().map(|r| r.title).collect()
    }

    #[test]
    fn what_the_js_reads() {
        assert_eq!(
            titles("#ff6644"),
            [
                "#FF6644",
                "rgb(255, 102, 68)",
                "hsl(11, 100%, 63%)",
                "oklch(70% 0.193 34.1)",
                "2.9:1 on white",
                "7.23:1 on black"
            ]
        );
        assert_eq!(titles("rgb(255, 0, 0)")[0], "#FF0000");
        assert_eq!(titles("rgb(300 0 0)")[0], "#FF0000");
        assert_eq!(titles("ff6644").len(), 6);
        assert_eq!(titles("#f64")[0], "#FF6644");
    }

    #[test]
    fn words_stay_words() {
        for q in ["decade", "facade", "add", "123456", "f64", "red", "tan", "navy", "hello", "rgb", "hsl(", "#ff66f"] {
            assert!(titles(q).is_empty(), "{q}");
        }
    }

    #[test]
    fn what_only_the_library_reads() {
        assert_eq!(titles("hsl(11 100% 63%)")[0], "#FF6542");
        assert_eq!(titles("hsl(120, 100%, 25%)")[0], "#008000");
        assert_eq!(titles("rgb(100% 50% 0%)")[0], "#FF8000");
        assert_eq!(titles("oklch(62.8% 0.2577 29.23)")[0], "#FF0000");
        assert_eq!(titles("#ff664480")[0], "#FF6644");
        assert_eq!(titles("#f648")[0], "#FF6644");
        assert_eq!(titles("hwb(0 0% 0%)")[0], "#FF0000");
        assert_eq!(titles("#808080")[3], "oklch(60% 0 0)");
    }

    fn rows(q: &str, settings: Value, picks: Option<&str>) -> Vec<Row> {
        let mut loads = crate::Loads::new();
        if let Some(text) = picks {
            loads.insert(("colors".into(), "picks".into()), crate::Load { text: text.into(), generation: 1 });
        }
        let data = crate::Data::new();
        let now = jiff::Timestamp::from_second(1_790_000_300).unwrap();
        let ctx = Context::with_loads(&settings, now, jiff::tz::TimeZone::UTC, &data, "colors", &loads);
        Colors.matches(q, &ctx).rows
    }

    #[test]
    fn the_formats_you_ask_for() {
        let all = json!({ "formats": ["hsv", "hwb", "lab", "lch", "oklab", "cmyk", "vec4", "decimal", "0x", "nope"], "contrast": false });
        let got: Vec<_> = rows("#ff6644", all, None).into_iter().map(|r| r.title).collect();
        assert_eq!(
            got,
            [
                "hsv(11, 73%, 100%)",
                "hwb(11 27% 0%)",
                "lab(63.4% 58.05 49.9)",
                "lch(63.4% 76.55 40.7)",
                "oklab(70% 0.16 0.108)",
                "cmyk(0%, 60%, 73%, 0%)",
                "vec4(1.0, 0.4, 0.267, 1.0)",
                "16737860",
                "0xFF6644"
            ]
        );
        assert_eq!(rows("#000", json!({ "formats": ["cmyk"] }), None)[0].title, "cmyk(0%, 0%, 0%, 100%)");
        assert_eq!(rows("#ff6644", json!({ "formats": [] }), None).len(), 6);
        let on = rows("#777", json!({ "formats": ["hex"] }), None);
        assert_eq!(on[1].title, "4.47:1 on white");
        assert_eq!(on[1].subtitle, "Contrast · text fails · large text AA");
        assert_eq!(on[2].title, "4.68:1 on black");
    }

    #[test]
    fn contrast_ratios() {
        let r = &rows("#fff on #333", Value::Null, None)[0];
        assert_eq!(r.title, "12.63:1");
        assert_eq!(r.subtitle, "Contrast of #FFFFFF on #333333 · text AAA · large text AAA");
        assert_eq!(r.copy, "12.63");
        // 4.478 is cut, not rounded up to a pass.
        assert_eq!(
            rows("contrast #777 #fff", Value::Null, None)[0].subtitle,
            "Contrast of #777777 on #FFFFFF · text fails · large text AA"
        );
        assert_eq!(rows("rgb(0 0 0) vs #ffffff", Value::Null, None)[0].title, "21:1");
        assert!(rows("black on white", Value::Null, None).is_empty());
        assert!(rows("decade on facade", Value::Null, None).is_empty());
    }

    #[test]
    fn the_picker_does_what_you_set() {
        let found = rows("color picker", Value::Null, None);
        assert_eq!(found[0].title, "Pick a colour from the screen");
        assert_eq!(found[0].run, Some(json!({ "kind": "action", "name": "pick", "args": ["copy+show", "hex"] })));
        assert_eq!(found[0].alt, Some(json!({ "kind": "action", "name": "pick", "args": ["copy", "hex"] })));
        assert_eq!(
            found[0].subtitle,
            "Click any pixel: Enter copies its hex and shows its forms · Shift+Enter copies its hex"
        );
        assert_eq!(rows("pick", Value::Null, None)[0].score, 88.5);
        assert!(rows("p", Value::Null, None).is_empty());
        let mine = json!({ "afterPick": "show", "afterPickAlt": "copy", "copyFormat": "OKLCH" });
        let r = &rows("eyedropper", mine, None)[0];
        assert_eq!(r.run, Some(json!({ "kind": "action", "name": "pick", "args": ["show", "oklch"] })));
        assert_eq!(r.alt, Some(json!({ "kind": "action", "name": "pick", "args": ["copy", "oklch"] })));
        let odd = json!({ "afterPick": "$(rm -rf ~)", "afterPickAlt": "copy+show", "copyFormat": "nope" });
        let r = &rows("eyedropper", odd, None)[0];
        assert_eq!(r.run, Some(json!({ "kind": "action", "name": "pick", "args": ["copy+show", "hex"] })));
        assert!(r.alt.is_none());
        let c = rows("contrast picker", Value::Null, None);
        assert_eq!(c[0].title, "Pick two colours for contrast");
        assert_eq!(c[0].run, Some(json!({ "kind": "action", "name": "pick_contrast" })));
    }

    #[test]
    fn what_it_picked_and_exports() {
        let picks = "1790000000 #ff6644\n1789990000 #2680d9\nbad\n1 #zzzzzz\n";
        let listed = rows("pick ", Value::Null, Some(picks));
        let titles: Vec<_> = listed.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(
            titles,
            [
                "Pick a colour from the screen",
                "Pick two colours for contrast",
                "#FF6644",
                "#2680D9",
                "Copy 2 picked colours as CSS variables",
                "Copy 2 picked colours as SCSS variables",
                "Copy 2 picked colours as JSON",
                "Copy 2 picked colours as Tailwind colours",
                "Copy 2 picked colours as a GIMP / Inkscape palette"
            ]
        );
        assert_eq!(listed[2].subtitle, "Picked 5 min ago · Enter copies · Tab shows its forms");
        assert_eq!(listed[2].complete.as_deref(), Some("#FF6644"));
        let body = |r: &Row| r.run.as_ref().unwrap()["target"].as_str().unwrap().to_string();
        assert_eq!(body(&listed[4]), ":root {\n  --picked-1: #ff6644;\n  --picked-2: #2680d9;\n}\n");
        assert_eq!(body(&listed[5]), "$picked-1: #ff6644;\n$picked-2: #2680d9;\n");
        assert_eq!(body(&listed[6]), "[\n  \"#ff6644\",\n  \"#2680d9\"\n]\n");
        assert_eq!(body(&listed[7]), "colors: {\n  'picked-1': '#ff6644',\n  'picked-2': '#2680d9',\n}\n");
        assert_eq!(
            body(&listed[8]),
            "GIMP Palette\nName: Punctum picks\n#\n255 102  68\tpicked-1 #ff6644\n 38 128 217\tpicked-2 #2680d9\n"
        );
        let only = rows("pick 26", json!({ "exports": ["json"] }), Some(picks));
        assert_eq!(
            only.iter().map(|r| r.title.as_str()).collect::<Vec<_>>()[2..],
            ["#2680D9", "Copy 1 picked colour as JSON"]
        );
        assert_eq!(rows("pick ", Value::Null, None)[2].title, "Nothing picked yet");
        assert_eq!(rows("pick zz", Value::Null, Some(picks))[2].title, "No picked colour has \"zz\"");
    }
}
