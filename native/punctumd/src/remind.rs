//! Reminders and alarms, as Omarchy reminders: they show in its bar indicator
//! and `omarchy-reminder show` / `clear` see them. A port of
//! extensions/remind/provider.js.
//!
//!   remind 10m take out the laundry       in ten minutes
//!   remind me to call mom at 3pm          at 15:00 (tomorrow if that's passed)
//!   !remindme tomorrow 9am dentist        DuckDuckGo-style
//!   remind 1h30m stretch · remind 20 tea  a bare number is minutes, as omarchy-reminder takes it
//!   alarm 6:45 · alarm tomorrow 7am       a critical notification and a sound
//!   remind                                what's set; Shift+Enter cancels one
//!
//! The time is parsed here, and the dates worked out with jiff in the
//! system's time zone, so a time across a clock change is the one on the
//! wall. Enter is one of the manifest's actions: remind-set (in the
//! extension's folder) with the time (--in a duration, counted from Enter;
//! --at a clock time) and the message on stdin. What's set is the
//! manifest's "list" load, `omarchy-reminder show --json`.

use std::sync::LazyLock;

use fancy_regex::{Captures, Regex as Fancy};
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{ToSpan, Zoned};
use regex::Regex;
use serde_json::{Value, json};

use crate::format::js_round;
use crate::{Answer, Context, Extension, Row};

/// "alarm" and "wake" need a time after them (or nothing), so "alarm clock"
/// and "wake on lan" stay ordinary searches.
static MODE: LazyLock<Fancy> = LazyLock::new(|| {
    Fancy::new(r"(?i)^\s*(!remindme|!remind|remind(?:\s+me)?|reminder|(?:alarm|wake(?:\s+me)?)(?=\s*$|\s+(?:[0-9]|at\b|in\b|for\b|today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun|noon|midnight)))(?:\s+|$)").unwrap()
});
const UNIT: &str = "(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)";
const DAY: &str = "(today|tonight|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)";
static DURATION: LazyLock<Fancy> = LazyLock::new(|| {
    Fancy::new(&format!(
        r"(?i)(^|\s)(in\s+|for\s+|after\s+)?((?:[0-9]+(?:\.[0-9]+)?\s*{UNIT}(?:\s*(?:and\s+)?|(?=[0-9])))+)(?=\s|$)"
    ))
    .unwrap()
});
static AMOUNT: LazyLock<Fancy> =
    LazyLock::new(|| Fancy::new(&format!(r"(?i)([0-9]+(?:\.[0-9]+)?)\s*({UNIT})")).unwrap());
static CLOCK: LazyLock<Fancy> = LazyLock::new(|| {
    Fancy::new(&format!(
        r"(?i)(^|\s)(?:{DAY}\s+)?(at\s+)?(noon|midnight|([0-9]{{1,2}})(?::([0-9]{{2}}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?)(?:\s+{DAY})?(?=\s|$)"
    ))
    .unwrap()
});
static CONTROL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x00-\x1f\x7f]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static LEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:me\s+)?(?:to|that|about|for)\s+").unwrap());
static ME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^me\s+").unwrap());
static TRAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s+(?:in|at|on|by)$").unwrap());
static TIMER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^omarchy-reminder-[A-Za-z0-9-]+\.timer$").unwrap());

const MAX_AHEAD_MS: i64 = 366 * 86400 * 1000;
const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

fn unit_seconds(unit: &str) -> f64 {
    match unit.to_lowercase().as_str() {
        "s" | "sec" | "secs" | "second" | "seconds" => 1.0,
        "m" | "min" | "mins" | "minute" | "minutes" => 60.0,
        "h" | "hr" | "hrs" | "hour" | "hours" => 3600.0,
        _ => 86400.0,
    }
}

/// Seconds in "1h30m", "10 min", "2.5h", or None.
fn seconds(text: &str) -> Option<f64> {
    let mut total = None;
    let mut at = 0;
    while let Ok(Some(m)) = AMOUNT.captures_from_pos(text, at) {
        let whole = m.get(0).unwrap();
        let n: f64 = m[1].parse().unwrap_or(0.0);
        total = Some(total.unwrap_or(0.0) + n * unit_seconds(&m[2]));
        at = whole.end().max(whole.start() + 1);
    }
    total
}

/// 0 = Sunday, as JavaScript's getDay.
fn weekday(z: &Zoned) -> i64 {
    z.weekday().to_sunday_zero_offset() as i64
}

/// JavaScript's `new Date(y, m, d + days, h, min)`: a wall-clock time,
/// days counted on the calendar; a time a clock change skips is moved
/// forward, one it repeats is the first.
fn wall(date: Date, days: i64, hour: i64, minute: i64, tz: &TimeZone) -> Option<Zoned> {
    let d = date.checked_add(days.days()).ok()?;
    let dt = d.at(0, 0, 0, 0).checked_add(hour.hours()).ok()?.checked_add(minute.minutes()).ok()?;
    dt.to_zoned(tz.clone()).ok()
}

fn day_offset(word: &str, now: &Zoned) -> Option<i64> {
    if word.is_empty() {
        return None;
    }
    let w = word.to_lowercase();
    if w == "today" || w == "tonight" {
        return Some(0);
    }
    if w == "tomorrow" {
        return Some(1);
    }
    let target = WEEKDAYS.iter().position(|d| d.to_lowercase() == w[..3])? as i64;
    Some((target - weekday(now) + 7) % 7)
}

enum Clock {
    At(Zoned),
    Past,
}

/// When "at 3pm", "7:30", "tomorrow 9am", "friday noon" means, from now.
fn clock_time(m: &Captures<'_, str>, now: &Zoned, tz: &TimeZone) -> Option<Clock> {
    let get = |i: usize| m.get(i).map_or("", |x| x.as_str());
    let day_word = if !get(2).is_empty() { get(2) } else { get(8) };
    let has_at = m.get(3).is_some();
    let word = get(4).to_lowercase();
    let mut ampm = get(7).to_lowercase().replace('.', "");
    let (hour, minute): (i64, i64);
    if word == "noon" {
        hour = 12;
        minute = 0;
        ampm = "pm".into();
    } else if word == "midnight" {
        hour = 0;
        minute = 0;
        ampm = "am".into();
    } else {
        hour = get(5).parse().ok()?;
        minute = if get(6).is_empty() { 0 } else { get(6).parse().ok()? };
        // A bare number is only a time with am/pm, a colon, "at" or a day.
        if ampm.is_empty() && get(6).is_empty() && !has_at && day_word.is_empty() {
            return None;
        }
        if hour > 23 || minute > 59 || (!ampm.is_empty() && !(1..=12).contains(&hour)) {
            return None;
        }
    }
    let mut h24 = match ampm.as_str() {
        "pm" => hour % 12 + 12,
        "am" => hour % 12,
        _ => hour,
    };
    let offset = day_offset(day_word, now);
    if day_word.eq_ignore_ascii_case("tonight") && ampm.is_empty() && h24 < 12 {
        h24 += 12;
    }
    let today = now.date();
    let mut at = wall(today, offset.unwrap_or(0), h24, minute, tz)?;
    match offset {
        None => {
            // No day named: the next time it comes round. A bare "at 7" at
            // 14:00 means 19:00; a time with a colon is the 24-hour clock,
            // so "6:45" is tomorrow's 06:45, which is what an alarm means.
            if ampm.is_empty() && get(6).is_empty() && (1..=12).contains(&hour) && at <= *now {
                let later = at.checked_add(12.hours()).ok()?;
                if later > *now {
                    at = later;
                }
            }
            if at <= *now {
                at = wall(at.date(), 1, at.hour() as i64, at.minute() as i64, tz)?;
            }
        }
        Some(0) if at <= *now => {
            // "friday 9am" on a Friday at 10:00 is next Friday; "today 9am" has passed.
            let w = day_word.to_lowercase();
            if w == "today" || w == "tonight" {
                return Some(Clock::Past);
            }
            at = wall(at.date(), 7, at.hour() as i64, at.minute() as i64, tz)?;
        }
        _ => {}
    }
    Some(Clock::At(at))
}

struct Candidate {
    index: usize,
    length: usize,
    at: Option<Zoned>,
    seconds: Option<i64>,
    past: bool,
    marked: bool,
}

/// Every time-like phrase in the text, in order. "Marked" means it says it's
/// a time: "in 10m", a leading "10m", "at 5", "5pm", a day name. A number in
/// the message ("buy 2 eggs at 5pm") is a candidate too, but unmarked.
fn candidates(t: &str, now: &Zoned, tz: &TimeZone) -> Vec<Candidate> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Ok(Some(m)) = DURATION.captures_from_pos(t, pos) {
        let whole = m.get(0).unwrap();
        if let Some(secs) = seconds(&m[3]).filter(|s| *s > 0.0) {
            let secs = js_round(secs) as i64;
            out.push(Candidate {
                index: whole.start(),
                length: whole.end() - whole.start(),
                // A duration too long to add is no time at all (and past the
                // year a reminder may be anyway).
                at: secs
                    .checked_mul(1000)
                    .and_then(|ms| now.timestamp().checked_add(ms.milliseconds()).ok())
                    .map(|ts| ts.to_zoned(tz.clone())),
                seconds: Some(secs),
                past: false,
                marked: m.get(2).is_some() || whole.start() == 0,
            });
        }
        pos = whole.end().max(whole.start() + 1);
    }
    let mut pos = 0;
    while let Ok(Some(m)) = CLOCK.captures_from_pos(t, pos) {
        let whole = m.get(0).unwrap();
        match clock_time(&m, now, tz) {
            Some(Clock::At(at)) => out.push(Candidate {
                index: whole.start(),
                length: whole.end() - whole.start(),
                at: Some(at),
                seconds: None,
                past: false,
                marked: true,
            }),
            Some(Clock::Past) => out.push(Candidate {
                index: whole.start(),
                length: whole.end() - whole.start(),
                at: None,
                seconds: None,
                past: true,
                marked: true,
            }),
            None => {}
        }
        // Past the space it starts with, and one character more.
        let lead = m.get(1).map_or(0, |x| x.end() - x.start());
        pos = whole.start() + (lead + 1).max(1);
        while !t.is_char_boundary(pos) {
            pos += 1;
        }
    }
    out.sort_by_key(|c| c.index);
    out
}

#[derive(Debug, PartialEq)]
enum Parsed {
    At { at: Zoned, message: String, seconds: Option<i64> },
    Missing,
    Past,
    Nothing,
}

/// The start of a text, at most `units` UTF-16 code units, never splitting
/// a character.
fn head(text: &str, units: usize) -> &str {
    let mut used = 0;
    for (i, c) in text.char_indices() {
        used += c.len_utf16();
        if used > units {
            return &text[..i];
        }
    }
    text
}

fn parse(text: &str, now: &Zoned, tz: &TimeZone) -> Parsed {
    let clean = CONTROL.replace_all(text, " ");
    let t = format!(" {} ", SPACES.replace_all(&clean, " ").trim());
    let all = candidates(&t, now, tz);
    let mut pick =
        all.iter().find(|c| c.marked).or(all.first()).map(|c| (c.index, c.length, c.at.clone(), c.seconds, c.past));
    // omarchy-reminder's form: a leading bare number is minutes, when nothing
    // else in the text is a time.
    if pick.is_none() {
        let digits: String = t[1..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if (1..=4).contains(&digits.len()) && t[1 + digits.len()..].starts_with(char::is_whitespace) {
            let n: i64 = digits.parse().unwrap_or(0);
            if n > 0 {
                let at =
                    now.timestamp().checked_add((n * 60_000).milliseconds()).ok().map(|ts| ts.to_zoned(tz.clone()));
                pick = Some((0, 1 + digits.len(), at, Some(n * 60), false));
            }
        }
    }
    if let Some((_, _, _, _, true)) = pick {
        return Parsed::Past;
    }
    let message = match &pick {
        Some((index, length, ..)) => format!("{} {}", &t[..*index], &t[index + length..]),
        None => t.clone(),
    };
    let message = SPACES.replace_all(&message, " ").trim().to_string();
    let message = LEAD.replace(&message, "").into_owned();
    let message = ME.replace(&message, "").into_owned();
    let message = TRAIL.replace(&message, "").trim().to_string();
    let Some((_, _, Some(at), seconds, _)) = pick else {
        return if t.trim().is_empty() { Parsed::Nothing } else { Parsed::Missing };
    };
    if at.timestamp().as_millisecond() - now.timestamp().as_millisecond() > MAX_AHEAD_MS {
        return Parsed::Nothing;
    }
    Parsed::At { at, message: head(&message, 1000).to_string(), seconds: seconds.filter(|s| *s != 0) }
}

fn until(at: &Zoned, now: &Zoned) -> String {
    let secs = js_round((at.timestamp().as_millisecond() - now.timestamp().as_millisecond()) as f64 / 1000.0);
    if secs < 120.0 {
        return format!("in {} s", secs.max(1.0));
    }
    let mins = js_round(secs / 60.0);
    if mins < 60.0 {
        return format!("in {mins} min");
    }
    let (h, r) = ((mins / 60.0).floor(), mins % 60.0);
    if h < 24.0 {
        return if r != 0.0 { format!("in {h} h {r} min") } else { format!("in {h} h") };
    }
    let d = js_round(mins / 1440.0);
    format!("in {d} {}", if d == 1.0 { "day" } else { "days" })
}

fn when(at: &Zoned, now: &Zoned) -> String {
    // Seconds only when it's close enough for them to matter.
    let close = at.timestamp().as_millisecond() - now.timestamp().as_millisecond() < 120_000;
    let mut hm = format!("{}:{:02}", at.hour(), at.minute());
    if close && at.second() != 0 {
        hm += &format!(":{:02}", at.second());
    }
    if at.date() == now.date() {
        return hm;
    }
    if now.date().tomorrow().is_ok_and(|d| d == at.date()) {
        return hm + " tomorrow";
    }
    format!("{hm} {} {} {}", WEEKDAYS[weekday(at) as usize], at.day(), MONTHS[at.month() as usize - 1])
}

/// JavaScript's String(x), for the fields omarchy-reminder writes.
fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(_) | Value::Object(_) => String::new(),
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Omarchy's list, from `omarchy-reminder show --json`.
fn listed(text: &str) -> Vec<Value> {
    let data: Value = serde_json::from_str(if text.is_empty() { "{}" } else { text }).unwrap_or(Value::Null);
    match data.get("reminders") {
        Some(Value::Array(list)) => list
            .iter()
            .filter(|r| truthy(r) && TIMER.is_match(&text_of(r.get("timer").unwrap_or(&Value::Null))))
            .cloned()
            .collect(),
        _ => Vec::new(),
    }
}

fn note(title: &str, subtitle: &str, score: f64) -> Row {
    Row { title: title.into(), subtitle: subtitle.into(), score, ..Default::default() }
}

pub struct Remind;

impl Extension for Remind {
    fn id(&self) -> &'static str {
        "remind"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let Ok(Some(m)) = MODE.captures(query) else { return Answer::default() };
        let alarm = m[1].to_lowercase().starts_with("alarm") || m[1].to_lowercase().starts_with("wake");
        let tz = &ctx.local_zone;
        let now = ctx.now.to_zoned(tz.clone());
        let text = &query[m.get(0).unwrap().end()..];
        match parse(text, &now, tz) {
            Parsed::At { at, message, seconds } => {
                let title = format!(
                    "{} {}{}",
                    if alarm { "Alarm at" } else { "Remind me at" },
                    when(&at, &now),
                    if message.is_empty() { String::new() } else { format!(": {message}") }
                );
                // A duration counts from Enter (--in), a clock time is a time (--at).
                let (name, arg) = match seconds {
                    Some(s) => (if alarm { "alarm_in" } else { "remind_in" }, s.to_string()),
                    None => (
                        if alarm { "alarm_at" } else { "remind_at" },
                        js_round(at.timestamp().as_millisecond() as f64 / 1000.0).to_string(),
                    ),
                };
                // Its words say "in 10 min" and "at 14:05": good for a second.
                Answer {
                    rows: vec![Row {
                        title,
                        subtitle: format!(
                            "{} · Enter sets it{}",
                            until(&at, &now),
                            if alarm { " · with a sound" } else { "" }
                        ),
                        score: 98.0,
                        run: Some(json!({ "kind": "action", "name": name, "args": [arg], "input": message })),
                        ..Default::default()
                    }],
                    ttl_ms: Some(1000),
                }
            }
            Parsed::Past => vec![note("That time has passed today", "Try tomorrow, or a later time", 98.0)].into(),
            Parsed::Missing => {
                vec![note("When? Add a time", "10m · 1h30m · 3pm · tomorrow 9am · friday noon", 98.0)].into()
            }
            Parsed::Nothing => {
                // Just "remind": what's set, from Omarchy's own list.
                let set = ctx.load("list").map(|l| listed(&l.text)).unwrap_or_default();
                let first = if alarm { "Type a time: alarm 6:45" } else { "Type a time and a message: remind 10m tea" };
                let mut out = vec![note(first, "Reminders", 97.0)];
                for (i, r) in set.iter().enumerate() {
                    let field = |k: &str| r.get(k).filter(|v| truthy(v)).map(text_of);
                    out.push(Row {
                        title: field("label").unwrap_or_else(|| "Reminder".into()),
                        subtitle: format!(
                            "at {} · in {} · Shift+Enter cancels",
                            field("atTime").unwrap_or_default(),
                            field("remaining").unwrap_or_default()
                        ),
                        score: 96.0 - i as f64 * 0.001,
                        copy: field("message").or_else(|| field("label")).unwrap_or_default(),
                        alt: Some(json!({ "kind": "action", "name": "cancel", "args": [text_of(&r["timer"])] })),
                        ..Default::default()
                    });
                }
                out.into()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As of a time on the wall in a zone.
    fn at(zone: &str, y: i16, mo: i8, d: i8, h: i8, mi: i8, q: &str) -> Vec<Row> {
        let tz = TimeZone::get(zone).unwrap();
        let now = jiff::civil::date(y, mo, d).at(h, mi, 0, 0).to_zoned(tz.clone()).unwrap().timestamp();
        let data = crate::Data::new();
        Remind.matches(q, &Context::new(&Value::Null, now, tz, &data)).rows
    }

    fn colombo(q: &str) -> Vec<Row> {
        // Wednesday 23 Sep 2026, 14:00.
        at("Asia/Colombo", 2026, 9, 23, 14, 0, q)
    }

    #[test]
    fn durations_and_clock_times() {
        let r = colombo("remind 10m take out the laundry");
        assert_eq!(r[0].title, "Remind me at 14:10: take out the laundry");
        assert_eq!(r[0].subtitle, "in 10 min · Enter sets it");
        assert_eq!(
            r[0].run,
            Some(json!({ "kind": "action", "name": "remind_in", "args": ["600"], "input": "take out the laundry" }))
        );
        assert_eq!(colombo("remind me to call mom at 3pm")[0].title, "Remind me at 15:00: call mom");
        assert_eq!(colombo("remind me to call mom at 1pm")[0].title, "Remind me at 13:00 tomorrow: call mom");
        assert_eq!(colombo("!remindme tomorrow 9am dentist")[0].title, "Remind me at 9:00 tomorrow: dentist");
        assert_eq!(colombo("remind 20 tea")[0].title, "Remind me at 14:20: tea");
        assert_eq!(colombo("remind at 7 call")[0].title, "Remind me at 19:00: call");
        assert_eq!(colombo("alarm 6:45")[0].title, "Alarm at 6:45 tomorrow");
        assert_eq!(colombo("remind friday noon lunch")[0].title, "Remind me at 12:00 Fri 25 Sep: lunch");
        assert_eq!(colombo("remind wednesday 9am x")[0].title, "Remind me at 9:00 Wed 30 Sep: x");
        assert_eq!(colombo("remind buy 2 eggs at 5pm")[0].title, "Remind me at 17:00: buy 2 eggs");
        let alarm = &colombo("alarm 6:45")[0];
        assert_eq!(alarm.run.as_ref().unwrap()["name"], "alarm_at");
        assert_eq!(alarm.subtitle, "in 16 h 45 min · Enter sets it · with a sound");
    }

    #[test]
    fn notes_and_the_list() {
        assert_eq!(colombo("remind today 9am x")[0].title, "That time has passed today");
        assert_eq!(colombo("remind tea")[0].title, "When? Add a time");
        assert_eq!(colombo("remind ")[0].title, "Type a time and a message: remind 10m tea");
        assert_eq!(colombo("alarm")[0].title, "Type a time: alarm 6:45");
        assert!(colombo("alarm clock").is_empty());
        assert!(colombo("wake on lan").is_empty());
        assert!(colombo("reminders").is_empty());
    }

    #[test]
    fn a_time_across_a_clock_change_is_the_one_on_the_wall() {
        // Saturday 7 Mar 2026, 22:00 in New York; clocks go forward at 2:00 on Sunday.
        let r = at("America/New_York", 2026, 3, 7, 22, 0, "remind tomorrow 9am x");
        assert_eq!(r[0].title, "Remind me at 9:00 tomorrow: x");
        assert_eq!(r[0].subtitle, "in 10 h · Enter sets it");
        // 2:30 doesn't exist that night; it's 3:30.
        assert_eq!(
            at("America/New_York", 2026, 3, 7, 22, 0, "remind tomorrow 2:30am x")[0].title,
            "Remind me at 3:30 tomorrow: x"
        );
    }

    #[test]
    fn durations_too_long_to_count() {
        for q in ["remind 3000000000000000h x", "remind 18446744073709552s x", "remind 400d x"] {
            assert!(colombo(q).first().is_none_or(|r| r.run.is_none()), "{q}");
        }
    }
}
