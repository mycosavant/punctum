//! Switch to an open window. A port of extensions/windows/provider.js.
//!
//!   brave → its open windows, most recently used first, above "open new"
//!   netflix → the window whose title says so
//!   w · w github → every window, or windows matching a filter
//!
//! The bar sends the windows (`op: "data"`, key `windows`: address, cls,
//! title, workspace, focus; focus 0 is the one you're in) and the apps, for
//! each window's name and icon.
//!
//! The JS's rules, scores and order are kept exactly. On top of them, a
//! window whose title has the query's letters in order, from the start of a
//! word ("w omrch" → "Omarchy Rust rewrite"), comes after every window those
//! rules find in `w` mode, and elsewhere ranks below every window and app
//! they find (66).

use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::apps::{App, each, letters_in_order, prefixes_all, rank, words};
use crate::{Answer, Context, Extension, Row};

const LIMIT: usize = 8;
const FUZZY_SCORE: f64 = 66.0;

static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)^\s*w\s(.*)$").unwrap());
static ADDRESS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^0x[0-9a-f]+$").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
struct Window {
    address: String,
    cls: String,
    title: String,
    workspace: Value,
    focus: Option<f64>,
}

impl Window {
    fn focus(&self) -> f64 {
        // A window the bar sent without a focus order counts as the least
        // recent: finite, so sorting and scores stay well-defined.
        self.focus.filter(|f| f.is_finite()).unwrap_or(1e6)
    }
}

/// The desktop entry a window belongs to, for its name and icon.
fn app_for<'a>(win: &Window, apps: &'a [App]) -> Option<&'a App> {
    let cls = win.cls.to_lowercase();
    if let Some(a) =
        apps.iter().find(|a| a.id.to_lowercase() == cls || (!a.wmclass.is_empty() && a.wmclass.to_lowercase() == cls))
    {
        return Some(a);
    }
    // "com.mitchellh.ghostty" ↔ "ghostty": the last dotted part.
    let tail = cls.rsplit('.').next().unwrap_or(&cls).to_string();
    apps.iter().find(|a| a.id.to_lowercase().rsplit('.').next() == Some(tail.as_str()))
}

struct Described<'a> {
    app: Option<&'a App>,
    name: String,
    matchable: App,
}

fn describe<'a>(win: &Window, apps: &'a [App]) -> Described<'a> {
    let app = app_for(win, apps);
    // No desktop entry: "com.mitchellh.ghostty" → "Ghostty".
    let tail = win.cls.rsplit('.').next().unwrap_or(&win.cls);
    let name = match app {
        Some(a) => a.name.clone(),
        None => {
            let mut c = tail.chars();
            c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
        }
    };
    let matchable = App {
        id: win.cls.clone(),
        name: name.clone(),
        generic: app.map(|a| a.generic.clone()).unwrap_or_default(),
        keywords: app.map(|a| a.keywords.clone()).unwrap_or_default(),
        ..Default::default()
    };
    Described { app, name, matchable }
}

fn where_(win: &Window) -> String {
    let ws = match &win.workspace {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        v => v.to_string(),
    };
    if ws.starts_with("special") { "scratchpad".into() } else { format!("workspace {ws}") }
}

fn row(win: &Window, d: &Described, score: f64) -> Row {
    Row {
        title: if win.title.is_empty() { d.name.clone() } else { win.title.clone() },
        subtitle: format!("{} · {}", d.name, where_(win)),
        image: Some(d.app.map(|a| a.icon.clone()).unwrap_or_default()),
        icon: "󰖯".into(),
        score,
        run: Some(json!({ "kind": "window", "target": win.address, "label": "switch" })),
        ..Default::default()
    }
}

pub struct Windows;

impl Extension for Windows {
    fn id(&self) -> &'static str {
        "windows"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        // Only addresses Hyprland gave the bar ever reach the dispatcher.
        let list: Vec<Window> = each::<Window>(ctx.data("windows"))
            .into_iter()
            .filter(|w| ADDRESS.is_match(&w.address) && w.focus != Some(0.0))
            .collect();
        let apps: Vec<App> = each(ctx.data("apps"));
        let mode = MODE.captures(query);
        let raw = mode.as_ref().map_or(query, |m| m.get(1).map_or("", |x| x.as_str()));
        let q = SPACES.replace_all(raw.trim(), " ").to_lowercase();
        let qw = words(&q);

        // "w" / "w filter": windows only, most recently used first.
        if mode.is_some() {
            let mut picked: Vec<(&Window, Described)> = Vec::new();
            let mut fuzzy: Vec<(&Window, Described)> = Vec::new();
            for w in &list {
                let d = describe(w, &apps);
                if q.is_empty() || rank(&d.matchable, &q, &qw) > 0.0 || prefixes_all(&qw, &words(&w.title)) {
                    picked.push((w, d));
                } else if letters_in_order(&w.title, &q).is_some() {
                    fuzzy.push((w, d));
                }
            }
            let by_focus = |a: &(&Window, Described), b: &(&Window, Described)| a.0.focus().total_cmp(&b.0.focus());
            picked.sort_by(by_focus);
            fuzzy.sort_by(by_focus);
            picked.extend(fuzzy);
            if picked.is_empty() {
                let title = if q.is_empty() {
                    "No other windows open".to_string()
                } else {
                    format!("No window matches \"{q}\"")
                };
                return vec![Row { title, subtitle: "Windows".into(), score: 40.0, ..Default::default() }].into();
            }
            return picked
                .iter()
                .take(LIMIT)
                .enumerate()
                .map(|(n, (w, d))| row(w, d, 97.0 - n as f64 * 0.01))
                .collect::<Vec<_>>()
                .into();
        }

        if q.is_empty() || qw.is_empty() {
            return Answer::default();
        }
        let mut out = Vec::new();
        for w in &list {
            let info = describe(w, &apps);
            let r = rank(&info.matchable, &q, &qw);
            // Named by its app: just above that app's own row, so Enter
            // switches and "open new" is one arrow key down. Named by its
            // title ("netflix", "inventory"): below app-name prefixes.
            let score = if r >= 72.0 {
                70.0 + r * 0.2 + 0.7
            } else if q.chars().count() >= 3 && prefixes_all(&qw, &words(&w.title)) {
                84.0
            } else if letters_in_order(&w.title, &q).is_some() {
                FUZZY_SCORE
            } else {
                0.0
            };
            if score > 0.0 {
                out.push(row(w, &info, score - w.focus() * 0.001));
            }
        }
        out.sort_by(|a, b| b.score.total_cmp(&a.score));
        out.truncate(LIMIT);
        out.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The tests/run.js windows and a few of its apps.
    fn data() -> crate::Data {
        let mut d = crate::Data::new();
        d.insert("windows".into(), json!([
            { "address": "0xa1", "cls": "firefox", "title": "Mozilla Firefox", "workspace": "2", "focus": 0 },
            { "address": "0xb1", "cls": "brave-browser", "title": "Netflix - Brave", "workspace": "1", "focus": 1 },
            { "address": "0xb2", "cls": "brave-browser", "title": "GitHub - Brave", "workspace": "3", "focus": 3 },
            { "address": "0xc1", "cls": "org.gnome.Nautilus", "title": "Images", "workspace": "5", "focus": 2 },
            { "address": "0xd1", "cls": "com.mitchellh.ghostty", "title": "~/Code", "workspace": "special:scratch", "focus": 4 },
            { "address": "$(rm -rf ~)", "cls": "evil", "title": "Evil window", "workspace": "1", "focus": 5 },
            { "address": "0xe1", "cls": "com.mitchellh.ghostty", "title": "Omarchy Rust rewrite", "workspace": 2, "focus": 6 }
        ]));
        d.insert("apps".into(), json!([
            { "id": "brave-browser", "name": "Brave", "generic": "Web Browser", "icon": "brave-browser" },
            { "id": "org.gnome.Nautilus", "name": "Files", "generic": "File Manager", "keywords": ["folder"], "icon": "nautilus" }
        ]));
        d
    }

    fn rows(q: &str) -> Vec<Row> {
        let d = data();
        let ctx = Context::new(&Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &d);
        Windows.matches(q, &ctx).rows
    }

    fn titles(q: &str) -> Vec<String> {
        rows(q).into_iter().map(|r| r.title).collect()
    }

    #[test]
    fn the_js_rules() {
        assert_eq!(titles("w git"), ["GitHub - Brave"]);
        assert_eq!(titles("w zzz"), ["No window matches \"zzz\""]);
        assert_eq!(titles("w "), ["Netflix - Brave", "Images", "GitHub - Brave", "~/Code", "Omarchy Rust rewrite"]);
        assert_eq!(titles("brave"), ["Netflix - Brave", "GitHub - Brave"]);
        assert_eq!(titles("netflix"), ["Netflix - Brave"]);
        assert_eq!(rows("files")[0].subtitle, "Files · workspace 5");
        assert_eq!(rows("w code")[0].subtitle, "Ghostty · scratchpad");
        assert!(!titles("w ").iter().any(|t| t.contains("Evil") || t.contains("Mozilla")));
    }

    #[test]
    fn letters_in_order_come_after() {
        assert_eq!(titles("w omrch"), ["Omarchy Rust rewrite"]);
        assert_eq!(titles("omrch"), ["Omarchy Rust rewrite"]);
        assert_eq!(rows("omrch")[0].score, 66.0 - 6.0 * 0.001);
        assert_eq!(rows("w omrch")[0].subtitle, "Ghostty · workspace 2");
        // Letters from words far apart don't count.
        assert!(titles("w ocrw").is_empty() || titles("w ocrw")[0].starts_with("No window"));
    }
}
