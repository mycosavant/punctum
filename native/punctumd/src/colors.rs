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
//! "pick" finds the screen colour picker, PowerToys-style: Enter runs the
//! manifest's "pick" action (the `pick` script beside the manifest), which
//! runs hyprpicker, copies the hex (unless "copyOnPick" is false), keeps it
//! in a short history and opens the bar on it, showing these forms. `pick `
//! lists that history, the manifest's "picks" load.

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

/// "#fff on #333": the contrast ratio and the WCAG 2 levels it passes. The
/// ratio is shown cut, not rounded, so 4.499 never reads as 4.5.
fn contrast(query: &str) -> Option<Row> {
    let m = CONTRAST.captures(query).or_else(|| CONTRAST_PAIR.captures(query))?;
    let (fg, bg) = (parse(&m[1])?.0, parse(&m[2])?.0);
    let (a, b) = (luminance(fg), luminance(bg));
    let ratio = (a.max(b) + 0.05) / (a.min(b) + 0.05);
    let shown = fixed((ratio * 100.0).floor() / 100.0, 2);
    let level = |aaa: f64, aa: f64| {
        if ratio >= aaa {
            "AAA"
        } else if ratio >= aa {
            "AA"
        } else {
            "fails"
        }
    };
    let hex = |c: [u8; 3]| format!("#{}{}{}", hex2(c[0]), hex2(c[1]), hex2(c[2]));
    Some(Row {
        title: format!("{shown}:1"),
        subtitle: format!(
            "Contrast of {} on {} · text {} · large text {}",
            hex(fg).to_uppercase(),
            hex(bg).to_uppercase(),
            level(7.0, 4.5),
            level(4.5, 3.0)
        ),
        score: 92.0,
        copy: shown,
        swatch: Some(hex(fg)),
        ..Default::default()
    })
}

const PICK_TITLE: &str = "Pick a colour from the screen";
const PICK_WORDS: &str = "color colour picker eyedropper hex hyprpicker";

fn picker(ctx: &Context, score: f64) -> Row {
    let copies = ctx.settings.get("copyOnPick").and_then(Value::as_bool) != Some(false);
    Row {
        title: PICK_TITLE.into(),
        subtitle: if copies {
            "Click any pixel; its hex is copied and its forms shown".into()
        } else {
            "Click any pixel to see its forms".into()
        },
        icon: "󰈊".into(),
        score,
        group: Some("Commands".into()),
        run: Some(json!({ "kind": "action", "name": if copies { "pick" } else { "pick_only" } })),
        ..Default::default()
    }
}

/// "pick ": the picker, then the colours picked before, newest first.
fn picked(ctx: &Context, filter: &str) -> Answer {
    let mut rows = vec![picker(ctx, 97.0)];
    let text = ctx.load("picks").map_or("", |l| l.text.as_str());
    let now = ctx.now.as_millisecond() as f64;
    let filter = filter.trim().trim_start_matches('#').to_lowercase();
    for line in text.lines() {
        let Some((when, hex)) = line.split_once(' ') else { continue };
        let Some(rgb) = from_hex(hex) else { continue };
        if !hex.starts_with('#') || !hex[1..].contains(filter.as_str()) || rows.len() > 12 {
            continue;
        }
        let shown = hex.to_uppercase();
        let at = when.parse::<f64>().map_or(0.0, |s| s * 1000.0);
        rows.push(Row {
            title: shown.clone(),
            subtitle: format!("Picked {} · Tab shows its forms", ago(at, now)),
            score: 96.0 - rows.len() as f64 * 0.001,
            copy: shown.clone(),
            swatch: Some(format!("#{}{}{}", hex2(rgb[0]), hex2(rgb[1]), hex2(rgb[2]))),
            group: Some("Picked".into()),
            complete: Some(shown),
            ..Default::default()
        });
    }
    Answer { rows, ttl_ms: Some(30_000) }
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
            let title = words(PICK_TITLE);
            let in_title = prefixes_all(&qw, &title);
            if !in_title && !prefixes_all(&qw, &[title, words(PICK_WORDS)].concat()) {
                return Answer::default();
            }
            let score = if PICK_TITLE.to_lowercase().starts_with(&q) {
                88.5
            } else if in_title {
                62.0
            } else {
                56.0
            };
            return vec![picker(ctx, score)].into();
        };
        let hex = format!("#{}{}{}", hex2(rgb[0]), hex2(rgb[1]), hex2(rgb[2]));
        let wanted: Vec<String> = match ctx.settings.get("formats").and_then(Value::as_array) {
            Some(list) if !list.is_empty() => list.iter().filter_map(Value::as_str).map(str::to_lowercase).collect(),
            _ => DEFAULT_FORMATS.iter().map(|f| f.to_string()).collect(),
        };
        let values: Vec<(&str, String)> = wanted.iter().filter_map(|name| form(name, rgb, &color)).collect();
        values
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
            .collect::<Vec<_>>()
            .into()
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
        assert_eq!(titles("#ff6644"), ["#FF6644", "rgb(255, 102, 68)", "hsl(11, 100%, 63%)", "oklch(70% 0.193 34.1)"]);
        assert_eq!(titles("rgb(255, 0, 0)")[0], "#FF0000");
        assert_eq!(titles("rgb(300 0 0)")[0], "#FF0000");
        assert_eq!(titles("ff6644").len(), 4);
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
        let all = json!({ "formats": ["hsv", "hwb", "lab", "lch", "oklab", "cmyk", "vec4", "decimal", "0x", "nope"] });
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
        assert_eq!(rows("#ff6644", json!({ "formats": [] }), None).len(), 4);
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
    fn the_picker_and_what_it_picked() {
        let found = rows("color picker", Value::Null, None);
        assert_eq!(found[0].title, "Pick a colour from the screen");
        assert_eq!(found[0].run, Some(json!({ "kind": "action", "name": "pick" })));
        assert_eq!(rows("pick", Value::Null, None)[0].score, 88.5);
        assert!(rows("p", Value::Null, None).is_empty());
        let off = json!({ "copyOnPick": false });
        assert_eq!(
            rows("eyedropper", off.clone(), None)[0].run,
            Some(json!({ "kind": "action", "name": "pick_only" }))
        );
        let picks = "1790000000 #ff6644\n1789990000 #2680d9\nbad\n1 #zzzzzz\n";
        let listed = rows("pick ", Value::Null, Some(picks));
        let titles: Vec<_> = listed.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["Pick a colour from the screen", "#FF6644", "#2680D9"]);
        assert_eq!(listed[1].subtitle, "Picked 5 min ago · Tab shows its forms");
        assert_eq!(listed[1].complete.as_deref(), Some("#FF6644"));
        assert_eq!(rows("pick 26", off, Some(picks)).len(), 2);
    }
}
