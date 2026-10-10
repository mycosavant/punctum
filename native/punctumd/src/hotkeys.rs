//! Omarchy's keybindings, findable by what they do, with the keys next to
//! them. A port of extensions/hotkeys/provider.js.
//!
//!   full screen      → Full screen · Super + F
//!   keys             every binding, in Super+K's order
//!   keys screenshot  bindings about screenshots
//!
//! The list comes from `omarchy-menu-keybindings`, the script behind
//! Super+K, as its cached records: the manifest's "binds" load, which the bar
//! runs and re-reads every 30 s. One record per line:
//!
//!   "SUPER + F            → Full screen\tlua\thl.dsp.window.fullscreen(…)"
//!
//! Enter is the manifest's "dispatch" action: the same script's
//! dispatch_binding, with the dispatcher and its argument as separate argv
//! entries; no shell parses them. In "keys" mode a label with the query's
//! letters in order ("fllscr") is listed after the bindings the rules find.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;

use crate::apps::{letters_in_order, prefixes_all, words};
use crate::{Answer, Context, Extension, Memo, Row};

const ARROW: &str = " → ";
const ROOT_LIMIT: usize = 3;
const LIMIT: usize = 60;
const ICON: &str = "󰌌";

static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*keys\s(.*)$").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static PLUS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\+\s*").unwrap());
static PLAIN_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]$|^F[0-9]{1,2}$").unwrap());
static CAMEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([a-z])([A-Z])").unwrap());

#[derive(Debug, Clone, PartialEq)]
pub struct Bind {
    pub label: String,
    pub combos: Vec<String>,
    pub dispatcher: String,
    pub arg: String,
    pub order: usize,
}

/// The records, one bind per action: the same action on two keys is one
/// bind listing both.
pub fn parse(text: &str) -> Vec<Bind> {
    let mut binds: Vec<Bind> = Vec::new();
    let mut by_action: HashMap<(String, String, String), usize> = HashMap::new();
    for line in text.split('\n') {
        let fields: Vec<&str> = line.split('\t').collect();
        let Some(at) = fields[0].find(ARROW) else { continue };
        let combo = SPACES.replace_all(fields[0][..at].trim(), " ").into_owned();
        let label = fields[0][at + ARROW.len()..].trim().to_string();
        if combo.is_empty() || label.is_empty() {
            continue;
        }
        let dispatcher = fields.get(1).map_or("", |d| d.trim()).to_string();
        let arg = if fields.len() > 2 { fields[2..].join("\t").trim().to_string() } else { String::new() };
        let k = (label.clone(), dispatcher.clone(), arg.clone());
        if let Some(&i) = by_action.get(&k) {
            if !binds[i].combos.contains(&combo) {
                binds[i].combos.push(combo);
            }
            continue;
        }
        by_action.insert(k, binds.len());
        binds.push(Bind { label, combos: vec![combo], dispatcher, arg, order: binds.len() });
    }
    binds
}

fn modifier(m: &str) -> Option<&'static str> {
    Some(match m.to_uppercase().as_str() {
        "SUPER" => "Super",
        "SHIFT" => "Shift",
        "CTRL" => "Ctrl",
        "ALT" => "Alt",
        _ => return None,
    })
}

fn named_key(upper: &str) -> Option<&'static str> {
    Some(match upper {
        "RETURN" | "ENTER" => "↵",
        "SPACE" => "Space",
        "ESCAPE" => "Esc",
        "TAB" => "Tab",
        "BACKSPACE" => "⌫",
        "DELETE" => "Del",
        "PRINT" => "Print",
        "HOME" => "Home",
        "END" => "End",
        "LEFT" => "←",
        "RIGHT" => "→",
        "UP" => "↑",
        "DOWN" => "↓",
        "COMMA" => ",",
        "PERIOD" => ".",
        "MINUS" => "-",
        "EQUAL" => "=",
        "SLASH" => "/",
        "BACKSLASH" => "\\",
        "GRAVE" => "`",
        _ => return None,
    })
}

fn key_name(raw: &str) -> String {
    let key = raw.trim();
    let upper = key.to_uppercase();
    if let Some(k) = named_key(&upper) {
        return k.to_string();
    }
    if let Some(rest) = key.strip_prefix("XF86") {
        return CAMEL.replace_all(rest, "$1 $2").into_owned();
    }
    if PLAIN_KEY.is_match(&upper) {
        return upper;
    }
    if upper == key && key.chars().count() > 1 {
        let mut chars = key.chars();
        let first = chars.next().unwrap();
        return first.to_string() + &chars.as_str().to_lowercase();
    }
    key.to_string()
}

/// "SUPER SHIFT + RETURN" → "Super + Shift + ↵"
fn keys(combo: &str) -> String {
    let (mods, key) = match combo.rfind(" + ") {
        Some(plus) => (&combo[..plus], &combo[plus + 3..]),
        None => ("", combo),
    };
    let mut parts: Vec<String> =
        mods.split_whitespace().map(|m| modifier(m).map_or_else(|| key_name(m), str::to_string)).collect();
    parts.push(key_name(key));
    parts.join(" + ")
}

fn combo_words(bind: &Bind) -> String {
    bind.combos.iter().map(|c| PLUS.replace_all(&c.to_lowercase(), " ").into_owned()).collect::<Vec<_>>().join(" ")
}

/// How well the query names this bind: by its label, its keys ("super f"),
/// or the command it runs ("screenshot" → omarchy-capture-screenshot).
fn rank(bind: &Bind, q: &str, qw: &[String]) -> f64 {
    let label = bind.label.to_lowercase();
    if label == q {
        return 3.0;
    }
    if label.starts_with(q) || prefixes_all(qw, &words(&bind.label)) {
        return 2.0;
    }
    let joined = qw.join(" ");
    for c in &bind.combos {
        if SPACES.replace_all(&PLUS.replace_all(&c.to_lowercase(), " "), " ") == joined {
            return 2.5;
        }
    }
    let command = if bind.dispatcher == "exec" { bind.arg.as_str() } else { "" };
    if prefixes_all(qw, &words(&format!("{} {} {}", bind.label, combo_words(bind), command))) {
        return 1.0;
    }
    0.0
}

fn row(bind: &Bind, score: f64) -> Row {
    let shown = bind.combos.iter().map(|c| keys(c)).collect::<Vec<_>>().join("  ·  ");
    let runnable = !bind.dispatcher.is_empty();
    Row {
        title: bind.label.clone(),
        subtitle: if runnable { shown } else { shown + " · only from the keyboard" },
        icon: ICON.into(),
        score,
        group: Some("Hotkeys".into()),
        run: runnable.then(|| json!({ "kind": "action", "name": "dispatch", "args": [bind.dispatcher, bind.arg] })),
        ..Default::default()
    }
}

fn note(title: String, score: f64) -> Row {
    Row { title, subtitle: "Hotkeys".into(), score, ..Default::default() }
}

/// The query with a lone "+" dropped, as typed between keys: "super + f".
fn tidy(raw: &str) -> String {
    let q = SPACES.replace_all(raw.trim(), " ").to_lowercase();
    q.split(' ').map(|t| if t == "+" { "" } else { t }).collect::<Vec<_>>().join(" ").trim().to_string()
}

static BINDS: Memo<Vec<Bind>> = Memo::new();

pub struct Hotkeys;

impl Extension for Hotkeys {
    fn id(&self) -> &'static str {
        "hotkeys"
    }

    fn forget(&self, _load: &str) {
        BINDS.forget();
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let binds = ctx.load("binds").map(|l| BINDS.get(l, parse)).unwrap_or_default();
        let mode = MODE.captures(query);
        let q = tidy(mode.as_ref().map_or(query, |m| m.get(1).map_or("", |x| x.as_str())));
        let qw = words(&q);

        if mode.is_some() {
            if binds.is_empty() {
                return vec![note("Reading keybindings…".into(), 40.0)].into();
            }
            let mut out: Vec<Row> = Vec::new();
            let mut rest: Vec<(u32, &Bind)> = Vec::new();
            for b in binds.iter() {
                if q.is_empty() || rank(b, &q, &qw) > 0.0 {
                    if out.len() < LIMIT {
                        out.push(row(b, 97.0 - out.len() as f64 * 0.001));
                    }
                } else if let Some(s) = letters_in_order(&b.label, &q) {
                    rest.push((s, b));
                }
            }
            rest.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.order.cmp(&b.1.order)));
            for (_, b) in rest {
                if out.len() >= LIMIT {
                    break;
                }
                out.push(row(b, 97.0 - out.len() as f64 * 0.001));
            }
            if out.is_empty() {
                return vec![note(format!("No keybinding matches \"{q}\""), 40.0)].into();
            }
            return out.into();
        }

        // Mixed into ordinary results: a few runnable ones, under apps.
        if q.encode_utf16().count() < 3 || qw.is_empty() {
            return Answer::default();
        }
        let mut hits: Vec<(f64, &Bind)> = binds
            .iter()
            .filter(|b| !b.dispatcher.is_empty())
            .map(|b| (rank(b, &q, &qw), b))
            .filter(|(r, _)| *r >= 2.0)
            .collect();
        hits.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.order.cmp(&b.1.order)));
        hits.iter()
            .take(ROOT_LIMIT)
            .enumerate()
            .map(|(n, (r, b))| row(b, 66.0 + r - n as f64 * 0.01))
            .collect::<Vec<_>>()
            .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Load, Loads};

    const RECORDS: &str = "SUPER + F            → Full screen\tlua\thl.dsp.window.fullscreen(0)\n\
        SUPER + RETURN       → Terminal\texec\tuwsm-app -- xdg-terminal-exec\n\
        SUPER SHIFT + RETURN → Terminal\texec\tuwsm-app -- xdg-terminal-exec\n\
        PRINT                → Screenshot\texec\tomarchy-capture-screenshot\n\
        SUPER + XF86AudioMute → Mute\texec\twpctl set-mute\n\
        SUPER + W            → Close window\n\
        not a record\n";

    fn ask(q: &str) -> (Vec<Row>, Vec<String>) {
        let mut loads = Loads::new();
        loads.insert(("hotkeys".into(), "binds".into()), Load { text: RECORDS.into(), generation: 1 });
        let data = crate::Data::new();
        let ctx = Context::with_loads(
            &serde_json::Value::Null,
            jiff::Timestamp::now(),
            jiff::tz::TimeZone::UTC,
            &data,
            "hotkeys",
            &loads,
        );
        let rows = Hotkeys.matches(q, &ctx).rows;
        (rows, ctx.needs.take())
    }

    #[test]
    fn one_row_per_action_with_its_keys() {
        let (rows, needs) = ask("keys ");
        assert_eq!(needs, ["binds"]);
        let titles: Vec<_> = rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["Full screen", "Terminal", "Screenshot", "Mute", "Close window"]);
        assert_eq!(rows[1].subtitle, "Super + ↵  ·  Super + Shift + ↵");
        assert_eq!(rows[3].subtitle, "Super + Audio Mute");
        assert_eq!(rows[4].subtitle, "Super + W · only from the keyboard");
        assert!(rows[4].run.is_none());
        assert_eq!(
            rows[0].run,
            Some(json!({ "kind": "action", "name": "dispatch", "args": ["lua", "hl.dsp.window.fullscreen(0)"] }))
        );
    }

    #[test]
    fn by_label_keys_or_command() {
        assert_eq!(ask("full screen").0[0].title, "Full screen");
        assert_eq!(ask("keys super + f").0[0].title, "Full screen");
        assert_eq!(ask("keys capture").0[0].title, "Screenshot");
        assert!(ask("fu").0.is_empty());
        assert_eq!(ask("keys fllscr").0[0].title, "Full screen");
        assert_eq!(ask("keys zzz").0[0].title, "No keybinding matches \"zzz\"");
    }

    #[test]
    fn asks_for_the_list_until_it_has_it() {
        let data = crate::Data::new();
        let ctx = Context::new(&serde_json::Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &data);
        assert_eq!(Hotkeys.matches("keys ", &ctx).rows[0].title, "Reading keybindings…");
        assert_eq!(ctx.needs.take(), ["binds"]);
    }
}
