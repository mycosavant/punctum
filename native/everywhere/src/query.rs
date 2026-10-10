//! What a query asks for: its words, as plocate and the matcher read them,
//! and its filters (size:, dm:, ext:, type:), as in Everything.

use std::sync::LazyLock;

use jiff::tz::TimeZone;
use jiff::{ToSpan, Zoned};
use regex::Regex;

pub const MIN_QUERY: usize = 2;
pub const MAX_QUERY: usize = 160;

static SIZE_VALUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]+(?:\.[0-9]+)?)\s*([kmgt]?b?)$").unwrap());
static SIZE_RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([0-9][0-9.]*\s*[a-z]*)-([0-9][0-9.]*\s*[a-z]*)$").unwrap());
static SIZE_OP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)^(>=|<=|>|<)?(.+)$").unwrap());
static AGO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]+)([hdwmy])$").unwrap());
static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$").unwrap());
static FILTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)^(size|dm|date|modified|ext|type):(.+)$").unwrap());
static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\.?[A-Za-z0-9_+-]{1,16}$").unwrap());

/// Bytes, 1024s.
fn size_value(text: &str) -> Option<f64> {
    let lower = text.to_lowercase();
    let m = SIZE_VALUE.captures(&lower)?;
    let unit = match &m[2] {
        "" | "b" => 1.0,
        "k" | "kb" => 1024.0,
        "m" | "mb" => 1024f64.powi(2),
        "g" | "gb" => 1024f64.powi(3),
        _ => 1024f64.powi(4),
    };
    Some(m[1].parse::<f64>().ok()? * unit)
}

/// size:>10M, size:<=500k, size:1M-10M, size:10M (at least) → (min, max) bytes.
pub fn parse_size(spec: &str) -> Option<(Option<f64>, Option<f64>)> {
    let lower = spec.to_lowercase();
    if let Some(m) = SIZE_RANGE.captures(&lower) {
        let (lo, hi) = (size_value(&m[1])?, size_value(&m[2])?);
        return (lo <= hi).then_some((Some(lo), Some(hi)));
    }
    let m = SIZE_OP.captures(spec)?;
    let v = size_value(&m[2])?;
    Some(match m.get(1).map_or(">=", |o| o.as_str()) {
        ">" => (Some(v + 1.0), None),
        ">=" => (Some(v), None),
        // Nothing is smaller than nothing.
        "<" if v < 1.0 => return None,
        "<" => (None, Some(v - 1.0)),
        _ => (None, Some(v)),
    })
}

/// The start of a calendar day, `days` from today, in the local zone.
fn midnight(now: &Zoned, days: i64) -> Option<f64> {
    let day = now.date().checked_add(days.days()).ok()?;
    Some(day.to_zoned(now.time_zone().clone()).ok()?.timestamp().as_second() as f64)
}

/// dm:today|yesterday|week|month|year|3d|12h|2w|2026-10-01 → (since, until)
/// in seconds since the epoch. Yesterday's midnight comes from the
/// calendar, not midnight minus 86400: a day with a clock change is 23 or 25
/// hours long.
pub fn parse_since(spec: &str, now: f64, tz: &TimeZone) -> Option<(f64, Option<f64>)> {
    let zoned = jiff::Timestamp::from_second(now as i64).ok()?.to_zoned(tz.clone());
    let spec = spec.to_lowercase();
    match spec.as_str() {
        "today" => return Some((midnight(&zoned, 0)?, None)),
        "yesterday" => return Some((midnight(&zoned, -1)?, Some(midnight(&zoned, 0)?))),
        "week" => return Some((now - 7.0 * 86400.0, None)),
        "month" => return Some((now - 31.0 * 86400.0, None)),
        "year" => return Some((now - 366.0 * 86400.0, None)),
        _ => {}
    }
    if let Some(m) = AGO.captures(&spec) {
        let unit = match &m[2] {
            "h" => 3600.0,
            "d" => 86400.0,
            "w" => 7.0 * 86400.0,
            "m" => 31.0 * 86400.0,
            _ => 366.0 * 86400.0,
        };
        return Some((now - m[1].parse::<f64>().ok()? * unit, None));
    }
    let m = DATE.captures(&spec)?;
    // 2026-02-30 isn't a day, rather than quietly 2026-03-02.
    let date = jiff::civil::Date::new(m[1].parse().ok()?, m[2].parse().ok()?, m[3].parse().ok()?).ok()?;
    Some((date.to_zoned(tz.clone()).ok()?.timestamp().as_second() as f64, None))
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Filters {
    pub size: Option<(Option<f64>, Option<f64>)>,
    pub since: Option<(f64, Option<f64>)>,
    pub ext: Option<Vec<String>>,
    /// "file" or "dir".
    pub kind: Option<&'static str>,
    /// Filters that didn't read.
    pub bad: Vec<String>,
}

impl Filters {
    pub fn needs_stat(&self) -> bool {
        self.size.is_some() || self.since.is_some() || self.kind.is_some()
    }
}

/// The terms that aren't filters, and the filters.
pub fn split_filters(ts: &[String], now: f64, tz: &TimeZone) -> (Vec<String>, Filters) {
    let mut rest = Vec::new();
    let mut f = Filters::default();
    for t in ts {
        let Some(m) = FILTER.captures(t) else {
            rest.push(t.clone());
            continue;
        };
        let (key, val) = (m[1].to_lowercase(), &m[2]);
        let ok = match key.as_str() {
            "size" => parse_size(val).map(|v| f.size = Some(v)),
            "dm" | "date" | "modified" => parse_since(val, now, tz).map(|v| f.since = Some(v)),
            "ext" => {
                let items: Vec<&str> = val.split(',').collect();
                items.iter().all(|e| EXT.is_match(e)).then(|| {
                    f.ext = Some(items.iter().map(|e| e.to_lowercase().trim_start_matches('.').to_string()).collect())
                })
            }
            _ => match val.to_lowercase().as_str() {
                "file" | "f" => Some(f.kind = Some("file")),
                "dir" | "d" | "folder" => Some(f.kind = Some("dir")),
                _ => None,
            },
        };
        if ok.is_none() {
            f.bad.push(t.clone());
        }
    }
    (rest, f)
}

pub fn terms(text: &str) -> Vec<String> {
    text.split_whitespace().filter(|t| *t != "|").map(str::to_string).collect()
}

/// Plain words plocate can look for: the matcher's operators stripped,
/// negations left to it.
pub fn literals(ts: &[String]) -> Vec<String> {
    ts.iter()
        .filter(|t| !t.starts_with('!'))
        .map(|t| t.trim_start_matches(['\'', '^']).trim_end_matches('$').to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

/// plocate reads an unescaped * ? or [ as a glob over the whole path.
pub fn glob_safe(t: &str) -> String {
    t.chars().flat_map(|c| if "\\*?[]".contains(c) { vec!['\\', c] } else { vec![c] }).collect()
}

/// Letters in order inside one path segment, as basic regexes (ASCII letters
/// and digits only).
pub fn fuzzies(ts: &[String]) -> Vec<String> {
    ts.iter()
        .filter(|t| !t.starts_with(['!', '\'']))
        .map(|t| t.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>())
        .filter(|l| l.len() >= 3)
        .map(|l| l.chars().map(String::from).collect::<Vec<_>>().join("[^/]*"))
        .collect()
}

/// The matcher anchors ^ to the whole path, and every path starts with /, so
/// ^down becomes an exact match at a segment start.
pub fn match_query(ts: &[String]) -> String {
    ts.iter()
        .map(|t| match t.strip_prefix('^') {
            Some(rest) if !rest.is_empty() && !rest.starts_with('/') => format!("'/{rest}"),
            _ => t.clone(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Something to search for: words, or an ext:, dm: or size: filter.
pub fn usable(text: &str, now: f64, tz: &TimeZone) -> bool {
    if text.chars().count() > MAX_QUERY || text.chars().any(|c| (c as u32) < 32) {
        return false;
    }
    let (ts, f) = split_filters(&terms(text), now, tz);
    let lit = literals(&ts);
    if !lit.is_empty() {
        return lit.concat().chars().count() >= MIN_QUERY && ts.len() <= 10;
    }
    f.ext.is_some() || f.since.is_some() || f.size.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn sizes() {
        assert_eq!(parse_size(">10M"), Some((Some(10.0 * 1048576.0 + 1.0), None)));
        assert_eq!(parse_size("<=500k"), Some((None, Some(512000.0))));
        assert_eq!(parse_size("1M-10M"), Some((Some(1048576.0), Some(10485760.0))));
        assert_eq!(parse_size("10M"), Some((Some(10485760.0), None)));
        assert_eq!(parse_size("<0"), None);
        assert_eq!(parse_size("10M-1M"), None);
        assert_eq!(parse_size("big"), None);
    }

    #[test]
    fn dates_across_a_clock_change() {
        // 2 Nov 2026, 12:00 in Chicago; clocks went back on 1 Nov.
        let tz = TimeZone::get("America/Chicago").unwrap();
        let now =
            jiff::civil::date(2026, 11, 2).at(12, 0, 0, 0).to_zoned(tz.clone()).unwrap().timestamp().as_second() as f64;
        let (lo, hi) = parse_since("yesterday", now, &tz).unwrap();
        assert_eq!(hi.unwrap() - lo, 25.0 * 3600.0);
        assert!(parse_since("2026-02-30", now, &tz).is_none());
        assert_eq!(parse_since("3d", now, &tz), Some((now - 3.0 * 86400.0, None)));
    }

    #[test]
    fn words_and_filters() {
        let tz = TimeZone::UTC;
        let (rest, f) = split_filters(&s(&["report", "ext:pdf,.MD", "dm:week", "type:d", "size:huge"]), 1e9, &tz);
        assert_eq!(rest, ["report"]);
        assert_eq!(f.ext, Some(s(&["pdf", "md"])));
        assert_eq!(f.kind, Some("dir"));
        assert_eq!(f.bad, ["size:huge"]);
        assert_eq!(literals(&s(&["'exact", "^down", "end$", "!no"])), ["exact", "down", "end"]);
        assert_eq!(fuzzies(&s(&["Dwnlds", "ab", "!no"])), ["d[^/]*w[^/]*n[^/]*l[^/]*d[^/]*s"]);
        assert_eq!(glob_safe("a*b[1]"), "a\\*b\\[1\\]");
        assert_eq!(match_query(&s(&["^down", "^/etc", "x"])), "'/down ^/etc x");
        assert!(
            usable("ab", 1e9, &tz)
                && !usable("a", 1e9, &tz)
                && usable("ext:pdf", 1e9, &tz)
                && !usable("type:d", 1e9, &tz)
        );
    }
}
