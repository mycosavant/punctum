//! everywhere: find files anywhere on the disk by name, as you type.
//!
//!     everywhere notes                 ranked paths, best first
//!     everywhere report .pdf$          fzf syntax: 'exact ^start end$ !leave-out
//!     everywhere -i                    pick one interactively (fzf), print it
//!     everywhere -i --open             ... and open it
//!     everywhere --index               refresh the index of your home folder
//!     everywhere --json dwnlds         JSON for programs
//!     everywhere report ext:pdf dm:week size:>1M
//!                                      filters, as in Everything
//!     everywhere dm:today              what changed today in your home folder
//!     everywhere size:>1G              your biggest files
//!
//! Names come from two plocate indexes: the system's (/var/lib/plocate,
//! rebuilt nightly by plocate-updatedb.timer) for everything outside your
//! home folder, and a private index of your home folder
//! ($XDG_CACHE_HOME/everywhere/home.db, mode 600), which --index rebuilds in
//! about half a second. A query runs plocate twice, with the words as typed
//! and then with their letters in order, drops the system index's stale copy
//! of home and anything matching an exclusion, applies the query's syntax
//! (nucleo-matcher reads fzf's), and ranks every match the way a desktop
//! search should. See docs/everywhere.md.
//!
//! --punctum speaks Punctum's script-extension protocol: a JSON request on
//! stdin ({"text": ..., "settings": {"exclude": [...]}}) and {"items": [...]}
//! on stdout.
//!
//! Every program it runs gets an argument list, never a shell string; the
//! query reaches plocate after "--".

mod output;
mod query;
mod search;

use std::io::{Read, Write};
use std::process::{Command, ExitCode, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use jiff::tz::TimeZone;
use serde_json::{Value, json};

use query::{MIN_QUERY, split_filters, terms, usable};
use search::{DEFAULT_EXCLUDE, ordered, search};

#[derive(Parser)]
#[command(name = "everywhere", about = "Find files anywhere on the disk by name.")]
struct Args {
    /// Words; fzf syntax: 'exact ^start end$ !leave-out; filters size: dm: ext: type:
    /// (Options may come between the words, as `everywhere todo --limit 5`;
    /// put -- before words that start with "-".)
    query: Vec<String>,
    /// Pick one with fzf
    #[arg(short, long)]
    interactive: bool,
    /// With -i: open the chosen path
    #[arg(long)]
    open: bool,
    #[arg(long, default_value_t = 40)]
    limit: usize,
    /// NUL-separated output
    #[arg(long)]
    print0: bool,
    /// JSON output
    #[arg(long)]
    json: bool,
    /// Leave out paths containing this (repeatable)
    #[arg(long)]
    exclude: Vec<String>,
    #[arg(long)]
    no_default_excludes: bool,
    /// Rebuild the index of your home folder
    #[arg(long)]
    index: bool,
    /// With --index: only if older than this many seconds
    #[arg(long)]
    max_age: Option<f64>,
    #[arg(long, hide = true)]
    punctum: bool,
    /// For the tests: NUL-separated paths on stdin, ranked for the query
    #[arg(long, hide = true)]
    rank: bool,
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64())
}

fn zone() -> TimeZone {
    TimeZone::try_system().unwrap_or(TimeZone::UTC)
}

fn punctum(home: &str) -> i32 {
    let mut raw = String::new();
    let _ = std::io::stdin().take(1024 * 1024).read_to_string(&mut raw);
    let req: Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { &raw }).unwrap_or(json!({}));
    let text = req["text"].as_str().unwrap_or("").trim().to_string();
    let excludes: Vec<String> = match req["settings"]["exclude"].as_array() {
        Some(list) => list
            .iter()
            .filter_map(Value::as_str)
            .filter(|e| !e.is_empty() && !e.chars().any(char::is_whitespace))
            .map(str::to_string)
            .collect(),
        None => DEFAULT_EXCLUDE.iter().map(|e| e.to_string()).collect(),
    };
    let (now, tz) = (now(), zone());
    let (ts, f) = split_filters(&terms(&text), now, &tz);
    let say = |items: Vec<Value>, message: String| println!("{}", json!({ "items": items, "message": message }));
    if !f.bad.is_empty() {
        say(vec![], format!("Didn't understand {} · size:>10M dm:today ext:pdf type:dir", f.bad.join(", ")));
        return 0;
    }
    if !usable(&text, now, &tz) {
        say(vec![], "Type a file or folder name · 'exact ^start end$ !leave-out · size: dm: ext: type:".into());
        return 0;
    }
    let details = f.size.is_some() || f.since.is_some();
    let paths = search(&excludes, home, 40, ts, &f);
    let message = if paths.is_empty() {
        format!("Nothing named like \"{text}\" · files from today outside your home folder show up tomorrow")
    } else {
        String::new()
    };
    say(paths.iter().map(|p| output::item(p, home, details)).collect(), message);
    0
}

/// A word for sh, quoted.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn interactive(args: &Args) -> i32 {
    if Command::new("fzf").arg("--version").stdout(Stdio::null()).status().is_err() {
        eprintln!("everywhere -i needs fzf");
        return 1;
    }
    let me = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "everywhere".into());
    let reload = format!("{} --print0 --limit {} -- {{q}} || true", sh_quote(&me), args.limit);
    let out = Command::new("fzf")
        .args(["--disabled", "--read0", "--prompt", "everywhere> ", "--query", &args.query.join(" ")])
        .args(["--bind", &format!("start:reload:{reload}"), "--bind", &format!("change:reload:{reload}")])
        .args(["--preview", "ls -ld -- {}", "--preview-window", "down,1"])
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output();
    let Ok(out) = out else { return 1 };
    let chosen = String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string();
    if chosen.is_empty() {
        return if out.status.code() == Some(130) { 130 } else { 1 };
    }
    if args.open {
        let _ = Command::new("xdg-open").arg(&chosen).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    } else {
        println!("{chosen}");
    }
    0
}

fn run() -> i32 {
    let args = Args::parse();
    let home = search::home();
    if args.index {
        return output::index(args.max_age);
    }
    if args.punctum {
        return punctum(&home);
    }
    if args.interactive {
        return interactive(&args);
    }
    let text = args.query.join(" ");
    if args.rank {
        let mut raw = Vec::new();
        let _ = std::io::stdin().read_to_end(&mut raw);
        let paths: Vec<String> =
            raw.split(|b| *b == 0).filter(|p| !p.is_empty()).map(|p| String::from_utf8_lossy(p).into_owned()).collect();
        print!("{}\n", ordered(paths, &text, &home).join("\n"));
        return 0;
    }
    let (now, tz) = (now(), zone());
    let (ts, f) = split_filters(&terms(&text), now, &tz);
    if !f.bad.is_empty() {
        eprintln!("everywhere: didn't understand {} (size:>10M dm:today ext:pdf type:dir)", f.bad.join(", "));
        return 2;
    }
    if !usable(&text, now, &tz) {
        eprintln!("everywhere: type at least {MIN_QUERY} letters, or ext:, dm: or size:");
        return 2;
    }
    let mut excludes: Vec<String> =
        if args.no_default_excludes { vec![] } else { DEFAULT_EXCLUDE.iter().map(|e| e.to_string()).collect() };
    excludes.extend(args.exclude.iter().cloned());
    let paths = search(&excludes, &home, args.limit.max(1), ts, &f);
    let mut out = std::io::stdout().lock();
    let written = if args.json {
        writeln!(out, "{}", Value::Array(paths.iter().map(|p| output::item(p, &home, true)).collect()))
    } else if args.print0 {
        paths.iter().try_for_each(|p| write!(out, "{p}\0"))
    } else {
        paths.iter().try_for_each(|p| writeln!(out, "{p}"))
    };
    // A closed pipe (| head) is fine.
    let _ = written;
    if paths.is_empty() { 1 } else { 0 }
}

fn main() -> ExitCode {
    ExitCode::from(run().clamp(0, 255) as u8)
}
