//! punctumd: Punctum's native extensions, served to the bar over stdin and
//! stdout, one JSON object per line. See docs/native.md for the protocol.

pub mod apps;
pub mod calc;
pub mod cities;
pub mod clipboard;
pub mod colors;
pub mod format;
pub mod hotkeys;
pub mod packages;
pub mod remind;
pub mod time;
pub mod units;
pub mod url;
pub mod windows;

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use jiff::Timestamp;
use jiff::tz::TimeZone;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A result row, as the bar's script and JS extensions return them. `run`
/// and `alt` are actions from the bar's short list, checked by the bar
/// (lib/Extensions.js, nativeProvider). The rest are drawn as the JS
/// extensions' are: `swatch` a colour tile, `image` an icon theme name.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct Row {
    pub title: String,
    pub subtitle: String,
    pub icon: String,
    pub score: f64,
    pub copy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swatch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// What Tab puts in the search field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<String>,
    /// Marks a row Alt+P can pin.
    #[serde(rename = "appId", skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
}

/// No shell state, for tests of extensions that don't use any.
#[cfg(test)]
pub(crate) static NO_DATA: std::sync::LazyLock<Data> = std::sync::LazyLock::new(Data::new);

/// What the bar has told punctumd about the shell (`op: "data"`), by key:
/// apps, launches, pinned, windows. See docs/native.md.
pub type Data = HashMap<String, Value>;

/// A program's output, run by the bar and sent with `op: "load"`: the
/// command is the one the extension's manifest names under "loads", never
/// one punctumd chose. `generation` is new for every text, so a parse can be
/// kept until the text changes (see [`Memo`]).
#[derive(Debug)]
pub struct Load {
    pub text: String,
    pub generation: u64,
}

/// Loads by extension id and the manifest's key for them.
pub type Loads = HashMap<(String, String), Load>;

/// What punctumd keeps between requests: the shell's state and loads.
#[derive(Default)]
pub struct State {
    pub data: Data,
    pub loads: Loads,
    generation: u64,
}

impl State {
    pub fn new() -> Self {
        Self::default()
    }
}

/// A parse of a load, kept until the load's text changes, so a 1 MB package
/// list isn't split again on every keystroke. When the bar drops the load
/// (it closed), the extension's `forget` must drop the parse too: it holds
/// the same text, the clipboard history among them.
pub struct Memo<T>(Mutex<Option<(u64, Arc<T>)>>);

impl<T> Memo<T> {
    pub const fn new() -> Self {
        Memo(Mutex::new(None))
    }

    pub fn get(&self, load: &Load, parse: impl FnOnce(&str) -> T) -> Arc<T> {
        let mut kept = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((generation, value)) = kept.as_ref()
            && *generation == load.generation
        {
            return value.clone();
        }
        let value = Arc::new(parse(&load.text));
        *kept = Some((load.generation, value.clone()));
        value
    }

    pub fn forget(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

impl<T> Default for Memo<T> {
    fn default() -> Self {
        Self::new()
    }
}

/// What an extension answers: its rows, and for how long they hold. An
/// answer that depends on the clock says when it goes stale; the bar caches
/// the rest until the config changes.
#[derive(Debug, Default, PartialEq)]
pub struct Answer {
    pub rows: Vec<Row>,
    pub ttl_ms: Option<u64>,
}

impl From<Vec<Row>> for Answer {
    fn from(rows: Vec<Row>) -> Self {
        Answer { rows, ttl_ms: None }
    }
}

/// What an extension may know besides the query.
pub struct Context<'a> {
    /// Its section of the config: manifest defaults merged with yours.
    pub settings: &'a Value,
    pub now: Timestamp,
    /// The system's time zone.
    pub local_zone: TimeZone,
    /// The shell's state, as the bar last sent it.
    pub data: &'a Data,
    /// The extension asking, and every load the bar has sent.
    pub ext: &'a str,
    pub loads: &'a Loads,
    /// The loads this answer read, or wanted and didn't have: the reply's
    /// "needs", which the bar reads (again, once they're stale) and sends.
    pub needs: RefCell<Vec<String>>,
}

impl<'a> Context<'a> {
    pub fn new(settings: &'a Value, now: Timestamp, local_zone: TimeZone, data: &'a Data) -> Self {
        Self::with_loads(settings, now, local_zone, data, "", EMPTY_LOADS.get_or_init(Loads::new))
    }

    pub fn with_loads(
        settings: &'a Value,
        now: Timestamp,
        local_zone: TimeZone,
        data: &'a Data,
        ext: &'a str,
        loads: &'a Loads,
    ) -> Self {
        Context { settings, now, local_zone, data, ext, loads, needs: RefCell::new(Vec::new()) }
    }

    /// The output of the program this extension's manifest declares under
    /// `key` in "loads", or None until the bar has run it. Either way the
    /// answer says it needs it, so the bar runs it (again, when it's stale).
    pub fn load(&self, key: &str) -> Option<&'a Load> {
        let mut needs = self.needs.borrow_mut();
        if !needs.iter().any(|k| k == key) {
            needs.push(key.to_string());
        }
        self.loads.get(&(self.ext.to_string(), key.to_string()))
    }
    /// One piece of the shell's state, or null if the bar hasn't sent it.
    pub fn data(&self, key: &str) -> &Value {
        self.data.get(key).unwrap_or(&Value::Null)
    }

    /// A setting as a string, if it is one and isn't empty.
    pub fn str_setting(&self, key: &str) -> Option<&str> {
        self.settings.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
    }
}

/// One feature of the bar, answering every keystroke.
pub trait Extension: Sync {
    fn id(&self) -> &'static str;
    fn matches(&self, query: &str, ctx: &Context) -> Answer;
    /// The bar dropped one of this extension's loads: drop anything made
    /// from it.
    fn forget(&self, _load: &str) {}
}

/// Every extension this build serves.
pub fn extensions() -> &'static [&'static dyn Extension] {
    &[
        &units::Units,
        &time::Time,
        &url::Url,
        &colors::Colors,
        &apps::Apps,
        &windows::Windows,
        &hotkeys::Hotkeys,
        &clipboard::Clipboard,
        &packages::Packages,
        &remind::Remind,
        &calc::Calc,
    ]
}

static EMPTY_LOADS: std::sync::OnceLock<Loads> = std::sync::OnceLock::new();

pub const PROTOCOL: u32 = 1;

#[derive(Deserialize, Debug)]
pub struct Request {
    #[serde(default)]
    pub id: Value,
    /// "hello", "data" or "match" (the default).
    #[serde(default)]
    pub op: Option<String>,
    /// data: which piece of the shell's state, and its value. load: the
    /// manifest's key for the load, and `text` the program's output (null
    /// drops it).
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub ext: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub settings: Value,
    /// For tests: the time to answer as of, in ms since the epoch, instead of
    /// the clock's.
    #[serde(default)]
    pub now: Option<i64>,
    /// For tests: the system time zone to assume.
    #[serde(default)]
    pub local_zone: Option<String>,
}

/// The system's time zone, from TZ or /etc/localtime; UTC if it can't tell.
/// Zones come from the system's tzdata (/usr/share/zoneinfo), which the
/// distribution keeps current, and from a copy built in only without it.
pub fn system_zone() -> TimeZone {
    TimeZone::try_system().unwrap_or(TimeZone::UTC)
}

/// The keys `op: "data"` takes; anything else is refused.
pub const DATA_KEYS: &[&str] = &["apps", "launches", "pinned", "windows"];

/// A load's key, as a manifest may name it.
fn load_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 32
        && key.starts_with(|c: char| c.is_ascii_lowercase())
        && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// The reply to one request line. A request that can't be read gets an
/// `error`, with its id when there was one, so the bar never waits on it.
pub fn handle(line: &str, state: &mut State) -> Value {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({ "id": Value::Null, "error": format!("unreadable request: {e}") }),
    };
    match req.op.as_deref().unwrap_or("match") {
        "hello" => serde_json::json!({
            "id": req.id,
            "protocol": PROTOCOL,
            "version": env!("CARGO_PKG_VERSION"),
            "extensions": extensions().iter().map(|e| e.id()).collect::<Vec<_>>(),
        }),
        "data" => {
            if !DATA_KEYS.contains(&req.key.as_str()) {
                return serde_json::json!({ "id": req.id, "error": format!("unknown data \"{}\"", req.key) });
            }
            state.data.insert(req.key, req.value);
            serde_json::json!({ "id": req.id, "ok": true })
        }
        "load" => {
            let Some(ext) = extensions().iter().find(|e| e.id() == req.ext).filter(|_| load_key(&req.key)) else {
                return serde_json::json!({ "id": req.id, "error": format!("no load \"{}\" for \"{}\"", req.key, req.ext) });
            };
            match req.text {
                Some(text) => {
                    state.generation += 1;
                    state.loads.insert((req.ext, req.key), Load { text, generation: state.generation });
                }
                None => {
                    ext.forget(&req.key);
                    state.loads.remove(&(req.ext, req.key));
                }
            }
            serde_json::json!({ "id": req.id, "ok": true })
        }
        "match" => {
            let Some(ext) = extensions().iter().find(|e| e.id() == req.ext) else {
                return serde_json::json!({ "id": req.id, "error": format!("no extension \"{}\"", req.ext) });
            };
            let ctx = Context::with_loads(
                &req.settings,
                req.now.and_then(|ms| Timestamp::from_millisecond(ms).ok()).unwrap_or_else(Timestamp::now),
                req.local_zone.as_deref().and_then(|z| TimeZone::get(z).ok()).unwrap_or_else(system_zone),
                &state.data,
                ext.id(),
                &state.loads,
            );
            // One extension's bug answers its own request with an error; the
            // daemon, and every other extension, carries on. Nothing it
            // touched outlives the request, so no broken state is seen again.
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ext.matches(&req.query, &ctx))) {
                Ok(Answer { rows, ttl_ms }) => {
                    let mut reply = serde_json::json!({ "id": req.id, "rows": rows });
                    if let Some(ttl) = ttl_ms {
                        reply["ttl"] = ttl.into();
                    }
                    let needs = ctx.needs.take();
                    if !needs.is_empty() {
                        reply["needs"] = needs.into();
                    }
                    reply
                }
                Err(_) => serde_json::json!({ "id": req.id, "error": format!("{} failed on this query", req.ext) }),
            }
        }
        other => serde_json::json!({ "id": req.id, "error": format!("unknown op \"{other}\"") }),
    }
}
