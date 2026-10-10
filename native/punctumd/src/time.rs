//! Time zones and date maths. A port of extensions/time/provider.js, on jiff
//! and the system's tzdata (/usr/share/zoneinfo, as `date` reads it).
//!
//!   time · time in tokyo · tokyo time · 3pm lkt to pst · 15:30 in london
//!   days until dec 25 · today + 45 days · 2026-01-01 to 2026-09-23 · next friday
//!
//! Where it does better than the JS, on purpose:
//! - every IANA zone answers to its name or city ("time in reykjavik"), not
//!   only the ones the bar probed with `date`;
//! - a converted time uses each zone's offset at that moment, so "9am to
//!   new york" is right across a DST change, where the JS used today's;
//! - a zone in your "zones" that doesn't exist is left out, where `date` read
//!   it as UTC and the JS showed it under that name;
//! - a month or year from the 31st (or 29 Feb) ends on the last day of the
//!   month, where the JS rolled over: 31 Jan + 1 month is 28 Feb, not 3 Mar.

use std::sync::LazyLock;

use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::{Span, Timestamp, Zoned};
use regex::Regex;

use crate::cities::CITIES;
use crate::{Answer, Context, Extension, Row};

const WEEKDAYS: [&str; 7] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_SHORT: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
const MON_SHORT: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("pattern")
}

static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));
static CLOCK_WORDS: LazyLock<Regex> = LazyLock::new(|| re(r"^(time|now|clock|times)$"));
static TIME_IN: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    [
        re(r"^(?:time|clock|now)\s+(?:in|at)\s+(.+)$"),
        re(r"^what(?:'s| is)? (?:the )?time(?: is it)? in\s+(.+?)\??$"),
        re(r"^(.+?)\s+time$"),
    ]
});
// "3pm lkt to pst", "15:30 in london", "9am to tokyo"
static CONVERT: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*(am|pm)?(?:\s+(.+?))?\s+(?:to|in|->|=>)\s+(.+)$"));

// Every zone the database has, sorted so a city two zones share always goes
// to the same one.
static ZONE_NAMES: LazyLock<Vec<String>> = LazyLock::new(|| {
    let mut names: Vec<String> = jiff::tz::db().available().map(|n| n.as_str().to_string()).collect();
    names.sort();
    names
});

// ---------------------------------------------------------------- zones

/// A zone that knows the name it was asked for.
#[derive(Clone)]
struct Zone {
    name: String,
    tz: TimeZone,
}

fn zone(name: &str) -> Option<Zone> {
    TimeZone::get(name).ok().map(|tz| Zone { name: name.to_string(), tz })
}

/// The system's zone. One with no IANA name (a copied /etc/localtime, TZ as
/// a file or a POSIX rule) keeps its rules and is called Local, rather than
/// being taken for UTC.
fn local(ctx: &Context) -> Zone {
    Zone { name: ctx.local_zone.iana_name().unwrap_or("Local").to_string(), tz: ctx.local_zone.clone() }
}

/// Your zone: "home" in the config, else the system's.
fn home_zone(ctx: &Context) -> Option<Zone> {
    match ctx.str_setting("home") {
        Some(name) => zone(name),
        None => Some(local(ctx)),
    }
}

fn city_of(name: &str) -> String {
    name.rsplit('/').next().unwrap_or(name).replace('_', " ").to_lowercase()
}

/// A zone by city, country, abbreviation, IANA name or the city in one.
/// The cities' own zones are tried first, so a city name that two IANA zones
/// share goes where the table's zones would send it.
fn resolve(name: &str, ctx: &Context) -> Option<Zone> {
    let key = name.trim().to_lowercase();
    if key.is_empty() {
        return None;
    }
    if matches!(key.as_str(), "here" | "local" | "home") {
        return home_zone(ctx);
    }
    if let Some((_, z)) = CITIES.iter().find(|(k, _)| *k == key) {
        return zone(z);
    }
    let named = |z: &str| z.to_lowercase() == key || city_of(z) == key;
    if let Some((_, z)) = CITIES.iter().find(|(_, z)| named(z)) {
        return zone(z);
    }
    ZONE_NAMES.iter().find(|z| named(z)).and_then(|z| zone(z))
}

fn zone_label(name: &str) -> String {
    if name == "UTC" {
        return "UTC".into();
    }
    name.rsplit('/').next().unwrap_or(name).replace('_', " ")
}

fn offset_text(z: &Zoned) -> String {
    let minutes = z.offset().seconds() / 60;
    let sign = if minutes < 0 { "−" } else { "+" };
    let abs = minutes.abs();
    let rest = if abs % 60 != 0 { format!(":{:02}", abs % 60) } else { String::new() };
    format!("UTC{sign}{}{rest}", abs / 60)
}

fn clock(hour: i8, minute: i8, ctx: &Context) -> String {
    if ctx.settings.get("clock24").and_then(|v| v.as_bool()) == Some(false) {
        let suffix = if hour < 12 { "am" } else { "pm" };
        let h = if hour % 12 == 0 { 12 } else { hour % 12 };
        return format!("{h}:{minute:02} {suffix}");
    }
    format!("{hour:02}:{minute:02}")
}

fn clock_of(z: &Zoned, ctx: &Context) -> String {
    clock(z.hour(), z.minute(), ctx)
}

fn day_diff(a: Date, b: Date) -> i64 {
    a.until(b).map(|s| s.get_days() as i64).unwrap_or(0)
}

fn day_shift(target: Date, reference: Date) -> String {
    match day_diff(reference, target) {
        0 => String::new(),
        1 => " (+1 day)".into(),
        -1 => " (−1 day)".into(),
        d => format!(" ({}{} days)", if d > 0 { "+" } else { "−" }, d.abs()),
    }
}

fn zone_row(z: &Zone, now: Timestamp, ctx: &Context, score: f64) -> Row {
    let w = now.to_zoned(z.tz.clone());
    let shift = home_zone(ctx).map(|h| day_shift(w.date(), now.to_zoned(h.tz).date())).unwrap_or_default();
    let info = z.tz.to_offset_info(now);
    let abbr =
        Some(info.abbreviation()).filter(|a| !a.is_empty() && !a.starts_with(['+', '-'])).map(|a| format!("{a} · "));
    Row {
        title: format!("{} {}{shift}", clock_of(&w, ctx), zone_label(&z.name)),
        subtitle: format!(
            "{}, {} {} · {}{}",
            WD_SHORT[w.weekday().to_sunday_zero_offset() as usize],
            w.day(),
            MON_SHORT[w.month() as usize - 1],
            abbr.unwrap_or_default(),
            offset_text(&w)
        ),
        icon: String::new(),
        score,
        copy: clock_of(&w, ctx),
        ..Default::default()
    }
}

/// Some(rows) when the query is about zones (even with no answer, so dates
/// don't take it); None to let the dates have a go.
fn match_zones(q: &str, ctx: &Context) -> Option<Vec<Row>> {
    let now = ctx.now;
    if CLOCK_WORDS.is_match(q) {
        let home = match ctx.str_setting("home") {
            Some(name) => zone(name),
            None => Some(local(ctx)),
        };
        let home_name = ctx.str_setting("home").map(str::to_string).unwrap_or_else(|| local(ctx).name);
        let extra = ctx.settings.get("zones").and_then(|z| z.as_array()).cloned().unwrap_or_default();
        let mut rows = Vec::new();
        if let Some(z) = home {
            rows.push(zone_row(&z, now, ctx, 85.0));
        }
        for (i, name) in extra.iter().filter_map(|z| z.as_str()).enumerate() {
            if name == home_name {
                continue;
            }
            if let Some(z) = zone(name) {
                rows.push(zone_row(&z, now, ctx, 85.0 - (i + 1) as f64));
            }
        }
        return Some(rows);
    }

    if let Some(m) = TIME_IN.iter().find_map(|r| r.captures(q)) {
        return Some(resolve(&m[1], ctx).map(|z| vec![zone_row(&z, now, ctx, 88.0)]).unwrap_or_default());
    }

    let m = CONVERT.captures(q)?;
    if m.get(2).is_none() && m.get(3).is_none() && m.get(4).is_none() {
        return None;
    }
    let mut h: i8 = m[1].parse().ok()?;
    let min: i8 = m.get(2).map_or(Some(0), |x| x.as_str().parse().ok())?;
    if let Some(ampm) = m.get(3) {
        if !(1..=12).contains(&h) {
            return Some(Vec::new());
        }
        h = h % 12 + if ampm.as_str() == "pm" { 12 } else { 0 };
    }
    if h > 23 || min > 59 {
        return Some(Vec::new());
    }
    let from = match m.get(4) {
        Some(z) => resolve(z.as_str(), ctx),
        None => home_zone(ctx),
    };
    let (Some(from), Some(to)) = (from, resolve(&m[5], ctx)) else { return Some(Vec::new()) };

    // Today's date as seen in the source zone, at the requested wall time,
    // at that moment's offset. A time a clock change skips reads as it would
    // at the offset before the change; one it repeats, as the first.
    let src_wall: DateTime = now.to_zoned(from.tz.clone()).date().at(h, min, 0, 0);
    let instant = from.tz.to_ambiguous_zoned(src_wall).compatible().ok()?;
    let dst = instant.with_time_zone(to.tz.clone());
    Some(vec![Row {
        title: format!("{} {}{}", clock_of(&dst, ctx), zone_label(&to.name), day_shift(dst.date(), src_wall.date())),
        subtitle: format!(
            "{} {} ({}) → {} ({})",
            clock(h, min, ctx),
            zone_label(&from.name),
            offset_text(&instant),
            zone_label(&to.name),
            offset_text(&dst)
        ),
        icon: String::new(),
        score: 92.0,
        copy: clock_of(&dst, ctx),
        ..Default::default()
    }])
}

// ---------------------------------------------------------------- dates

static ISO: LazyLock<Regex> = LazyLock::new(|| re(r"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$"));
static MONTH_DAY: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([a-z]+)\.? ([0-9]{1,2})(?:st|nd|rd|th)?(?:,? ([0-9]{4}))?$"));
static DAY_MONTH: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([0-9]{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?:,? ([0-9]{4}))?$"));
static WEEKDAY: LazyLock<Regex> = LazyLock::new(|| re(r"^(next|this|last|coming)? ?([a-z]+)$"));
static UNTIL: LazyLock<Regex> =
    LazyLock::new(|| re(r"^(?:how many )?(?:days? )?(?:until|till|til|to|before) (.+?)\??$"));
static SINCE: LazyLock<Regex> = LazyLock::new(|| re(r"^(?:how many )?(?:days? )?since (.+?)\??$"));
static SHIFTED: LazyLock<Regex> = LazyLock::new(|| re(r"^(.+?) ?([+-]) ?([0-9]+) ?([a-z]+)$"));
static AHEAD: LazyLock<[Regex; 2]> =
    LazyLock::new(|| [re(r"^in ([0-9]+) ?([a-z]+)$"), re(r"^([0-9]+) ?([a-z]+) (?:from now|from today|later)$")]);
static AGO: LazyLock<Regex> = LazyLock::new(|| re(r"^([0-9]+) ?([a-z]+) ago$"));
static BETWEEN: LazyLock<Regex> =
    LazyLock::new(|| re(r"^(?:days? )?(?:between |from )?(.+?) (?:to|and|until|-|–) (.+)$"));

/// "march", "mar", "sept" → 2; "marble" → None.
fn month_index(word: &str) -> Option<u32> {
    if word.chars().count() < 3 {
        return None;
    }
    let i = MONTHS.iter().position(|m| word.starts_with(&m[..3]))?;
    (MONTHS[i].starts_with(word) || (i == 8 && word == "sept")).then_some(i as u32)
}

fn weekday_index(word: &str) -> Option<i64> {
    WEEKDAYS.iter().position(|d| *d == word).or_else(|| WEEKDAYS.iter().position(|d| &d[..3] == word)).map(|i| i as i64)
}

fn days(d: Date, n: i64) -> Option<Date> {
    d.checked_add(Span::new().try_days(n).ok()?).ok()
}

fn ymd(y: i32, m: u32, d: u32) -> Option<Date> {
    Date::new(i16::try_from(y).ok()?, i8::try_from(m).ok()?, i8::try_from(d).ok()?).ok()
}

/// A date, and whether a year was said (or is implied, as in "tomorrow").
fn parse_date(s: &str, today: Date) -> Option<(Date, bool)> {
    let t = SPACES.replace_all(s.trim(), " ").to_lowercase();
    match t.as_str() {
        "today" | "now" => return Some((today, true)),
        "tomorrow" => return Some((days(today, 1)?, true)),
        "yesterday" => return Some((days(today, -1)?, true)),
        "christmas" | "xmas" => return Some((ymd(today.year().into(), 12, 25)?, false)),
        "new year" | "new years" | "new year's" => return Some((ymd(today.year().into(), 1, 1)?, false)),
        _ => {}
    }
    let num = |m: &regex::Captures, i: usize| m.get(i).and_then(|x| x.as_str().parse::<i32>().ok());
    if let Some(m) = ISO.captures(&t) {
        return ymd(num(&m, 1)?, num(&m, 2)? as u32, num(&m, 3)? as u32).map(|d| (d, true));
    }
    if let Some(m) = MONTH_DAY.captures(&t) {
        if let Some(mo) = month_index(&m[1]) {
            let year = num(&m, 3);
            return ymd(year.unwrap_or(today.year().into()), mo + 1, num(&m, 2)? as u32).map(|d| (d, year.is_some()));
        }
    }
    if let Some(m) = DAY_MONTH.captures(&t) {
        if let Some(mo) = month_index(&m[2]) {
            let year = num(&m, 3);
            return ymd(year.unwrap_or(today.year().into()), mo + 1, num(&m, 1)? as u32).map(|d| (d, year.is_some()));
        }
    }
    if let Some(m) = WEEKDAY.captures(&t) {
        if let Some(wd) = weekday_index(&m[2]) {
            let mut diff = (wd - today.weekday().to_sunday_zero_offset() as i64 + 7) % 7;
            match m.get(1).map(|x| x.as_str()) {
                Some("last") => diff = if diff == 0 { -7 } else { diff - 7 },
                Some("next") if diff == 0 => diff = 7,
                _ => {}
            }
            return Some((days(today, diff)?, true));
        }
    }
    None
}

/// n days, weeks, months or years on from d. Months and years keep the day
/// where the month has it, else take the month's last.
fn add_units(d: Date, n: i64, unit: &str) -> Option<Date> {
    let span = match unit {
        "d" | "day" | "days" => Span::new().try_days(n),
        "w" | "wk" | "wks" | "week" | "weeks" => Span::new().try_weeks(n),
        "m" | "mo" | "mos" | "month" | "months" => Span::new().try_months(n),
        "y" | "yr" | "yrs" | "year" | "years" => Span::new().try_years(n),
        _ => return None,
    };
    d.checked_add(span.ok()?).ok()
}

fn format_date(d: Date) -> String {
    format!(
        "{}, {} {} {}",
        WD_SHORT[d.weekday().to_sunday_zero_offset() as usize],
        d.day(),
        MON_SHORT[d.month() as usize - 1],
        d.year()
    )
}

fn iso_date(d: Date) -> String {
    format!("{}-{:02}-{:02}", d.year(), d.month(), d.day())
}

fn weeks(n: i64) -> String {
    if n < 14 {
        return String::new();
    }
    let rest = if n % 7 != 0 { format!(" {}d", n % 7) } else { String::new() };
    format!(" ({}w{rest})", n / 7)
}

fn relative(days: i64) -> String {
    match days {
        0 => "today".into(),
        1 => "tomorrow".into(),
        -1 => "yesterday".into(),
        _ => {
            let n = days.abs();
            let text = format!("{n} days{}", weeks(n));
            if days > 0 { format!("in {text}") } else { format!("{text} ago") }
        }
    }
}

fn date_row(date: Date, today: Date, score: f64) -> Row {
    Row {
        title: format_date(date),
        subtitle: relative(day_diff(today, date)),
        icon: String::new(),
        score,
        copy: iso_date(date),
        ..Default::default()
    }
}

fn count_row(a: Date, b: Date, score: f64) -> Row {
    let n = day_diff(a, b).abs();
    Row {
        title: format!("{n} {}{}", if n == 1 { "day" } else { "days" }, weeks(n)),
        subtitle: format!("{} → {}", format_date(a), format_date(b)),
        icon: String::new(),
        score,
        copy: n.to_string(),
        ..Default::default()
    }
}

fn match_dates(q: &str, ctx: &Context) -> Vec<Row> {
    let today = ctx.now.to_zoned(ctx.local_zone.clone()).date();
    let count = |m: &regex::Captures, i: usize| m[i].parse::<i64>().ok();

    // "days until dec 25", "until christmas": a date without a year that has
    // passed means next year's.
    if let Some(m) = UNTIL.captures(q) {
        if let Some((mut d, had_year)) = parse_date(&m[1], today) {
            if !had_year && d < today {
                // 29 Feb, next year, is 1 Mar, as in the JS.
                let next = i32::from(d.year()) + 1;
                d = ymd(next, d.month() as u32, d.day() as u32).or_else(|| ymd(next, 3, 1)).unwrap_or(d);
            }
            return vec![count_row(today, d, 90.0)];
        }
    }
    // "days since jan 1"
    if let Some(m) = SINCE.captures(q) {
        if let Some((d, _)) = parse_date(&m[1], today) {
            return vec![count_row(d, today, 90.0)];
        }
    }
    // "today + 45 days", "dec 25 - 2 weeks"
    if let Some(m) = SHIFTED.captures(q) {
        let sign = if &m[2] == "-" { -1 } else { 1 };
        if let Some(d) =
            parse_date(&m[1], today).zip(count(&m, 3)).and_then(|((b, _), n)| add_units(b, sign * n, &m[4]))
        {
            return vec![date_row(d, today, 90.0)];
        }
    }
    // "in 3 weeks", "3 weeks from now", "10 days ago"
    if let Some(m) = AHEAD.iter().find_map(|r| r.captures(q)) {
        if let Some(d) = count(&m, 1).and_then(|n| add_units(today, n, &m[2])) {
            return vec![date_row(d, today, 88.0)];
        }
    }
    if let Some(m) = AGO.captures(q) {
        if let Some(d) = count(&m, 1).and_then(|n| add_units(today, -n, &m[2])) {
            return vec![date_row(d, today, 88.0)];
        }
    }
    // "2026-01-01 to 2026-09-23"
    if let Some(m) = BETWEEN.captures(q) {
        if let (Some((a, _)), Some((b, _))) = (parse_date(&m[1], today), parse_date(&m[2], today)) {
            return vec![count_row(a, b, 88.0)];
        }
    }
    // A bare date: "dec 25", "next friday"
    match parse_date(q, today) {
        Some((d, _)) if q != "now" => vec![date_row(d, today, 70.0)],
        _ => Vec::new(),
    }
}

pub struct Time;

impl Extension for Time {
    fn id(&self) -> &'static str {
        "time"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let q = SPACES.replace_all(query.trim(), " ").to_lowercase();
        let rows = match_zones(&q, ctx).unwrap_or_else(|| match_dates(&q, ctx));
        // Every answer here reads the clock, so it holds until the minute turns.
        let ttl_ms = (!rows.is_empty()).then(|| 60_000 - ctx.now.as_millisecond().rem_euclid(60_000) as u64);
        Answer { rows, ttl_ms }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The tests/run.js setting: a Sri Lanka user on 23 Sep 2026 at 14:00.
    fn at(local: &str, y: i16, mo: i8, d: i8, h: i8, settings: &serde_json::Value, q: &str) -> Answer {
        let zone = TimeZone::get(local).unwrap();
        let now = jiff::civil::date(y, mo, d).at(h, 0, 0, 0).to_zoned(zone.clone()).unwrap().timestamp();
        Time.matches(q, &Context::new(settings, now, zone, &crate::NO_DATA))
    }

    fn lanka(q: &str) -> Vec<Row> {
        let s =
            json!({ "home": "Asia/Colombo", "zones": ["UTC", "America/New_York", "Europe/London"], "clock24": true });
        at("Asia/Colombo", 2026, 9, 23, 14, &s, q).rows
    }

    fn top(q: &str) -> String {
        lanka(q).first().map(|r| r.title.clone()).unwrap_or_else(|| "(none)".into())
    }

    #[test]
    fn zones() {
        assert!(top("time").contains("Colombo"));
        assert_eq!(top("time in tokyo"), "17:30 Tokyo");
        assert_eq!(top("tokyo time"), "17:30 Tokyo");
        assert_eq!(top("3pm lkt to pst"), "02:30 Los Angeles");
        assert_eq!(top("15:30 in london"), "11:00 London");
        assert_eq!(top("9am to tokyo"), "12:30 Tokyo");
        assert_eq!(top("11pm to tokyo"), "02:30 Tokyo (+1 day)");
        let world = lanka("time");
        assert_eq!(
            world.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            ["14:00 Colombo", "08:30 UTC", "04:30 New York", "09:30 London"]
        );
        assert_eq!(world[2].subtitle, "Wed, 23 Sep · EDT · UTC−4");
        assert_eq!(world[0].subtitle, "Wed, 23 Sep · UTC+5:30"); // "+0530" isn't an abbreviation
    }

    #[test]
    fn dates() {
        assert_eq!(top("in 2 weeks"), "Wed, 7 Oct 2026");
        assert_eq!(top("days until dec 25"), "93 days (13w 2d)");
        assert_eq!(top("2026-01-01 to 2026-09-23"), "265 days (37w 6d)");
        assert_eq!(top("next friday"), "Fri, 25 Sep 2026");
        assert_eq!(top("last wednesday"), "Wed, 16 Sep 2026");
        assert_eq!(top("today + 45 days"), "Sat, 7 Nov 2026");
        assert_eq!(top("days until new year"), "100 days (14w 2d)");
        assert_eq!(lanka("next friday")[0].copy, "2026-09-25");
        assert_eq!(top("hello"), "(none)");
        assert_eq!(top("feb 30"), "(none)");
    }

    #[test]
    fn every_zone_by_its_city() {
        assert_eq!(top("time in reykjavik"), "08:30 Reykjavik");
        assert_eq!(top("time in america/argentina/ushuaia"), "05:30 Ushuaia");
        assert_eq!(top("what's the time in kathmandu?"), "14:15 Kathmandu");
    }

    #[test]
    fn a_converted_time_takes_the_offsets_of_its_moment() {
        // The evening before the US clocks go forward: 9am tomorrow in New
        // York is already EDT, though it's EST as this is typed.
        let s = json!({ "home": "Europe/London" });
        let r = &at("Europe/London", 2026, 3, 7, 22, &s, "11pm to new york").rows[0];
        assert_eq!(r.title, "18:00 New York");
        assert_eq!(
            at("Europe/London", 2026, 3, 29, 0, &s, "9am to new york").rows[0].subtitle,
            "09:00 London (UTC+1) → New York (UTC−4)"
        );
    }

    #[test]
    fn a_zone_that_does_not_exist_is_left_out() {
        let s = json!({ "home": "Asia/Colombo", "zones": ["Not/AZone", "UTC"] });
        let titles: Vec<String> =
            at("Asia/Colombo", 2026, 9, 23, 14, &s, "time").rows.into_iter().map(|r| r.title).collect();
        assert_eq!(titles, ["14:00 Colombo", "08:30 UTC"]);
    }

    #[test]
    fn months_end_on_the_last_day_rather_than_rolling_over() {
        assert_eq!(top("2026-01-31 + 1 month"), "Sat, 28 Feb 2026");
        assert_eq!(top("2028-02-29 + 1 year"), "Wed, 28 Feb 2029");
    }

    #[test]
    fn twelve_hour_clocks_and_ttl() {
        let s = json!({ "home": "Asia/Colombo", "clock24": false });
        let a = at("Asia/Colombo", 2026, 9, 23, 14, &s, "time in tokyo");
        assert_eq!(a.rows[0].title, "5:30 pm Tokyo");
        assert_eq!(a.ttl_ms, Some(60_000));
        assert_eq!(at("Asia/Colombo", 2026, 9, 23, 14, &s, "hello").ttl_ms, None);
    }
}
