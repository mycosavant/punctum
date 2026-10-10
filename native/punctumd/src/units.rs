//! Unit conversion, offline. A port of extensions/units/provider.js.
//!
//!   5 km to mi · 180 lb in kg · 72f · 5 ft 11 in to cm · 90 min to hours
//!
//! With a target unit you get that one answer; without one, the usual
//! counterparts (km → mi, °F → °C, …). Durations only convert with an
//! explicit target, so "in 2 weeks" and "5 min" stay with the date provider.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use crate::format::{format, js_round, plain, to_precision};
use crate::{Answer, Context, Extension, Row};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Dim {
    Length,
    Mass,
    Volume,
    Area,
    Speed,
    Data,
    Duration,
    Temperature,
}

impl Dim {
    fn name(self) -> &'static str {
        match self {
            Dim::Length => "Length",
            Dim::Mass => "Weight",
            Dim::Volume => "Volume",
            Dim::Area => "Area",
            Dim::Speed => "Speed",
            Dim::Data => "Data",
            Dim::Duration => "Duration",
            Dim::Temperature => "Temperature",
        }
    }

    // Each result shows what kind of quantity it is.
    fn icon(self) -> &'static str {
        match self {
            Dim::Length => "󰑭",
            Dim::Mass => "󰖢",
            Dim::Volume => "󰆫",
            Dim::Area => "󰀁",
            Dim::Speed => "󰓅",
            Dim::Data => "󰋊",
            Dim::Duration => "󰔛",
            Dim::Temperature => "󰔏",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Temp {
    Celsius,
    Fahrenheit,
    Kelvin,
}

impl Temp {
    fn to_kelvin(self, v: f64) -> f64 {
        match self {
            Temp::Celsius => v + 273.15,
            Temp::Fahrenheit => (v - 32.0) * 5.0 / 9.0 + 273.15,
            Temp::Kelvin => v,
        }
    }

    fn kelvin_to(self, k: f64) -> f64 {
        match self {
            Temp::Celsius => k - 273.15,
            Temp::Fahrenheit => (k - 273.15) * 9.0 / 5.0 + 32.0,
            Temp::Kelvin => k,
        }
    }
}

#[derive(Debug, PartialEq)]
struct Unit {
    dim: Dim,
    /// To the dimension's base unit: m, kg, l, m², m/s, byte, s.
    factor: f64,
    name: &'static str,
    temp: Option<Temp>,
}

// (dimension, factor to the base unit, display name, aliases)
#[rustfmt::skip]
const UNITS: &[(Dim, f64, &str, &[&str])] = &[
    (Dim::Length, 1e3, "km", &["km", "kilometer", "kilometers", "kilometre", "kilometres"]),
    (Dim::Length, 1.0, "m", &["m", "meter", "meters", "metre", "metres"]),
    (Dim::Length, 0.01, "cm", &["cm", "centimeter", "centimeters", "centimetre", "centimetres"]),
    (Dim::Length, 0.001, "mm", &["mm", "millimeter", "millimeters", "millimetre", "millimetres"]),
    (Dim::Length, 1609.344, "mi", &["mi", "mile", "miles"]),
    (Dim::Length, 0.9144, "yd", &["yd", "yard", "yards"]),
    (Dim::Length, 0.3048, "ft", &["ft", "foot", "feet", "'"]),
    (Dim::Length, 0.0254, "in", &["in", "inch", "inches", "\""]),
    (Dim::Length, 1852.0, "nmi", &["nmi", "nautical mile", "nautical miles"]),

    (Dim::Mass, 1000.0, "t", &["t", "tonne", "tonnes", "metric ton", "metric tons"]),
    (Dim::Mass, 1.0, "kg", &["kg", "kilo", "kilos", "kilogram", "kilograms", "kgs"]),
    (Dim::Mass, 0.001, "g", &["g", "gram", "grams", "gm"]),
    (Dim::Mass, 1e-6, "mg", &["mg", "milligram", "milligrams"]),
    (Dim::Mass, 0.45359237, "lb", &["lb", "lbs", "pound", "pounds"]),
    (Dim::Mass, 0.028349523125, "oz", &["oz", "ounce", "ounces"]),
    (Dim::Mass, 6.35029318, "st", &["st", "stone", "stones"]),

    (Dim::Volume, 1.0, "L", &["l", "liter", "liters", "litre", "litres", "ltr"]),
    (Dim::Volume, 0.001, "mL", &["ml", "milliliter", "milliliters", "millilitre", "millilitres"]),
    (Dim::Volume, 3.785411784, "gal", &["gal", "gallon", "gallons", "us gal"]),
    (Dim::Volume, 4.54609, "imp gal", &["imp gal", "imperial gallon", "imperial gallons", "uk gal"]),
    (Dim::Volume, 0.946352946, "qt", &["qt", "quart", "quarts"]),
    (Dim::Volume, 0.473176473, "pt", &["pt", "pint", "pints"]),
    (Dim::Volume, 0.2365882365, "cup", &["cup", "cups"]),
    (Dim::Volume, 0.0295735295625, "fl oz", &["fl oz", "floz", "fluid ounce", "fluid ounces"]),
    (Dim::Volume, 0.01478676478125, "tbsp", &["tbsp", "tablespoon", "tablespoons"]),
    (Dim::Volume, 0.00492892159375, "tsp", &["tsp", "teaspoon", "teaspoons"]),

    (Dim::Area, 1e6, "km²", &["km2", "km²", "sq km", "square kilometer", "square kilometers", "square kilometre", "square kilometres"]),
    (Dim::Area, 1.0, "m²", &["m2", "m²", "sq m", "square meter", "square meters", "square metre", "square metres"]),
    (Dim::Area, 0.09290304, "ft²", &["ft2", "ft²", "sq ft", "sqft", "square foot", "square feet"]),
    (Dim::Area, 1e4, "ha", &["ha", "hectare", "hectares"]),
    (Dim::Area, 4046.8564224, "acre", &["acre", "acres", "ac"]),
    (Dim::Area, 2589988.110336, "mi²", &["mi2", "mi²", "sq mi", "square mile", "square miles"]),

    (Dim::Speed, 1.0 / 3.6, "km/h", &["km/h", "kmh", "kph", "kmph"]),
    (Dim::Speed, 0.44704, "mph", &["mph", "mi/h"]),
    (Dim::Speed, 1.0, "m/s", &["m/s", "mps"]),
    (Dim::Speed, 1852.0 / 3600.0, "kn", &["kn", "knot", "knots", "kt"]),

    (Dim::Data, 1.0, "B", &["b", "byte", "bytes"]),
    (Dim::Data, 1e3, "KB", &["kb", "kilobyte", "kilobytes"]),
    (Dim::Data, 1e6, "MB", &["mb", "megabyte", "megabytes"]),
    (Dim::Data, 1e9, "GB", &["gb", "gigabyte", "gigabytes"]),
    (Dim::Data, 1e12, "TB", &["tb", "terabyte", "terabytes"]),
    (Dim::Data, 1024.0, "KiB", &["kib", "kibibyte", "kibibytes"]),
    (Dim::Data, 1048576.0, "MiB", &["mib", "mebibyte", "mebibytes"]),
    (Dim::Data, 1073741824.0, "GiB", &["gib", "gibibyte", "gibibytes"]),
    (Dim::Data, 1099511627776.0, "TiB", &["tib", "tebibyte", "tebibytes"]),

    (Dim::Duration, 1.0, "s", &["s", "sec", "secs", "second", "seconds"]),
    (Dim::Duration, 60.0, "min", &["min", "mins", "minute", "minutes"]),
    (Dim::Duration, 3600.0, "h", &["h", "hr", "hrs", "hour", "hours"]),
    (Dim::Duration, 86400.0, "days", &["d", "day", "days"]),
    (Dim::Duration, 604800.0, "weeks", &["wk", "wks", "week", "weeks"]),
];

#[rustfmt::skip]
const TEMPS: &[(Temp, &str, &[&str])] = &[
    (Temp::Celsius, "°C", &["c", "°c", "celsius", "centigrade", "degc"]),
    (Temp::Fahrenheit, "°F", &["f", "°f", "fahrenheit", "degf"]),
    (Temp::Kelvin, "K", &["k", "kelvin"]),
];

// Where a unit converts to when you don't say.
#[rustfmt::skip]
const COUNTERPARTS: &[(&str, &[&str])] = &[
    ("km", &["mi"]), ("m", &["ft", "yd"]), ("cm", &["in"]), ("mm", &["in"]), ("mi", &["km"]), ("yd", &["m"]), ("ft", &["m", "cm"]), ("in", &["cm"]), ("nmi", &["km", "mi"]),
    ("t", &["lb"]), ("kg", &["lb"]), ("g", &["oz"]), ("mg", &["g"]), ("lb", &["kg"]), ("oz", &["g"]), ("st", &["kg", "lb"]),
    ("L", &["gal", "fl oz"]), ("mL", &["fl oz"]), ("gal", &["L"]), ("imp gal", &["L"]), ("qt", &["L"]), ("pt", &["mL"]), ("cup", &["mL"]), ("fl oz", &["mL"]), ("tbsp", &["mL"]), ("tsp", &["mL"]),
    ("km²", &["mi²"]), ("m²", &["ft²"]), ("ft²", &["m²"]), ("ha", &["acre"]), ("acre", &["ha", "m²"]), ("mi²", &["km²"]),
    ("km/h", &["mph"]), ("mph", &["km/h"]), ("m/s", &["km/h"]), ("kn", &["km/h", "mph"]),
    ("B", &["KB"]), ("KB", &["KiB"]), ("MB", &["MiB"]), ("GB", &["GiB", "MB"]), ("TB", &["TiB", "GB"]), ("KiB", &["KB"]), ("MiB", &["MB"]), ("GiB", &["GB"]), ("TiB", &["TB"]),
    ("°C", &["°F"]), ("°F", &["°C"]), ("K", &["°C"]),
];

struct Index {
    units: Vec<Unit>,
    by_alias: HashMap<&'static str, usize>,
    by_name: HashMap<&'static str, usize>,
}

// Later entries win an alias, as in the JS: temperatures are indexed last.
static INDEX: LazyLock<Index> = LazyLock::new(|| {
    let mut ix = Index { units: Vec::new(), by_alias: HashMap::new(), by_name: HashMap::new() };
    let mut add = |unit: Unit, aliases: &[&'static str]| {
        let at = ix.units.len();
        ix.by_name.insert(unit.name, at);
        for a in aliases {
            ix.by_alias.insert(a, at);
        }
        ix.units.push(unit);
    };
    for &(dim, factor, name, aliases) in UNITS {
        add(Unit { dim, factor, name, temp: None }, aliases);
    }
    for &(temp, name, aliases) in TEMPS {
        add(Unit { dim: Dim::Temperature, factor: 1.0, name, temp: Some(temp) }, aliases);
    }
    ix
});

const NUMBER: &str = r"(-?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?|-?\.[0-9]+)";
const UNIT_CHARS: &str = r#"[a-z°'"/²2 ]"#;

static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static DEGREES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^degrees? ").unwrap());
static STARTS_NUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-?[0-9.]").unwrap());
static CONNECTOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+(?:to|in|into|as)\s+|\s*(?:->|→|=)\s*").unwrap());
// "5 ft 11 in", "5'11\"", "6 lb 4 oz": two parts of one dimension.
static TWO_PART: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"(?i)^{NUMBER}\s*({UNIT_CHARS}+?)\s*{NUMBER}\s*({UNIT_CHARS}+)$")).unwrap());
static ONE_PART: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"(?i)^{NUMBER}\s*({UNIT_CHARS}{UNIT_CHARS}*)$")).unwrap());

fn unit_for(text: &str) -> Option<&'static Unit> {
    let lower = text.trim().to_lowercase();
    let spaced = SPACES.replace_all(&lower, " ");
    let key = DEGREES.replace(&spaced, "");
    if key.is_empty() {
        return None;
    }
    let ix = &*INDEX;
    ix.by_alias.get(key.as_ref()).map(|&i| &ix.units[i])
}

fn by_name(name: &str) -> &'static Unit {
    let ix = &*INDEX;
    &ix.units[ix.by_name[name]]
}

fn convert(value: f64, from: &Unit, to: &Unit) -> Option<f64> {
    if from.dim != to.dim {
        return None;
    }
    match (from.temp, to.temp) {
        (Some(f), Some(t)) => Some(t.kelvin_to(f.to_kelvin(value))),
        _ => Some(value * from.factor / to.factor),
    }
}

/// Readable, not falsely precise: 3.10686 mi, 0.000123 g, 1,609.34 m.
fn round(n: f64) -> f64 {
    if n == 0.0 || !n.is_finite() {
        return n;
    }
    if n.abs() >= 1.0 {
        return js_round(n * 1e4) / 1e4;
    }
    to_precision(n, 4)
}

fn num(text: &str) -> f64 {
    text.replace(',', "").parse().unwrap_or(f64::NAN)
}

struct Amount {
    value: f64,
    unit: &'static Unit,
    label: String,
}

fn parse_amount(text: &str) -> Option<Amount> {
    let t = text.trim();
    if let Some(m) = TWO_PART.captures(t) {
        if let (Some(a), Some(b)) = (unit_for(&m[2]), unit_for(&m[4])) {
            if a != b && a.dim == b.dim && a.dim != Dim::Temperature {
                return Some(Amount {
                    value: num(&m[1]) + convert(num(&m[3]), b, a)?,
                    unit: a,
                    label: format!("{} {} {} {}", &m[1], a.name, &m[3], b.name),
                });
            }
        }
    }
    let m = ONE_PART.captures(t)?;
    let u = unit_for(&m[2])?;
    Some(Amount { value: num(&m[1]), unit: u, label: format!("{} {}", &m[1], u.name) })
}

struct Parsed {
    amount: Amount,
    targets: Vec<&'static Unit>,
    explicit: bool,
}

fn parse(query: &str) -> Option<Parsed> {
    let q = query.trim();
    if !STARTS_NUMERIC.is_match(q) {
        return None;
    }
    // Try each connector position: "5 in to cm" has "in" as a unit, not a connector.
    let mut from = 0;
    while let Some(m) = CONNECTOR.find_at(q, from) {
        if let (Some(amount), Some(target)) = (parse_amount(&q[..m.start()]), unit_for(&q[m.end()..])) {
            if amount.unit.dim == target.dim {
                return Some(Parsed { amount, targets: vec![target], explicit: true });
            }
        }
        // Overlapping tries: "11 in to cm" must still reach " to ".
        from = m.start() + q[m.start()..].chars().next().map_or(1, char::len_utf8);
    }
    let only = parse_amount(q)?;
    if only.unit.dim == Dim::Duration {
        return None;
    }
    let names = COUNTERPARTS.iter().find(|(n, _)| *n == only.unit.name).map_or(&[][..], |(_, t)| t);
    Some(Parsed { amount: only, targets: names.iter().map(|n| by_name(n)).collect(), explicit: false })
}

pub struct Units;

impl Extension for Units {
    fn id(&self) -> &'static str {
        "units"
    }

    fn matches(&self, query: &str, _ctx: &Context) -> Answer {
        let Some(p) = parse(query) else { return Answer::default() };
        let mut out = Vec::new();
        for (i, to) in p.targets.iter().enumerate() {
            let Some(value) = convert(p.amount.value, p.amount.unit, to).map(round) else { continue };
            if !value.is_finite() {
                continue;
            }
            out.push(Row {
                title: format!("{} {}", format(value), to.name),
                subtitle: format!("{} → {} · {}", p.amount.label, to.name, to.dim.name()),
                icon: to.dim.icon().into(),
                score: (if p.explicit { 90.0 } else { 86.0 }) - i as f64 * 0.1,
                copy: plain(value),
                ..Default::default()
            });
        }
        out.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(q: &str) -> Vec<Row> {
        let ctx =
            Context::new(&serde_json::Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &crate::NO_DATA);
        Units.matches(q, &ctx).rows
    }

    fn top(q: &str) -> Option<String> {
        rows(q).into_iter().next().map(|r| r.title)
    }

    // The same cases tests/run.js puts to the JS provider.
    #[test]
    fn converts() {
        for (q, want) in [
            ("5 km to mi", "3.1069 mi"),
            ("5km in miles", "3.1069 mi"),
            ("180 lb to kg", "81.6466 kg"),
            ("72f", "22.2222 °C"),
            ("100 c to f", "212 °F"),
            ("0 k to c", "-273.15 °C"),
            ("5 ft 11 in to cm", "180.34 cm"),
            ("5 in to cm", "12.7 cm"),
            ("2 cups in ml", "473.1765 mL"),
            ("90 min to hours", "1.5 h"),
            ("10 gb to mb", "10,000 MB"),
            ("1 gib in mb", "1,073.7418 MB"),
            ("60 mph", "96.5606 km/h"),
            ("1,500 m to km", "1.5 km"),
            ("1 acre to m2", "4,046.8564 m²"),
            ("5'11\" to cm", "180.34 cm"),
            ("-.5 c to f", "31.1 °F"),
            ("98.6 degrees f to c", "37 °C"),
            ("5 km → mi", "3.1069 mi"),
            ("1 g to mg", "1,000 mg"),
            ("1 mg to kg", "0.000001 kg"),
            ("1 mg to t", "1e-9 t"),
        ] {
            assert_eq!(top(q).as_deref(), Some(want), "{q}");
        }
    }

    #[test]
    fn leaves_other_queries_alone() {
        for q in ["5 min", "5 kg to km", "convert units", "in 2 weeks", "2+2", "hello", "", "5", "5 zz"] {
            assert_eq!(top(q), None, "{q}");
        }
    }

    #[test]
    fn counterparts_copy_the_bare_number() {
        let km = rows("5 km");
        assert_eq!(km[0].title, "3.1069 mi");
        assert_eq!(km[0].copy, "3.1069");
        assert_eq!(km[0].subtitle, "5 km → mi · Length");
        assert_eq!(km[0].score, 86.0);
        let ft = rows("3 m");
        assert_eq!(ft.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["9.8425 ft", "3.2808 yd"]);
        assert_eq!(ft[1].score, 85.9);
    }

    #[test]
    fn every_counterpart_names_a_unit() {
        for (from, to) in COUNTERPARTS {
            let f = by_name(from);
            for t in *to {
                assert_eq!(by_name(t).dim, f.dim, "{from} → {t}");
            }
        }
    }
}
