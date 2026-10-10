//! Running a query: plocate over two indexes, the query's syntax applied in
//! process (nucleo-matcher reads fzf's), and the order a desktop search
//! should give. Without words, a walk of your home folder by date or size.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::query::{Filters, fuzzies, glob_safe, literals, match_query, terms};

pub const SYSTEM_DB: &str = "/var/lib/plocate/plocate.db";
pub const DEFAULT_EXCLUDE: [&str; 6] =
    ["/.cache/", "/.cargo/registry/", "/.cargo/git/", "/node_modules/", "/.local/share/Trash/", "/.git/"];
/// Paths kept from each index per pass, after filtering.
const PER_PASS: usize = 3000;
/// Each step's limit.
pub const TIMEOUT: Duration = Duration::from_secs(3);

pub fn cache_dir() -> std::path::PathBuf {
    match std::env::var_os("XDG_CACHE_HOME").filter(|v| !v.is_empty()) {
        Some(x) => Path::new(&x).join("everywhere"),
        None => Path::new(&std::env::var_os("HOME").unwrap_or_default()).join(".cache/everywhere"),
    }
}

pub fn home_db() -> std::path::PathBuf {
    cache_dir().join("home.db")
}

/// A program's NUL-separated output, read as it comes until `take` says
/// stop or the deadline passes; then it's killed. Paths that aren't UTF-8
/// are skipped: nothing downstream could show or open them faithfully.
fn stream(argv: &[String], deadline: Instant, mut take: impl FnMut(String) -> bool) {
    let Ok(mut child) = Command::new(&argv[0]).args(&argv[1..]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
    else {
        return;
    };
    let mut out = child.stdout.take().expect("piped");
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(16);
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 65536];
        while let Ok(n) = out.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let mut pending: Vec<u8> = Vec::new();
    'read: loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(chunk) = rx.recv_timeout(left) else { break };
        pending.extend_from_slice(&chunk);
        let mut start = 0;
        while let Some(at) = pending[start..].iter().position(|b| *b == 0) {
            let raw = &pending[start..start + at];
            start += at + 1;
            if let Ok(p) = std::str::from_utf8(raw)
                && !take(p.to_string())
            {
                break 'read;
            }
        }
        pending.drain(..start);
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Paths from one index matching every pattern, as `keep` allows, at most PER_PASS.
fn plocate(db: &str, patterns: &[String], regex: bool, keep: &dyn Fn(&str) -> bool, deadline: Instant) -> Vec<String> {
    let mut argv: Vec<String> = ["plocate", "-0", "-i", "-d", db].iter().map(|s| s.to_string()).collect();
    if regex {
        argv.push("--regexp".into());
    }
    argv.push("--".into());
    argv.extend(patterns.iter().cloned());
    let mut out = Vec::new();
    stream(&argv, deadline, |p| {
        if keep(&p) {
            out.push(p);
        }
        out.len() < PER_PASS
    });
    out
}

/// An exclusion like "/.git/" also matches the folder itself, "/x/.git".
pub fn excluded(path: &str, ex: &[String]) -> bool {
    let lp = path.to_lowercase() + "/";
    ex.iter().any(|e| lp.contains(e.as_str()))
}

fn prefix(home: &str) -> String {
    home.trim_end_matches('/').to_string() + "/"
}

pub fn candidates(text: &str, excludes: &[String], home: &str) -> Vec<String> {
    let ts = terms(text);
    let lit = literals(&ts);
    let mut fz = fuzzies(&ts);
    if fz.len() != lit.len() {
        fz.clear(); // a fuzzy pass only helps when every word gets one
    }
    let ex: Vec<String> = excludes.iter().filter(|e| !e.is_empty()).map(|e| e.to_lowercase()).collect();
    let own = home_db();
    let have_own = std::fs::File::open(&own).is_ok();
    let own = own.to_string_lossy().into_owned();
    let pre = prefix(home);
    // The system index's copy of home is a day old.
    let keep_system = |p: &str| !(have_own && p.starts_with(&pre)) && !excluded(p, &ex);
    let keep_home = |p: &str| !excluded(p, &ex);
    let deadline = Instant::now() + TIMEOUT;
    let mut found = Vec::new();
    let plain: Vec<String> = lit.iter().map(|l| glob_safe(l)).collect();
    for (patterns, regex) in [(plain, false), (fz, true)] {
        if patterns.is_empty() {
            continue;
        }
        found.extend(plocate(SYSTEM_DB, &patterns, regex, &keep_system, deadline));
        if have_own {
            found.extend(plocate(&own, &patterns, regex, &keep_home, deadline));
        }
    }
    found
}

/// The paths the query's syntax lets through ('exact ^start end$ !leave-out,
/// and every other word fuzzily), each with the matcher's score, best
/// first; equal scores keep their order. Each path once.
pub fn filter(paths: Vec<String>, ts: &[String]) -> Vec<(String, u32)> {
    let query = match_query(ts);
    let pattern = Pattern::parse(&query, CaseMatching::Smart, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut buf = Vec::new();
    let mut seen = HashSet::new();
    let mut out: Vec<(String, u32)> = Vec::new();
    for p in paths {
        if !p.starts_with('/') || seen.contains(&p) {
            continue;
        }
        if let Some(score) = pattern.score(Utf32Str::new(&p, &mut buf), &mut matcher) {
            seen.insert(p.clone());
            out.push((p, score));
        }
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    out
}

/// The paths the query lets through (only !negations, here), in their order.
fn keep_order(paths: Vec<String>, ts: &[String]) -> Vec<String> {
    let allowed: HashSet<String> = filter(paths.clone(), ts).into_iter().map(|(p, _)| p).collect();
    paths.into_iter().filter(|p| allowed.contains(p)).collect()
}

fn subsequence(text: &str, word: &str) -> bool {
    let mut want = word.chars().peekable();
    for c in text.chars() {
        if want.peek() == Some(&c) {
            want.next();
        }
    }
    want.peek().is_none()
}

/// How good a path is for these words: a name that is the word, starts with
/// it, contains it, or has its letters in order; a lift for home and a
/// bigger drop for hidden paths, so ~/.config/x/hosts sits under /etc/hosts
/// while ~/Downloads still beats /usr/share/…/downloads; then shallower and
/// shorter.
pub fn rank(path: &str, lits: &[String], home: &str) -> f64 {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let mut best = 0.0f64;
    for w in lits {
        let w = w.to_lowercase();
        let r = if name == w {
            4.0
        } else if name.starts_with(&w) {
            3.0
        } else if name.contains(&w) {
            2.0
        } else if subsequence(&name, &w) {
            1.0
        } else {
            0.0
        };
        best = best.max(r);
    }
    let in_home = !home.is_empty() && path.starts_with(&prefix(home));
    let hidden = if in_home { path.get(home.len()..).unwrap_or("") } else { path }.contains("/.");
    best + if in_home { 0.5 } else { 0.0 }
        - if hidden { 0.6 } else { 0.0 }
        - (path.matches('/').count() + 1) as f64 * 0.01
        - name.chars().count() as f64 * 0.0001
}

/// Best first by `rank`; equal ranks keep the order they came in.
pub fn ordered(paths: Vec<String>, text: &str, home: &str) -> Vec<String> {
    let lits = literals(&terms(text));
    let mut ranked: Vec<(f64, usize, String)> =
        paths.into_iter().enumerate().map(|(i, p)| (-rank(&p, &lits, home), i, p)).collect();
    ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
    ranked.into_iter().map(|(_, _, p)| p).collect()
}

fn mtime(m: &std::fs::Metadata) -> f64 {
    m.mtime() as f64 + m.mtime_nsec() as f64 / 1e9
}

/// Whether one path meets the size, date, extension and type filters.
pub fn passes(path: &str, f: &Filters) -> bool {
    if !ext_passes(path, f) {
        return false;
    }
    if !f.needs_stat() {
        return true;
    }
    std::fs::metadata(path).is_ok_and(|st| meta_passes(&st, f))
}

fn ext_passes(path: &str, f: &Filters) -> bool {
    let Some(exts) = &f.ext else { return true };
    let lower = path.to_lowercase();
    exts.iter().any(|e| lower.ends_with(&format!(".{e}")))
}

fn meta_passes(st: &std::fs::Metadata, f: &Filters) -> bool {
    let is_dir = st.is_dir();
    match f.kind {
        Some("dir") if !is_dir => return false,
        Some("file") if is_dir => return false,
        _ => {}
    }
    if let Some((lo, hi)) = f.size {
        let size = st.len() as f64;
        if is_dir || lo.is_some_and(|lo| size < lo) || hi.is_some_and(|hi| size > hi) {
            return false;
        }
    }
    if let Some((lo, hi)) = f.since {
        let t = mtime(st);
        if t < lo || hi.is_some_and(|hi| t >= hi) {
            return false;
        }
    }
    true
}

/// A walk's key for the best few: the key, then the path for ties.
#[derive(PartialEq)]
struct Keyed(f64, String);
impl Eq for Keyed {}
impl PartialOrd for Keyed {
    fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Keyed {
    fn cmp(&self, o: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&o.0).then_with(|| self.1.cmp(&o.1))
    }
}

/// The newest (or biggest) files under home matching the filters, by
/// walking it, on every core: plocate needs a name to look for, a walk can
/// go by date and size. The best `limit` are kept as the walk goes, so the
/// order is the true one; at the deadline what was kept is returned. Hidden
/// files count; .gitignore'd ones don't, which keeps build trees out.
/// Single-folder exclusions (/.cache/) aren't walked into.
fn walk(f: &Filters, excludes: &[String], home: &str, limit: usize, by_size: bool) -> Vec<String> {
    let skip: Arc<HashSet<String>> = Arc::new(
        excludes
            .iter()
            .map(|e| e.trim_matches('/').to_string())
            .filter(|n| !n.is_empty() && !n.contains('/'))
            .collect(),
    );
    let ex: Arc<Vec<String>> = Arc::new(excludes.iter().filter(|e| !e.is_empty()).map(|e| e.to_lowercase()).collect());
    let deadline = Instant::now() + TIMEOUT;
    // The smallest kept on top, to be replaced by a bigger one.
    let best: Arc<Mutex<BinaryHeap<Reverse<Keyed>>>> = Arc::new(Mutex::new(BinaryHeap::new()));
    let walker = ignore::WalkBuilder::new(home)
        .hidden(false)
        .filter_entry(move |e| {
            !(e.depth() > 0
                && e.file_type().is_some_and(|t| t.is_dir())
                && skip.contains(&*e.file_name().to_string_lossy()))
        })
        .build_parallel();
    walker.run(|| {
        let (best, ex, f) = (best.clone(), ex.clone(), f.clone());
        Box::new(move |entry| {
            if Instant::now() >= deadline {
                return ignore::WalkState::Quit;
            }
            let Ok(entry) = entry else { return ignore::WalkState::Continue };
            if entry.depth() == 0 {
                return ignore::WalkState::Continue;
            }
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            if (f.kind == Some("dir") && !is_dir) || ((f.kind == Some("file") || f.size.is_some()) && is_dir) {
                return ignore::WalkState::Continue;
            }
            let Some(p) = entry.path().to_str() else { return ignore::WalkState::Continue };
            if excluded(p, &ex) || !ext_passes(p, &f) {
                return ignore::WalkState::Continue;
            }
            // One stat, following links, for the filters and the key.
            let Ok(st) = std::fs::metadata(p) else { return ignore::WalkState::Continue };
            if !meta_passes(&st, &f) {
                return ignore::WalkState::Continue;
            }
            let key = if by_size { st.len() as f64 } else { mtime(&st) };
            let mut best = best.lock().unwrap_or_else(|e| e.into_inner());
            if best.len() < limit {
                best.push(Reverse(Keyed(key, p.to_string())));
            } else if best.peek().is_some_and(|Reverse(worst)| key > worst.0) {
                best.pop();
                best.push(Reverse(Keyed(key, p.to_string())));
            }
            ignore::WalkState::Continue
        })
    });
    let best = std::mem::take(&mut *best.lock().unwrap_or_else(|e| e.into_inner()));
    let mut out: Vec<Keyed> = best.into_iter().map(|Reverse(k)| k).collect();
    out.sort_by(|a, b| b.cmp(a));
    out.into_iter().map(|k| k.1).collect()
}

/// The best `limit` paths for the query's words `ts` and filters `f`.
pub fn search(excludes: &[String], home: &str, limit: usize, ts: Vec<String>, f: &Filters) -> Vec<String> {
    if literals(&ts).is_empty() {
        if f.since.is_some() || (f.size.is_some() && f.ext.is_none()) {
            // Newest first for a date, biggest first for a size alone.
            let hits = walk(f, excludes, home, if ts.is_empty() { limit } else { limit * 4 }, f.since.is_none());
            // !negations still apply with no words to search for.
            let mut hits = if ts.is_empty() { hits } else { keep_order(hits, &ts) };
            hits.truncate(limit);
            return hits;
        }
        // Only ext:, maybe size:/type:: each extension is the name to look for.
        let mut hits = Vec::new();
        let mut seen = HashSet::new();
        for e in f.ext.iter().flatten() {
            for p in candidates(&format!(".{e}$"), excludes, home) {
                if !seen.contains(&p) && passes(&p, f) {
                    seen.insert(p.clone());
                    hits.push(p);
                }
            }
        }
        if !ts.is_empty() {
            hits = keep_order(hits, &ts);
        }
        let exts = f.ext.iter().flatten().map(|e| format!(".{e}")).collect::<Vec<_>>().join(" ");
        let mut out = ordered(hits, &exts, home);
        out.truncate(limit);
        return out;
    }
    let rest = ts.join(" ");
    // Home and system paths each in the matcher's order, home first, so ties
    // in rank fall to home; everything that matches is ranked, none cut.
    let cands = candidates(&rest, excludes, home);
    let pre = prefix(home);
    let (mine, theirs): (Vec<String>, Vec<String>) = cands.into_iter().partition(|p| p.starts_with(&pre));
    let found: Vec<String> = filter(mine, &ts).into_iter().chain(filter(theirs, &ts)).map(|(p, _)| p).collect();
    let mut out = ordered(found.into_iter().filter(|p| passes(p, f)).collect(), &rest, home);
    out.truncate(limit);
    out
}
