//! Kill a running process. A port of extensions/processes/provider.js.
//!
//!   kill · kill chrome · kill -9 chrome · kill chrm
//!
//! The list is the manifest's "ps" load: your own processes, read again at
//! most every 1.5 s while the bar is open and dropped when it closes (a
//! command line can hold a token). Enter is the manifest's "quit" or
//! "force_quit" action, kill -TERM or -KILL with the pids as its arguments.
//! On top of the JS's rules, a name with the typed letters in order
//! ("chrm") is found, below every other match.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;

use crate::apps::letters_in_order;
use crate::format::js_round;
use crate::{Answer, Context, Extension, Memo, Row};

const LIMIT: usize = 30;

static MODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*kill(?:\s+(-9|-KILL|--force))?(?:\s+(.*))?$").unwrap());
static LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*([0-9]+)\s+([0-9]+)\s+([0-9.]+) (.{40}) (.*)$").unwrap());

#[derive(Debug, Clone)]
pub struct Process {
    pid: u32,
    rss: f64,
    cpu: f64,
    name: String,
    args: String,
}

/// ps's lines, "pid rss pcpu comm(40) args"; ps itself left out.
pub fn parse(text: &str) -> Vec<Process> {
    text.split('\n')
        .filter_map(|l| {
            let m = LINE.captures(l)?;
            let name = m[4].trim().to_string();
            if name == "ps" {
                return None;
            }
            Some(Process {
                pid: m[1].parse().ok()?,
                rss: m[2].parse().ok()?,
                cpu: m[3].parse().ok()?,
                name,
                args: m[5].to_string(),
            })
        })
        .collect()
}

/// JavaScript's toFixed(1) on kib / 1024² : exact, ties up.
fn gigabytes(kib: f64) -> String {
    let tenths = kib * 10.0 / 1_048_576.0;
    let n = tenths.floor() + if tenths - tenths.floor() >= 0.5 { 1.0 } else { 0.0 };
    format!("{}.{}", (n / 10.0).floor(), n % 10.0)
}

fn megabytes(kib: f64) -> String {
    let mb = kib / 1024.0;
    if mb >= 1024.0 { format!("{} GB", gigabytes(kib)) } else { format!("{} MB", js_round(mb)) }
}

fn note(title: String) -> Answer {
    vec![Row { title, subtitle: "Processes".into(), score: 40.0, ..Default::default() }].into()
}

static LIST: Memo<Vec<Process>> = Memo::new();

pub struct Processes;

impl Extension for Processes {
    fn id(&self) -> &'static str {
        "processes"
    }

    fn forget(&self, _load: &str) {
        LIST.forget();
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let Some(m) = MODE.captures(query) else { return Answer::default() };
        let force = m.get(1).is_some();
        let needle = m.get(2).map_or("", |x| x.as_str()).trim().to_lowercase();
        let Some(load) = ctx.load("ps") else { return note("Reading your processes…".into()) };
        let list = LIST.get(load, parse);
        let action = if force { "force_quit" } else { "quit" };
        let verb = if force { "Force quit" } else { "Quit" };

        let mut hits: Vec<(f64, &Process)> = list
            .iter()
            .filter_map(|p| {
                let name = p.name.to_lowercase();
                let r = if needle.is_empty() {
                    1.0
                } else if name == needle {
                    3.0
                } else if name.starts_with(&needle) {
                    2.0
                } else if format!("{name} {}", p.args.to_lowercase()).contains(&needle) {
                    1.0
                } else if letters_in_order(&p.name, &needle).is_some() {
                    0.5
                } else {
                    0.0
                };
                (r > 0.0).then_some((r, p))
            })
            .collect();
        if hits.is_empty() {
            return note(if needle.is_empty() {
                "No processes found".into()
            } else {
                format!("No process matches \"{needle}\"")
            });
        }
        hits.sort_by(|a, b| b.0.total_cmp(&a.0).then(b.1.cpu.total_cmp(&a.1.cpu)).then(b.1.rss.total_cmp(&a.1.rss)));

        let mut out = Vec::new();
        // Several processes with the name you typed (browsers, electron
        // apps): offer to quit them all at once.
        if !needle.is_empty() {
            let first = hits[0].1.name.to_lowercase();
            let group: Vec<&Process> = hits.iter().filter(|h| h.1.name.to_lowercase() == first).map(|h| h.1).collect();
            if group.len() > 1 {
                let rss: f64 = group.iter().map(|p| p.rss).sum();
                let pids: Vec<String> = group.iter().map(|p| p.pid.to_string()).collect();
                out.push(Row {
                    title: format!("{verb} all {} \"{}\" processes", group.len(), hits[0].1.name),
                    subtitle: format!(
                        "{} total · pids {}{}",
                        megabytes(rss),
                        pids.iter().take(6).cloned().collect::<Vec<_>>().join(", "),
                        if pids.len() > 6 { "…" } else { "" }
                    ),
                    score: 97.0,
                    run: Some(json!({ "kind": "action", "name": action, "args": pids })),
                    ..Default::default()
                });
            }
        }
        for (j, (_, p)) in hits.iter().take(LIMIT).enumerate() {
            out.push(Row {
                title: format!("{verb} {}", p.name),
                subtitle: format!("pid {} · {} · {:.1}% CPU · {}", p.pid, megabytes(p.rss), p.cpu, p.args),
                score: 96.0 - j as f64 * 0.01,
                copy: p.pid.to_string(),
                run: Some(json!({ "kind": "action", "name": action, "args": [p.pid.to_string()] })),
                ..Default::default()
            });
        }
        out.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(pid: u32, rss: u32, cpu: &str, name: &str, args: &str) -> String {
        format!("{pid:>7} {rss:>8} {cpu:>4} {name:<40} {args}")
    }

    fn ask(q: &str) -> Vec<Row> {
        let text = [
            line(10, 2_000_000, "12.5", "chrome", "/opt/chrome --type=renderer"),
            line(11, 300_000, "3.0", "chrome", "/opt/chrome"),
            line(12, 50_000, "0.0", "nvim", "nvim notes.md"),
            line(13, 1000, "0.0", "ps", "ps -u 1000"),
        ]
        .join("\n");
        let mut loads = crate::Loads::new();
        loads.insert(("processes".into(), "ps".into()), crate::Load { text: text.into(), generation: 1 });
        let data = crate::Data::new();
        let ctx = Context::with_loads(
            &serde_json::Value::Null,
            jiff::Timestamp::now(),
            jiff::tz::TimeZone::UTC,
            &data,
            "processes",
            &loads,
        );
        Processes.matches(q, &ctx).rows
    }

    #[test]
    fn quits_one_or_all() {
        let r = ask("kill chrome");
        assert_eq!(r[0].title, "Quit all 2 \"chrome\" processes");
        assert_eq!(r[0].subtitle, "2.2 GB total · pids 10, 11");
        assert_eq!(r[0].run, Some(json!({ "kind": "action", "name": "quit", "args": ["10", "11"] })));
        assert_eq!(r[1].subtitle, "pid 10 · 1.9 GB · 12.5% CPU · /opt/chrome --type=renderer");
        let f = ask("kill -9 nvim");
        assert_eq!(f[0].title, "Force quit nvim");
        assert_eq!(f[0].run, Some(json!({ "kind": "action", "name": "force_quit", "args": ["12"] })));
        assert_eq!(ask("kill chrm")[1].title, "Quit chrome");
        assert_eq!(ask("kill ").len(), 3);
        assert_eq!(ask("kill zzz")[0].title, "No process matches \"zzz\"");
        assert!(ask("killer").is_empty());
    }
}
