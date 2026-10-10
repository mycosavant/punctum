//! Files and folders under the home folder, found live with fd. A port of
//! extensions/files/provider.js, ranked anew.
//!
//!   ~readme          names like readme
//!   ~docs report     "report" in the name, under something like docs
//!   ~main rs         main.rs
//!
//! The answer asks the bar for two walks (the manifest's "walk" search, or
//! "walk_hidden" with "hidden": true): names containing the words as typed,
//! then their letters in order. fd stops each at 400 hits, and a fuzzy
//! pattern matches so much that a single walk could stop before it reaches
//! the obvious answer. The words reach fd as regexes, after `--` or inside
//! `--and=`, never as options; fd runs as an argument list.
//!
//! Every word counts against the name: the whole name (or its stem), its
//! start, the start of a word in it, anywhere in it, its letters in order
//! starting a word and keeping together (the rule apps and windows use), or,
//! least, scattered. A word the name doesn't have must be in the folders
//! above it. So "main rs" finds main.rs before a file whose name has "rs"
//! somewhere in it, and "docs report" a report under Docs before a name
//! that happens to hold r…e…p…o…r…t. Each folder deeper costs a tenth of
//! a step; shorter names win ties.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;

use crate::apps::letters_in_order;
use crate::{Answer, Context, Extension, Row};

const MIN_QUERY: usize = 2;
const MAX_QUERY: usize = 128;
const LIMIT: usize = 30;

static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*~/?(.*)$").unwrap());
static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\s/]+").unwrap());

fn words(q: &str) -> Vec<String> {
    SPLIT.split(q.trim()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// What the bar runs the walks for: the words, and whether hidden files
/// count; None when there's nothing worth asking fd.
fn key(q: &str, hidden: bool) -> Option<String> {
    let ws = words(q);
    if ws.is_empty()
        || ws.concat().chars().count() < MIN_QUERY
        || q.chars().count() > MAX_QUERY
        || ws.len() > 8
        || q.chars().any(|c| (c as u32) < 0x20)
    {
        return None;
    }
    Some(ws.join(" ").to_lowercase() + if hidden { "\nh" } else { "" })
}

/// The word, or its letters in order within one path segment, as fd's regex.
fn pattern(word: &str, fuzzy: bool) -> String {
    if fuzzy {
        word.chars().map(|c| regex::escape(&c.to_string())).collect::<Vec<_>>().join("[^/]*")
    } else {
        regex::escape(word)
    }
}

/// One walk's strings: {1} the name's pattern, {2*} the others, each in an
/// --and= of its own.
fn walk_args(ws: &[String], fuzzy: bool) -> Vec<String> {
    let (last, rest) = ws.split_last().expect("words");
    let mut args = vec![format!("[^/]*{}[^/]*/?$", pattern(last, fuzzy))];
    args.extend(rest.iter().map(|w| pattern(w, fuzzy)));
    args
}

pub struct Entry {
    pub path: String,
    pub rel: String,
    pub dir: bool,
}

/// fd's NUL-separated paths under home, each walk on its own (one stopped at
/// 3 s ends mid-path, and that tail mustn't join the next walk's first path),
/// each path once.
pub fn entries(chunks: &[String], home: &str) -> Vec<Entry> {
    let root = home.trim_end_matches('/').to_string() + "/";
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for chunk in chunks {
        let mut parts: Vec<&str> = chunk.split('\0').collect();
        parts.pop(); // unterminated
        for line in parts {
            if line.is_empty() {
                continue;
            }
            let dir = line.ends_with('/');
            let abs = if dir { &line[..line.len() - 1] } else { line };
            if !abs.starts_with(&root) || abs.len() == root.len() || !seen.insert(abs.to_string()) {
                continue;
            }
            out.push(Entry { path: abs.to_string(), rel: abs[root.len()..].to_string(), dir });
        }
    }
    out
}

fn base_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn parent_of(rel: &str) -> &str {
    rel.rfind('/').map_or("", |s| &rel[..s])
}

/// The word's letters in order, starting over at each "/": within one
/// segment, as fd's fuzzy pattern found them.
fn segment_subsequence(text: &str, word: &str) -> bool {
    let want: Vec<char> = word.chars().collect();
    let mut j = 0;
    for c in text.chars() {
        if c == '/' {
            j = 0;
            continue;
        }
        if want.get(j) == Some(&c) {
            j += 1;
            if j == want.len() {
                return true;
            }
        }
    }
    false
}

/// Whether `w` (lower case) starts a word in `name` past its first letter:
/// after a separator, or at a capital after a small letter.
fn starts_a_word(name: &str, w: &str) -> bool {
    // By characters, not bytes: lower-casing can change a character's
    // length (İ, ẞ), so a byte offset in one isn't one in the other.
    let chars: Vec<char> = name.chars().collect();
    (1..chars.len()).any(|at| {
        let (prev, here) = (chars[at - 1], chars[at]);
        (!prev.is_alphanumeric() || (prev.is_lowercase() && here.is_uppercase()))
            && chars[at..].iter().collect::<String>().to_lowercase().starts_with(w)
    })
}

/// How the name holds a word, best first; 0 when it doesn't.
fn name_tier(name: &str, w: &str) -> f64 {
    let lower = name.to_lowercase();
    let stem = lower.rfind('.').filter(|d| *d > 0).map_or(lower.as_str(), |d| &lower[..d]);
    if lower == w || stem == w {
        6.0
    } else if lower.starts_with(w) {
        5.0
    } else if starts_a_word(name, w) {
        4.0
    } else if lower.contains(w) {
        3.0
    } else if letters_in_order(name, w).is_some() {
        2.0
    } else if segment_subsequence(&lower, w) {
        1.0
    } else {
        0.0
    }
}

/// How the folders above hold a word; 0 when they don't.
fn path_tier(parent: &str, w: &str) -> f64 {
    let lower = parent.to_lowercase();
    if lower.split('/').any(|s| s.starts_with(w)) {
        1.5
    } else if lower.contains(w) {
        1.0
    } else if segment_subsequence(&lower, w) {
        0.5
    } else {
        0.0
    }
}

/// The entry's score for the words, or None when a word is in neither the
/// name nor the folders above, or none is in the name.
pub fn score(e: &Entry, ws: &[String]) -> Option<f64> {
    let name = base_name(&e.rel);
    let parent = parent_of(&e.rel);
    let mut total = 0.0;
    let mut in_name = false;
    for (i, w) in ws.iter().enumerate() {
        let w = w.to_lowercase();
        let n = name_tier(name, &w);
        if n > 0.0 {
            in_name = true;
            // The last word is usually the name's; a little more for it there.
            total += n + if i == ws.len() - 1 { 0.5 } else { 0.0 };
        } else {
            let p = path_tier(parent, &w);
            if p == 0.0 {
                return None;
            }
            total += p;
        }
    }
    // Each folder deeper costs a tenth: a near match close to home beats an
    // exact one six folders down a build tree.
    in_name.then(|| total - e.rel.matches('/').count() as f64 * 0.1 - name.chars().count() as f64 * 0.0001)
}

fn kind(e: &Entry) -> &'static str {
    if e.dir {
        return "folder";
    }
    let name = base_name(&e.rel);
    match name.rfind('.').filter(|d| *d > 0).map(|d| name[d + 1..].to_lowercase()).as_deref() {
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "avif") => "image",
        Some("pdf") => "pdf",
        Some("zip" | "tar" | "gz" | "xz" | "zst" | "7z") => "archive",
        Some("mp3" | "flac" | "ogg" | "wav" | "m4a" | "opus") => "audio",
        Some("mp4" | "mkv" | "webm" | "mov") => "video",
        Some("md" | "txt" | "json" | "toml" | "yaml" | "yml" | "conf" | "csv") => "text",
        _ => "file",
    }
}

fn icon(kind: &str) -> &'static str {
    match kind {
        "folder" => "󰉋",
        "image" => "󰋩",
        "pdf" => "󰈦",
        "archive" => "󰀼",
        "audio" => "󰈣",
        "video" => "󰈫",
        "text" => "󰈙",
        _ => "󰈔",
    }
}

fn row(e: &Entry, n: usize) -> Row {
    let parent = parent_of(&e.rel);
    let k = kind(e);
    let dir = if e.dir { e.path.clone() } else { e.path[..e.path.rfind('/').unwrap_or(0)].to_string() };
    Row {
        title: base_name(&e.rel).to_string(),
        subtitle: format!(
            "{}{}",
            if parent.is_empty() { "~".to_string() } else { format!("~/{parent}") },
            if e.dir { " · Folder" } else { "" }
        ),
        icon: icon(k).into(),
        image: (k == "image").then(|| e.path.clone()),
        score: 97.0 - n as f64 * 0.001,
        run: Some(json!({ "kind": "open", "target": e.path, "label": if e.dir { "open folder" } else { "open" } })),
        alt: Some(json!({ "kind": "action", "name": "terminal", "args": [dir] })),
        ..Default::default()
    }
}

fn note(title: String) -> Answer {
    vec![Row { title, subtitle: "Files".into(), score: 40.0, ..Default::default() }].into()
}

/// The rows for a query, from what the walks found.
pub fn rows(q: &str, entries: &[Entry]) -> Vec<Row> {
    let ws = words(q);
    let mut hits: Vec<(f64, &Entry)> = entries.iter().filter_map(|e| score(e, &ws).map(|s| (s, e))).collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0));
    hits.iter().take(LIMIT).enumerate().map(|(n, (_, e))| row(e, n)).collect()
}

pub struct Files;

impl Extension for Files {
    fn id(&self) -> &'static str {
        "files"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let Some(m) = MODE.captures(query) else { return Answer::default() };
        let q = m.get(1).map_or("", |x| x.as_str());
        let hidden = ctx.settings.get("hidden").and_then(|v| v.as_bool()) == Some(true);
        let Some(k) = key(q, hidden) else {
            return vec![Row {
                title: "Type a file or folder name".into(),
                subtitle: "At least two letters · searches under ~".into(),
                score: 40.0,
                ..Default::default()
            }]
            .into();
        };
        let ws = words(q);
        let walk = if hidden { "walk_hidden" } else { "walk" };
        let runs = vec![(walk.to_string(), walk_args(&ws, false)), (walk.to_string(), walk_args(&ws, true))];
        // Until this query's walks land, the last query's paths answer, so
        // the list doesn't flash empty on every keystroke.
        let Some(found) = ctx.search(&k, runs) else { return note("Searching…".into()) };
        let home = std::env::var("HOME").unwrap_or_default();
        let out = rows(q, &entries(&found.chunks, &home));
        if out.is_empty() {
            return if found.key == k && found.done {
                note(format!("No file or folder matches \"{}\"", q.trim()))
            } else {
                Answer::default()
            };
        }
        out.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(rel: &str) -> Entry {
        Entry { path: format!("/home/u/{rel}"), rel: rel.into(), dir: !rel.contains('.') && !rel.ends_with("rs") }
    }

    fn top(q: &str, rels: &[&str]) -> Vec<String> {
        let es: Vec<Entry> = rels.iter().map(|r| e(r)).collect();
        rows(q, &es).into_iter().map(|r| r.title).collect()
    }

    #[test]
    fn names_before_scattered_letters() {
        let rels = [
            "git/warp/docs/INCREMENT-2-navigation-and-conversation-list.md",
            "git/warp/src/lib.rs",
            "git/warp/src/main.rs",
            "Videos/QUALITY-1112-smart-variable-speedcut-for-computer-use-recordings.md",
            "Documents/work/report-2026.pdf",
            "Downloads",
            "git/warp/app/src/download_method.rs",
        ];
        assert_eq!(top("main rs", &rels)[0], "main.rs");
        assert_eq!(top("docs report", &rels)[0], "report-2026.pdf");
        assert_eq!(top("dwnlds", &rels)[0], "Downloads");
        assert!(top("zzz", &rels).is_empty());
    }

    #[test]
    fn the_walks_fd_is_asked_for() {
        assert_eq!(walk_args(&["docs".into(), "re.port".into()], false), ["[^/]*re\\.port[^/]*/?$", "docs"]);
        assert_eq!(walk_args(&["ab".into()], true), ["[^/]*a[^/]*b[^/]*/?$"]);
        assert_eq!(key("  docs/ Report ", false).as_deref(), Some("docs report"));
        assert_eq!(key("a", false), None);
        assert_eq!(key("ab", true).as_deref(), Some("ab\nh"));
    }

    #[test]
    fn paths_from_fd() {
        let found =
            entries(&["/home/u/a.txt\0/home/u/Docs/\0/etc/x\0/home/u/cut".into(), "/home/u/a.txt\0".into()], "/home/u");
        let rels: Vec<_> = found.iter().map(|e| (e.rel.as_str(), e.dir)).collect();
        assert_eq!(rels, [("a.txt", false), ("Docs", true)]);
    }

    #[test]
    fn letters_that_change_length_in_lower_case() {
        let rels = ["İẞx", "a-ẞx", "x/İnfo.md"];
        assert_eq!(top("ßx", &rels).len(), 2);
        assert_eq!(top("info", &rels)[0], "İnfo.md");
    }
}
