//! Clipboard history, from the file Omarchy's clipboard plugin keeps. A port
//! of extensions/clipboard/provider.js.
//!
//!   cb            every entry, pinned ones first
//!   cb invoice    entries containing "invoice"
//!
//! The file is the manifest's "history" load: the bar reads it the first time
//! "cb " is typed after it opens, once, and drops it (here too) when it
//! closes. Nothing here writes it. Enter pastes the entry as listed, Shift+
//! Enter copies it; images go through Omarchy's paste script, the manifest's
//! "paste_file" and "copy_file" actions, which take only the type and path.

use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::apps::each;
use crate::{Answer, Context, Extension, Memo, Row};

const LIMIT: usize = 50;
const PREVIEW: usize = 160;
/// A huge paste is searched by its start only.
const SEARCH: usize = 8192;

static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:cb|clip)\s(.*)$").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

#[derive(Deserialize, Debug, Clone)]
pub struct Entry {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    mime: Option<String>,
    #[serde(rename = "capturedAt", default)]
    captured_at: Value,
    #[serde(rename = "addedAt", default)]
    added_at: Value,
    #[serde(default)]
    pinned: Value,
}

impl Entry {
    fn image(&self) -> bool {
        self.kind == "image"
    }

    fn pinned(&self) -> bool {
        truthy(&self.pinned)
    }

    fn captured(&self) -> String {
        match &self.captured_at {
            Value::String(s) => s.clone(),
            Value::Number(n) if n.as_f64() != Some(0.0) => n.to_string(),
            Value::Bool(true) => "true".into(),
            _ => String::new(),
        }
    }

    fn mime(&self) -> &str {
        self.mime.as_deref().filter(|m| !m.is_empty()).unwrap_or("")
    }
}

/// JavaScript's idea of true, for the fields the clipboard plugin writes.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
        Value::Null => false,
    }
}

/// The entries the bar can show: text with its text, an image with an
/// absolute path. Others, and a file that isn't a list, are left out.
pub fn parse(text: &str) -> Vec<Entry> {
    let Ok(list) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    each::<Entry>(&list)
        .into_iter()
        .filter(|e| match e.kind.as_str() {
            "text" => e.text.is_some(),
            "image" => e.path.as_deref().is_some_and(|p| p.starts_with('/')),
            _ => false,
        })
        .collect()
}

/// The start of a text, at most `units` UTF-16 code units (as JavaScript's
/// slice counts), never splitting a character.
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

fn preview(text: &str) -> String {
    let t = SPACES.replace_all(head(text, PREVIEW * 2), " ").trim().to_string();
    if t.encode_utf16().count() > PREVIEW { format!("{}…", head(&t, PREVIEW)) } else { t }
}

pub(crate) fn ago(ms: f64, now: f64) -> String {
    if ms == 0.0 || ms.is_nan() {
        return String::new();
    }
    let s = ((now - ms) / 1000.0).round().max(0.0);
    if s < 60.0 {
        "just now".into()
    } else if s < 3600.0 {
        format!("{} min ago", (s / 60.0).floor())
    } else if s < 86400.0 {
        format!("{} h ago", (s / 3600.0).floor())
    } else {
        format!("{} d ago", (s / 86400.0).floor())
    }
}

fn row(e: &Entry, now: f64, n: usize) -> Row {
    let image = e.image();
    let when = ago(e.added_at.as_f64().unwrap_or(0.0), now);
    let text = e.text.as_deref().unwrap_or("");
    let lines = if image { 0 } else { text.split('\n').count() };
    let what = if image {
        if e.mime().is_empty() { "image".to_string() } else { e.mime().to_string() }
    } else if lines > 1 {
        format!("{lines} lines")
    } else {
        String::new()
    };
    let about = [if e.pinned() { "Pinned".to_string() } else { String::new() }, when, what]
        .into_iter()
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    let captured = e.captured();
    let path = e.path.clone().unwrap_or_default();
    let mime = if e.mime().is_empty() { "image/png" } else { e.mime() };
    Row {
        title: if image {
            if captured.is_empty() { "Image".into() } else { format!("Image from {captured}") }
        } else {
            preview(text)
        },
        subtitle: about,
        icon: (if e.pinned() {
            "󰐃"
        } else if image {
            "󰋩"
        } else {
            "󰅍"
        })
        .into(),
        image: image.then(|| path.clone()),
        score: 97.0 - n as f64 * 0.001,
        group: Some(if e.pinned() { "Pinned" } else { "Clipboard" }.into()),
        run: Some(if image {
            json!({ "kind": "action", "name": "paste_file", "args": [mime, path] })
        } else {
            json!({ "kind": "paste", "target": text, "label": "paste" })
        }),
        alt: Some(if image {
            json!({ "kind": "action", "name": "copy_file", "args": [mime, path] })
        } else {
            json!({ "kind": "copy", "target": text, "label": "copy" })
        }),
        ..Default::default()
    }
}

fn note(title: String) -> Row {
    Row { title, subtitle: "Clipboard".into(), score: 40.0, ..Default::default() }
}

static HISTORY: Memo<Vec<Entry>> = Memo::new();

pub struct Clipboard;

impl Extension for Clipboard {
    fn id(&self) -> &'static str {
        "clipboard"
    }

    fn forget(&self, _load: &str) {
        HISTORY.forget();
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let Some(m) = MODE.captures(query) else { return Answer::default() };
        let needle = m.get(1).map_or("", |x| x.as_str()).trim().to_lowercase();
        let Some(load) = ctx.load("history") else {
            return vec![note("Reading the clipboard history…".into())].into();
        };
        let history = HISTORY.get(load, parse);
        let found = |e: &&Entry| {
            needle.is_empty() || {
                let hay = if e.image() {
                    format!("image screenshot {}", e.captured())
                } else {
                    head(e.text.as_deref().unwrap_or(""), SEARCH).to_string()
                };
                hay.to_lowercase().contains(&needle)
            }
        };
        let (pinned, rest): (Vec<&Entry>, Vec<&Entry>) = history.iter().filter(found).partition(|e| e.pinned());
        let now = ctx.now.as_millisecond() as f64;
        let rows: Vec<Row> =
            pinned.into_iter().chain(rest).take(LIMIT).enumerate().map(|(n, e)| row(e, now, n)).collect();
        if rows.is_empty() {
            let title = if needle.is_empty() {
                "The clipboard history is empty".to_string()
            } else {
                format!("Nothing copied matches \"{needle}\"")
            };
            return vec![note(title)].into();
        }
        rows.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Load, Loads};

    fn ask(q: &str, history: Option<&str>) -> Vec<Row> {
        let mut loads = Loads::new();
        if let Some(text) = history {
            // Every text a new generation, as punctumd gives them.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
            let generation = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            loads.insert(("clipboard".into(), "history".into()), Load { text: text.into(), generation });
        }
        let data = crate::Data::new();
        let now = jiff::Timestamp::from_millisecond(1_800_000_000_000).unwrap();
        let ctx = Context::with_loads(&Value::Null, now, jiff::tz::TimeZone::UTC, &data, "clipboard", &loads);
        Clipboard.matches(q, &ctx).rows
    }

    const HISTORY_JSON: &str = r#"[
        {"type": "text", "text": "invoice 42\nsecond line", "addedAt": 1799999990000},
        {"type": "image", "path": "/tmp/shot.png", "mime": "image/png", "capturedAt": "2026-10-10 09:00", "addedAt": 1799990000000},
        {"type": "text", "text": "pinned thing", "pinned": true, "addedAt": 1790000000000},
        {"type": "image", "path": "relative.png"},
        {"type": "text", "text": 5},
        "junk"
    ]"#;

    #[test]
    fn pinned_first_then_newest() {
        let rows = ask("cb ", Some(HISTORY_JSON));
        let titles: Vec<_> = rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["pinned thing", "invoice 42 second line", "Image from 2026-10-10 09:00"]);
        assert_eq!(rows[0].subtitle, "Pinned · 115 d ago");
        assert_eq!(rows[1].subtitle, "just now · 2 lines");
        assert_eq!(rows[2].subtitle, "2 h ago · image/png");
        assert_eq!(
            rows[1].run,
            Some(json!({ "kind": "paste", "target": "invoice 42\nsecond line", "label": "paste" }))
        );
        assert_eq!(
            rows[2].run,
            Some(json!({ "kind": "action", "name": "paste_file", "args": ["image/png", "/tmp/shot.png"] }))
        );
    }

    #[test]
    fn searching_and_nothing() {
        assert_eq!(ask("cb INVOICE", Some(HISTORY_JSON))[0].title, "invoice 42 second line");
        assert_eq!(ask("clip screenshot", Some(HISTORY_JSON))[0].title, "Image from 2026-10-10 09:00");
        assert_eq!(ask("cb zzz", Some(HISTORY_JSON))[0].title, "Nothing copied matches \"zzz\"");
        assert_eq!(ask("cb ", Some("not json"))[0].title, "The clipboard history is empty");
        assert_eq!(ask("cb ", None)[0].title, "Reading the clipboard history…");
        assert!(ask("cbx", Some(HISTORY_JSON)).is_empty());
    }

    #[test]
    fn previews_are_cut_by_javascript_length_without_splitting_a_character() {
        let long = "😀".repeat(100);
        let p = preview(&long);
        assert_eq!(p, format!("{}…", "😀".repeat(80)));
    }

    #[test]
    fn closing_the_bar_drops_the_parsed_history_too() {
        assert_eq!(ask("cb secret", Some(r#"[{"type": "text", "text": "secret"}]"#))[0].title, "secret");
        assert!(HISTORY.0.lock().unwrap().is_some());
        let mut state = crate::State::new();
        crate::handle(r#"{"id": 1, "op": "load", "ext": "clipboard", "key": "history", "text": null}"#, &mut state);
        assert!(HISTORY.0.lock().unwrap().is_none());
    }
}
