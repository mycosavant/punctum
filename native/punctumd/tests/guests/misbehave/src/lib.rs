//! Each query is a test: what it tries, and what came of it as a row title.

wit_bindgen::generate!({ path: "../../../wit", world: "extension" });

use std::sync::atomic::{AtomicU32, Ordering};

use punctum::extension::types::Row;

struct Misbehave;

static COUNT: AtomicU32 = AtomicU32::new(0);
static mut HOARD: Vec<Vec<u8>> = Vec::new();

fn say(title: String) -> Answer {
    let row = Row {
        title, subtitle: String::new(), icon: String::new(), score: 50.0, copy: String::new(),
        run: None, alt: None, swatch: None, group: None, complete: None,
    };
    Answer { rows: vec![row], ttl_ms: None }
}

impl Guest for Misbehave {
    fn respond(query: String, settings: String, now_ms: i64) -> Answer {
        match query.as_str() {
            "loop" => loop { COUNT.fetch_add(1, Ordering::Relaxed); },
            "hog" => {
                // 1 MB at a time, kept, until something gives.
                for _ in 0..200 {
                    #[allow(static_mut_refs)]
                    unsafe { HOARD.push(vec![1u8; 1 << 20]) };
                }
                say("hoarded 200 MB".into())
            }
            "panic" => panic!("on purpose"),
            "count" => say(COUNT.fetch_add(1, Ordering::Relaxed).to_string()),
            "file" => say(match std::fs::read_to_string("/etc/passwd") { Ok(_) => "read /etc/passwd".into(), Err(e) => format!("no file: {e}") }),
            "dir" => say(match std::fs::read_dir("/") { Ok(_) => "listed /".into(), Err(e) => format!("no dir: {e}") }),
            "env" => say(format!("env {}", std::env::vars().count())),
            "net" => say(match std::net::TcpStream::connect("1.1.1.1:80") { Ok(_) => "connected".into(), Err(e) => format!("no net: {e}") }),
            "load" => say(format!("{:?}", load("thing"))),
            "settings" => say(settings),
            "now" => say(now_ms.to_string()),
            _ => say(format!("? {query}")),
        }
    }
}

export!(Misbehave);
