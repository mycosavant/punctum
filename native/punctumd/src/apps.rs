//! Launch installed applications. A port of extensions/apps/provider.js and
//! the app ranking in lib/Match.js, with nucleo (Helix's fuzzy matcher)
//! finding what those rules can't.
//!
//!   firefox · term · vsc (acronym) · brave new window · frfx (letters in order)
//!
//! The bar sends the shell's state with `op: "data"`: `apps` (the visible
//! desktop entries: id, name, generic, comment, keywords, icon, wmclass,
//! actions), `launches` (id → times launched from the bar), `pinned` (ids, in
//! your order) and `windows` (to say "open new" for a running app).
//!
//! The JS's ranks, scores and order are kept exactly. On top of them, a name
//! whose letters the query has in order, starting at a word ("frfx" →
//! Firefox, "spfy" → Spotify), ranks below every one of them, so it only
//! fills places the old rules left empty.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Answer, Context, Extension, Row};

const LIMIT: usize = 6;
const ACTIONS: usize = 3;
/// Below the JS's lowest rank (65) by more than habit and a pin can add (5).
const FUZZY_RANK: f64 = 55.0;

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct App {
    pub id: String,
    pub name: String,
    pub generic: String,
    pub comment: String,
    pub keywords: Vec<String>,
    pub icon: String,
    pub wmclass: String,
    pub actions: Vec<AppAction>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct AppAction {
    pub index: i64,
    pub name: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Window {
    pub cls: String,
}

static WINDOWS_MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*w\s").unwrap());
static CAMEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([a-z0-9])([A-Z])").unwrap());
static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

thread_local! {
    static MATCHER: RefCell<Matcher> = RefCell::new(Matcher::new(Config::DEFAULT));
}

/// "VSCodium" → ["vs", "codium"], "org.gnome.Nautilus" → ["org", "gnome", "nautilus"]
pub fn words(text: &str) -> Vec<String> {
    let spaced = CAMEL.replace_all(text, "$1 $2").to_lowercase();
    SPLIT.split(&spaced).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// Every query word starts some word of the haystack.
pub fn prefixes_all(query: &[String], hay: &[String]) -> bool {
    query.iter().all(|q| hay.iter().any(|h| h.starts_with(q.as_str())))
}

/// How well the query names this app, best first; 0 means no match.
pub(crate) fn rank(app: &App, q: &str, qw: &[String]) -> f64 {
    // A query with no letters (2+2, 15%) is arithmetic, never an app name.
    if !q.bytes().any(|b| b.is_ascii_alphabetic()) {
        return 0.0;
    }
    let name = app.name.to_lowercase();
    if name == q {
        return 100.0;
    }
    if name.starts_with(q) {
        return 90.0;
    }
    let name_words = words(&app.name);
    if app.id.to_lowercase() == q {
        return 88.0;
    }
    if prefixes_all(qw, &name_words) {
        return 85.0;
    }
    if q.chars().count() >= 2 && qw.len() == 1 && name_words.len() > 1 {
        let initials: String = name_words.iter().filter_map(|w| w.chars().next()).collect();
        if initials.starts_with(q) {
            return 80.0;
        }
    }
    if q.chars().count() >= 3 && name.contains(q) {
        return 75.0;
    }
    if prefixes_all(qw, &words(&app.id)) {
        return 72.0;
    }
    if prefixes_all(qw, &words(&format!("{} {}", app.generic, app.keywords.join(" ")))) {
        return 65.0;
    }
    0.0
}

/// The name's letters in the query's order, the first at the start of a
/// word; nucleo's score for it, or None.
fn fuzzy(app: &App, q: &str) -> Option<u32> {
    letters_in_order(&app.name, q)
}

/// The text's letters in the query's order, the first at the start of a
/// word, all of them close together (spanning at most twice the query's
/// length and two), and a letter in a later word only that word's first: so
/// "frfx" finds Firefox and "fllscrn" Full screen, but "ima" doesn't stitch
/// together "Inbox - Proton Mail" nor "men" "Move window". nucleo's score
/// for it, or None. Needs three characters and a letter.
pub(crate) fn letters_in_order(text: &str, q: &str) -> Option<u32> {
    if q.chars().count() < 3 || !q.bytes().any(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let pattern = Pattern::new(q, CaseMatching::Ignore, Normalization::Smart, AtomKind::Fuzzy);
    let chars: Vec<char> = text.chars().collect();
    let mut buf = Vec::new();
    let mut indices = Vec::new();
    let score = MATCHER.with(|m| pattern.indices(Utf32Str::new(text, &mut buf), &mut m.borrow_mut(), &mut indices))?;
    indices.sort_unstable();
    indices.dedup();
    let first = *indices.first()? as usize;
    let last = *indices.last()? as usize;
    if last - first + 1 > 2 * q.chars().count() + 2 {
        return None;
    }
    let starts_word = |i: usize| {
        i == 0 || !chars[i - 1].is_alphanumeric() || (chars[i - 1].is_lowercase() && chars[i].is_uppercase())
    };
    if !starts_word(first) {
        return None;
    }
    // Each next letter is in the same word as the one before, or starts one.
    let same_word = |a: usize, b: usize| (a + 1..=b).all(|i| !starts_word(i));
    indices.windows(2).all(|w| starts_word(w[1] as usize) || same_word(w[0] as usize, w[1] as usize)).then_some(score)
}

/// A launch history nudge: never enough to beat a better match, only to order
/// equally good ones ("f" → the Firefox you use over Files).
fn habit(count: f64) -> f64 {
    if count > 0.0 { (3.0f64).min((1.0 + count).ln() / std::f64::consts::LN_2 * 0.75) } else { 0.0 }
}

// Names that rank the same are ordered as JavaScript's localeCompare orders
// them: Unicode collation (ICU4X's root collator), so "Éditeur" sorts with
// the Es and case comes after letters.
static COLLATOR: LazyLock<icu_collator::CollatorBorrowed<'static>> = LazyLock::new(|| {
    icu_collator::CollatorBorrowed::try_new(Default::default(), Default::default()).expect("root collation is built in")
});

fn locale_cmp(a: &str, b: &str) -> Ordering {
    COLLATOR.compare(a, b)
}

fn label(app: &App) -> &str {
    if !app.generic.is_empty() {
        &app.generic
    } else if !app.comment.is_empty() {
        &app.comment
    } else {
        "Application"
    }
}

fn open(app: &App, action: Option<i64>, label: &str) -> Value {
    match action {
        Some(i) => json!({ "kind": "app", "target": app.id, "action": i, "label": label }),
        None => json!({ "kind": "app", "target": app.id, "label": label }),
    }
}

struct State {
    apps: Vec<App>,
    launches: HashMap<String, f64>,
    pinned: Vec<String>,
    running: HashSet<String>,
}

/// Each entry of a list that reads as T; one that doesn't is skipped, not
/// the whole list.
pub(crate) fn each<T: serde::de::DeserializeOwned>(v: &Value) -> Vec<T> {
    v.as_array().map(|a| a.iter().filter_map(|x| serde_json::from_value(x.clone()).ok()).collect()).unwrap_or_default()
}

fn state(ctx: &Context) -> State {
    let apps: Vec<App> = each(ctx.data("apps"));
    let launches = ctx
        .data("launches")
        .as_object()
        .map(|o| o.iter().filter_map(|(k, v)| v.as_f64().map(|n| (k.clone(), n))).collect())
        .unwrap_or_default();
    let pinned: Vec<String> = each(ctx.data("pinned"));
    let windows: Vec<Window> = each(ctx.data("windows"));
    let running = windows.iter().map(|w| w.cls.to_lowercase()).collect();
    State { apps, launches, pinned, running }
}

impl State {
    // Apps with a window open say "open new": Enter on their window row (from
    // the windows extension, ranked just above) switches instead.
    fn is_running(&self, app: &App) -> bool {
        let id = app.id.to_lowercase();
        self.running.contains(&id)
            || (!app.wmclass.is_empty() && self.running.contains(&app.wmclass.to_lowercase()))
            || self.running.contains(id.rsplit('.').next().unwrap_or(&id))
    }
}

/// Pinned apps are what an empty bar lists, so Alt+1 … Alt+9 launch them
/// straight from the hotkey.
fn pinned_rows(st: &State) -> Vec<Row> {
    st.pinned
        .iter()
        .filter_map(|id| st.apps.iter().find(|a| &a.id == id))
        .map(|app| Row {
            title: app.name.clone(),
            subtitle: label(app).to_string(),
            image: Some(app.icon.clone()),
            group: Some("Pinned".into()),
            app_id: Some(app.id.clone()),
            pinned: true,
            run: Some(open(app, None, "open")),
            ..Default::default()
        })
        .collect()
}

struct Hit<'a> {
    app: &'a App,
    r: f64,
    h: f64,
    fuzzy: u32,
}

pub struct Apps;

impl Extension for Apps {
    fn id(&self) -> &'static str {
        "apps"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let st = state(ctx);
        // The empty query is the empty bar's list.
        if query.is_empty() {
            return pinned_rows(&st).into();
        }
        if WINDOWS_MODE.is_match(query) {
            return Answer::default(); // "w …" is the windows-only mode
        }
        let q = SPACES.replace_all(query.trim(), " ").to_lowercase();
        if q.is_empty() || st.apps.is_empty() {
            return Answer::default();
        }
        let qw = words(&q);
        if qw.is_empty() {
            return Answer::default();
        }
        let pinned: HashSet<&str> = st.pinned.iter().map(String::as_str).collect();

        let mut hits: Vec<Hit> = Vec::new();
        for app in &st.apps {
            let h = habit(st.launches.get(&app.id).copied().unwrap_or(0.0))
                + if pinned.contains(app.id.as_str()) { 2.0 } else { 0.0 };
            let r = rank(app, &q, &qw);
            if r > 0.0 {
                hits.push(Hit { app, r, h, fuzzy: 0 });
            } else if let Some(score) = fuzzy(app, &q) {
                hits.push(Hit { app, r: FUZZY_RANK, h, fuzzy: score });
            }
        }

        // "brave new window": the app's name then one of its actions.
        let mut action_hits: Vec<(&App, &AppAction)> = Vec::new();
        if qw.len() > 1 {
            for app in &st.apps {
                let name_words = words(&app.name);
                let mut lead = 0;
                while lead < qw.len() && lead < name_words.len() && name_words[lead].starts_with(qw[lead].as_str()) {
                    lead += 1;
                }
                if lead == 0 || lead == qw.len() {
                    continue;
                }
                for action in &app.actions {
                    if prefixes_all(&qw[lead..], &words(&action.name)) {
                        action_hits.push((app, action));
                    }
                }
            }
        }

        hits.sort_by(|x, y| {
            (y.r + y.h)
                .partial_cmp(&(x.r + x.h))
                .unwrap_or(Ordering::Equal)
                .then(y.fuzzy.cmp(&x.fuzzy))
                .then_with(|| locale_cmp(&x.app.name, &y.app.name))
        });

        let mut out = Vec::new();
        for (j, (app, action)) in action_hits.iter().enumerate() {
            out.push(Row {
                title: action.name.clone(),
                subtitle: app.name.clone(),
                image: Some(app.icon.clone()),
                score: 94.0 - j as f64 * 0.01,
                run: Some(open(app, Some(action.index), "open")),
                ..Default::default()
            });
        }

        for (n, hit) in hits.iter().take(LIMIT).enumerate() {
            let app = hit.app;
            let is_pinned = pinned.contains(app.id.as_str());
            // Apps sit above keyword-found commands (≤64) and below exact
            // answers like keyword commands (98), kill rows (96) and time
            // lookups (92).
            let score = 70.0 + hit.r * 0.2 + hit.h * 0.2 - n as f64 * 0.01;
            out.push(Row {
                title: app.name.clone(),
                subtitle: format!("{}{}", if is_pinned { "Pinned · " } else { "" }, label(app)),
                image: Some(app.icon.clone()),
                app_id: Some(app.id.clone()),
                pinned: is_pinned,
                score,
                run: Some(open(app, None, if st.is_running(app) { "open new" } else { "open" })),
                ..Default::default()
            });

            // A near-exact hit also offers its actions (New Window, New
            // Private Window, …), so a second browser window is one arrow
            // key away.
            if n == 0 && hit.r >= 90.0 && q.chars().count() >= 3 && action_hits.is_empty() {
                for (m, action) in app.actions.iter().take(ACTIONS).enumerate() {
                    out.push(Row {
                        title: action.name.clone(),
                        subtitle: app.name.clone(),
                        image: Some(app.icon.clone()),
                        score: 70.0 + hit.r * 0.2 + hit.h * 0.2 - 0.005 - m as f64 * 0.001,
                        run: Some(open(app, Some(action.index), "open")),
                        ..Default::default()
                    });
                }
            }
        }
        out.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str, generic: &str, actions: &[&str], keywords: &[&str]) -> Value {
        json!({ "id": id, "name": name, "generic": generic, "comment": "", "keywords": keywords, "icon": id,
                "actions": actions.iter().enumerate().map(|(i, n)| json!({ "index": i, "name": n })).collect::<Vec<_>>() })
    }

    // The tests/run.js apps.
    fn data() -> crate::Data {
        let apps = json!([
            app("brave-browser", "Brave", "Web Browser", &["New Window", "New Private Window"], &[]),
            app("firefox", "Firefox", "Web Browser", &["New Window", "New Private Window"], &[]),
            app("org.gnome.Nautilus", "Files", "File Manager", &[], &["folder", "explorer"]),
            app("Alacritty", "Alacritty", "Terminal", &[], &["shell", "prompt"]),
            app("code", "Visual Studio Code", "Text Editor", &["New Empty Window"], &[]),
            app("org.localsend.localsend_app", "LocalSend", "File Sharing", &[], &[]),
            app("signal", "Signal", "Messenger", &[], &[]),
            app("spotify", "Spotify", "Music Player", &[], &[]),
        ]);
        let mut d = crate::Data::new();
        d.insert("apps".into(), apps);
        d.insert("launches".into(), json!({ "firefox": 12 }));
        d.insert("pinned".into(), json!(["signal", "gone", 7]));
        d.insert("windows".into(), json!([{ "cls": "brave-browser" }]));
        d
    }

    fn rows(q: &str) -> Vec<Row> {
        let d = data();
        let ctx = Context::new(&Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &d);
        Apps.matches(q, &ctx).rows
    }

    fn titles(q: &str) -> Vec<String> {
        rows(q).into_iter().map(|r| r.title).collect()
    }

    #[test]
    fn the_js_rules() {
        assert_eq!(titles("firefox")[0], "Firefox");
        assert_eq!(titles("vsc")[0], "Visual Studio Code");
        assert_eq!(titles("term")[0], "Alacritty");
        assert_eq!(titles("brave new window")[0], "New Window");
        assert_eq!(rows("brave new window")[0].run.as_ref().unwrap()["action"], 0);
        assert!(titles("2+2").is_empty());
        assert!(titles("w brave").is_empty());
        let f = titles("f");
        assert_eq!(f[0], "Firefox"); // launched 12 times: over Files
        // A running app opens a new window; a near-exact hit lists its actions.
        let brave = rows("brave");
        assert_eq!(brave[0].run.as_ref().unwrap()["label"], "open new");
        assert_eq!(
            brave.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            ["Brave", "New Window", "New Private Window"]
        );
    }

    #[test]
    fn letters_in_order_fill_in_below() {
        assert_eq!(titles("frfx"), ["Firefox"]);
        assert_eq!(titles("spfy"), ["Spotify"]);
        assert!(titles("xyz").is_empty());
        // "rfx" is in Firefox's letters, but not from the start of a word.
        assert!(titles("rfx").is_empty());
        // Below every rule-found app: "sig" is Signal by prefix, before any fuzzy hit.
        assert_eq!(titles("sig")[0], "Signal");
    }

    #[test]
    fn a_bad_entry_is_skipped_not_the_list() {
        let mut d = data();
        d.get_mut("apps").unwrap().as_array_mut().unwrap().push(json!({ "id": "bad", "name": 5, "keywords": "x" }));
        let ctx = Context::new(&Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &d);
        assert_eq!(Apps.matches("firefox", &ctx).rows[0].title, "Firefox");
    }

    #[test]
    fn pinned() {
        let empty = rows("");
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0].title, "Signal");
        assert_eq!(empty[0].group.as_deref(), Some("Pinned"));
        let s = rows("signal");
        assert!(s[0].pinned && s[0].subtitle == "Pinned · Messenger" && s[0].app_id.as_deref() == Some("signal"));
    }
}
