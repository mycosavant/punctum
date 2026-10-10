// WebAssembly extensions, as the bar sees them: a module sent over the pipe,
// queries answered, and the sandbox holding when a module misbehaves. The
// guest (tests/guests/misbehave) is built here for wasm32-wasip2; without
// that target the test says so and passes.
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Instant;

use base64::Engine as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn guest() -> Option<Vec<u8>> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/guests/misbehave");
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/guests");
    let ok = Command::new(env!("CARGO"))
        .args(["build", "--quiet", "--release", "--target", "wasm32-wasip2"])
        .current_dir(&dir)
        .env("CARGO_TARGET_DIR", &target)
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        eprintln!("untested: no wasm32-wasip2 target (rustup target add wasm32-wasip2)");
        return None;
    }
    std::fs::read(target.join("wasm32-wasip2/release/misbehave.wasm")).ok()
}

struct Daemon {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Daemon {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_punctumd"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("punctumd starts");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Daemon { _child: child, stdin, stdout }
    }

    fn ask(&mut self, req: Value) -> Value {
        writeln!(self.stdin, "{req}").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn title(&mut self, query: &str) -> String {
        let r = self.ask(json!({ "id": 1, "ext": "bad", "query": query, "settings": { "a": 1 }, "now": 42 }));
        r["rows"][0]["title"].as_str().map(str::to_string).unwrap_or_else(|| format!("error: {}", r["error"]))
    }
}

fn send(d: &mut Daemon, bytes: &[u8], sha256: &str) -> Value {
    let module = base64::engine::general_purpose::STANDARD.encode(bytes);
    d.ask(json!({ "id": "w", "op": "wasm", "ext": "bad", "module": module, "sha256": sha256 }))
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn the_sandbox_holds() {
    let Some(bytes) = guest() else { return };
    let mut d = Daemon::start();

    // Only the module the bar read: its hash must match.
    assert!(send(&mut d, &bytes, &"0".repeat(64))["error"].as_str().unwrap().contains("SHA-256"));
    assert!(send(&mut d, b"\0asm not really", &sha(b"\0asm not really"))["error"].is_string());
    assert_eq!(send(&mut d, &bytes, &sha(&bytes))["ok"], true);

    // It sees its settings and the time, as given.
    assert_eq!(d.title("settings"), r#"{"a":1}"#);
    assert_eq!(d.title("now"), "42");

    // Nothing of the system: no files, no environment, no network.
    assert!(d.title("file").starts_with("no file"), "{}", d.title("file"));
    assert!(d.title("dir").starts_with("no dir"));
    assert_eq!(d.title("env"), "env 0");
    assert!(d.title("net").starts_with("no net"));

    // One instance keeps its state between queries.
    assert_eq!(d.title("count"), "0");
    assert_eq!(d.title("count"), "1");

    // A loop is stopped within the limit, and the next query starts afresh.
    let t = Instant::now();
    assert_eq!(d.title("loop"), "error: \"bad: took over 50 ms\"");
    assert!(t.elapsed().as_millis() < 500, "{:?}", t.elapsed());
    assert_eq!(d.title("count"), "0");

    // Memory stops at 64 MB; a panic is an error; both start afresh.
    assert_eq!(d.title("hog"), "error: \"bad: stopped: it panicked, or wanted over 64 MB\"");
    assert_eq!(d.title("panic"), "error: \"bad: stopped: it panicked, or wanted over 64 MB\"");
    assert_eq!(d.title("count"), "0");

    // Loads: asked for, then given; dropping one starts the instance afresh.
    let r = d.ask(json!({ "id": 1, "ext": "bad", "query": "load" }));
    assert_eq!(r["rows"][0]["title"], "None");
    assert_eq!(r["needs"], json!(["thing"]));
    assert_eq!(d.ask(json!({ "id": 2, "op": "load", "ext": "bad", "key": "thing", "text": "hi" }))["ok"], true);
    assert_eq!(d.title("load"), "Some(\"hi\")");
    d.title("count");
    d.ask(json!({ "id": 3, "op": "load", "ext": "bad", "key": "thing", "text": null }));
    assert_eq!(d.title("count"), "0");

    // Dropped: it no longer answers, and the built-ins still do.
    assert_eq!(d.ask(json!({ "id": "w", "op": "wasm", "ext": "bad", "module": null }))["ok"], true);
    assert!(d.title("count").contains("no extension"));
    let units = d.ask(json!({ "id": 4, "ext": "units", "query": "5 km to mi" }));
    assert_eq!(units["rows"][0]["title"], "3.1069 mi");
}
