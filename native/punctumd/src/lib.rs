//! punctumd: Punctum's native extensions, served to the bar over stdin and
//! stdout, one JSON object per line. See docs/native.md for the protocol.

pub mod format;
pub mod units;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A result row, as the bar's script and JS extensions return them.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Row {
    pub title: String,
    pub subtitle: String,
    pub icon: String,
    pub score: f64,
    pub copy: String,
}

/// One feature of the bar, answering every keystroke.
pub trait Extension: Sync + std::panic::RefUnwindSafe {
    fn id(&self) -> &'static str;
    fn matches(&self, query: &str, settings: &Value) -> Vec<Row>;
}

/// Every extension this build serves.
pub fn extensions() -> &'static [&'static dyn Extension] {
    &[&units::Units]
}

pub const PROTOCOL: u32 = 1;

#[derive(Deserialize, Debug)]
pub struct Request {
    #[serde(default)]
    pub id: Value,
    /// "hello" or "match" (the default).
    #[serde(default)]
    pub op: Option<String>,
    #[serde(default)]
    pub ext: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub settings: Value,
}

/// The reply to one request line. A request that can't be read gets an
/// `error`, with its id when there was one, so the bar never waits on it.
pub fn handle(line: &str) -> Value {
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
        "match" => {
            let Some(ext) = extensions().iter().find(|e| e.id() == req.ext) else {
                return serde_json::json!({ "id": req.id, "error": format!("no extension \"{}\"", req.ext) });
            };
            // One extension's bug answers its own request with an error; the
            // daemon, and every other extension, carries on.
            match std::panic::catch_unwind(|| ext.matches(&req.query, &req.settings)) {
                Ok(rows) => serde_json::json!({ "id": req.id, "rows": rows }),
                Err(_) => serde_json::json!({ "id": req.id, "error": format!("{} failed on this query", req.ext) }),
            }
        }
        other => serde_json::json!({ "id": req.id, "error": format!("unknown op \"{other}\"") }),
    }
}
