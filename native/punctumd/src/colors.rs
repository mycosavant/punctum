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

use std::sync::LazyLock;

use regex::Regex;

use crate::format::js_round;
use crate::{Answer, Context, Extension, Row};

static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(#)?([a-f0-9]{6}|[a-f0-9]{3})$").unwrap());
static RGB: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^rgba?\(\s*([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})\s*(?:[,/]\s*[0-9.]+%?\s*)?\)$")
        .unwrap()
});
static HASH_ALPHA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^#([a-f0-9]{4}|[a-f0-9]{8})$").unwrap());
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

pub struct Colors;

impl Extension for Colors {
    fn id(&self) -> &'static str {
        "colors"
    }

    fn matches(&self, query: &str, _ctx: &Context) -> Answer {
        let q = query.trim();
        let (rgb, color) = match from_hex(q).or_else(|| from_rgb(q)) {
            Some(c) => (c, csscolorparser::Color::from_rgba8(c[0], c[1], c[2], 255)),
            None => match from_css(q) {
                Some(color) => {
                    let [r, g, b, _] = color.to_rgba8();
                    ([r, g, b], color)
                }
                None => return Answer::default(),
            },
        };
        let [r, g, b] = rgb;
        let hex = format!("#{}{}{}", hex2(r), hex2(g), hex2(b));
        let values = [
            ("HEX", hex.to_uppercase()),
            ("RGB", format!("rgb({r}, {g}, {b})")),
            ("HSL", hsl(r, g, b)),
            ("OKLCH", oklch(&color)),
        ];
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

    fn titles(q: &str) -> Vec<String> {
        let ctx = Context {
            settings: &serde_json::Value::Null,
            now: jiff::Timestamp::now(),
            local_zone: jiff::tz::TimeZone::UTC,
            data: &crate::NO_DATA,
        };
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
}
