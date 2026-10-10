//! Extensions as WebAssembly components (wit/extension.wit), run in a
//! sandbox. See docs/wasm.md.
//!
//! The bar reads a module (punctumd reads no files) and sends it with its
//! SHA-256 (`op: "wasm"`); punctumd checks the hash, compiles it with
//! wasmtime and keeps one instance per extension. The instance gets WASI with
//! nothing in it: no files, no environment, no arguments, no network, its
//! output thrown away. Clocks and random numbers are all it can ask the
//! system for. Its only other import is `load`, the output of a program its
//! manifest names, run by the bar.
//!
//! Each instance has 64 MB of memory at most, and each query 50 ms: past
//! that it's stopped (wasmtime's epoch interruption), the query answered with
//! an error, and the instance dropped; the next query starts a fresh one. So
//! does dropping one of its loads, so what it kept from your clipboard
//! history goes with the history.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use base64::Engine as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use crate::{Loads, Row};

wasmtime::component::bindgen!({ path: "wit", world: "extension" });

use punctum::extension::types::Action;

pub const MEMORY: usize = 64 << 20;
/// A query may run this many ticks of `TICK` before it's stopped.
const TICKS: u64 = 5;
const TICK: Duration = Duration::from_millis(10);
/// The largest module the bar may send.
pub const MAX_MODULE: usize = 32 << 20;

/// One engine for every module, its epoch moved on by a thread every tick.
static ENGINE: LazyLock<Engine> = LazyLock::new(|| {
    let mut config = Config::new();
    config.epoch_interruption(true);
    let engine = Engine::new(&config).expect("wasmtime starts");
    let ticking = engine.weak();
    std::thread::spawn(move || {
        while let Some(engine) = ticking.upgrade() {
            engine.increment_epoch();
            drop(engine);
            std::thread::sleep(TICK);
        }
    });
    engine
});

struct Host {
    wasi: WasiCtx,
    table: ResourceTable,
    limits: StoreLimits,
    /// This query's view of the extension's loads, and what it asked for.
    loads: HashMap<String, Arc<str>>,
    needs: Vec<String>,
}

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView { ctx: &mut self.wasi, table: &mut self.table }
    }
}

/// The types interface has no functions of its own.
impl punctum::extension::types::Host for Host {}

impl ExtensionImports for Host {
    fn load(&mut self, key: String) -> Option<String> {
        if !self.needs.contains(&key) && self.needs.len() < 16 {
            self.needs.push(key.clone());
        }
        self.loads.get(&key).map(|t| t.to_string())
    }
}

fn host() -> Host {
    Host {
        // Nothing granted: no preopened folders, no environment, no
        // arguments, no sockets; stdin empty, stdout and stderr discarded.
        wasi: WasiCtx::builder().build(),
        table: ResourceTable::new(),
        limits: StoreLimitsBuilder::new().memory_size(MEMORY).instances(16).tables(16).memories(4).build(),
        loads: HashMap::new(),
        needs: Vec::new(),
    }
}

/// A module the bar sent, compiled, and its instance once it's running.
pub struct Module {
    pub sha256: String,
    component: Component,
    running: Option<(Store<Host>, Extension)>,
}

/// The module in `base64`, checked against `sha256` and compiled.
pub fn compile(base64: &str, sha256: &str) -> Result<Module, String> {
    if base64.len() > MAX_MODULE / 3 * 4 + 4 {
        return Err("the module is over 32 MB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|_| "the module isn't base64")?;
    let got = hex(&Sha256::digest(&bytes));
    if !got.eq_ignore_ascii_case(sha256) {
        return Err(format!("the module's SHA-256 is {got}, not the {sha256} the bar read"));
    }
    let component = Component::new(&ENGINE, &bytes)
        .map_err(|e| format!("not a Punctum extension component: {}", first_line(&e.to_string())))?;
    Ok(Module { sha256: got, component, running: None })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or(s)
}

fn linker() -> Result<Linker<Host>, String> {
    let mut linker = Linker::new(&ENGINE);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker).map_err(|e| e.to_string())?;
    Extension::add_to_linker::<Host, HasSelf<Host>>(&mut linker, |h| h).map_err(|e| e.to_string())?;
    Ok(linker)
}

static LINKER: LazyLock<Result<Linker<Host>, String>> = LazyLock::new(linker);

impl Module {
    /// Drop the running instance: the next query starts a fresh one.
    pub fn reset(&mut self) {
        self.running = None;
    }

    /// The answer to a query, and the loads it asked for; or why there is none.
    pub fn respond(
        &mut self,
        ext: &str,
        query: &str,
        settings: &Value,
        now_ms: i64,
        loads: &Loads,
    ) -> Result<(Vec<Row>, Option<u64>, Vec<String>), String> {
        if self.running.is_none() {
            let linker = LINKER.as_ref().map_err(|e| e.clone())?;
            let mut store = Store::new(&ENGINE, host());
            store.limiter(|h| &mut h.limits);
            store.set_epoch_deadline(TICKS);
            let instance = Extension::instantiate(&mut store, &self.component, linker)
                .map_err(|e| format!("didn't start: {}", first_line(&e.to_string())))?;
            self.running = Some((store, instance));
        }
        let (store, instance) = self.running.as_mut().expect("just started");
        let h = store.data_mut();
        h.loads = loads.iter().filter(|((e, _), _)| e == ext).map(|((_, k), l)| (k.clone(), l.text.clone())).collect();
        h.needs.clear();
        store.set_epoch_deadline(TICKS);
        let settings = serde_json::to_string(settings).unwrap_or_else(|_| "{}".into());
        match instance.call_respond(&mut *store, query, &settings, now_ms) {
            Ok(answer) => {
                let h = store.data_mut();
                h.loads.clear();
                let needs = std::mem::take(&mut h.needs);
                let Answer { rows, ttl_ms } = answer;
                Ok((rows.into_iter().take(200).map(row).collect(), ttl_ms, needs))
            }
            Err(e) => {
                // Out of time, out of memory, or a panic: start again next time.
                // Rust's allocator aborts (an unreachable) when the store
                // refuses it more memory, as a panic does.
                let why = match e.downcast_ref::<wasmtime::Trap>() {
                    Some(wasmtime::Trap::Interrupt) => "took over 50 ms".to_string(),
                    Some(wasmtime::Trap::UnreachableCodeReached) => {
                        "stopped: it panicked, or wanted over 64 MB".to_string()
                    }
                    Some(trap) => format!("stopped: {trap}"),
                    None => first_line(&e.root_cause().to_string()).to_string(),
                };
                self.running = None;
                Err(why)
            }
        }
    }
}

fn action(a: Action) -> Value {
    match a {
        Action::Open(t) => json!({ "kind": "open", "target": t, "label": "open" }),
        Action::Copy(t) => json!({ "kind": "copy", "target": t, "label": "copy" }),
        Action::Paste(t) => json!({ "kind": "paste", "target": t, "label": "paste" }),
        Action::Run(n) => {
            let mut v = json!({ "kind": "action", "name": n.name, "args": n.args });
            if let Some(input) = n.input {
                v["input"] = input.into();
            }
            v
        }
    }
}

fn row(r: punctum::extension::types::Row) -> Row {
    Row {
        title: r.title,
        subtitle: r.subtitle,
        icon: r.icon,
        score: r.score,
        copy: r.copy,
        run: r.run.map(action),
        alt: r.alt.map(action),
        swatch: r.swatch,
        group: r.group,
        complete: r.complete,
        ..Default::default()
    }
}
