//! Packages from the repositories in your pacman.conf; the AUR isn't
//! searched. A port of extensions/packages/provider.js.
//!
//!   pkg kfind · pkg file search
//!
//! The list is the manifest's "list" load: expac's installed packages, then
//! every package in the sync databases, read by the bar the first time
//! "pkg " is typed after it opens and dropped when it closes. Nothing is
//! fetched from the network.
//!
//! Enter on a package you don't have copies `sudo pacman -S <repo>/<name>`;
//! with "install": true it is the manifest's "install" action, a terminal
//! where sudo and pacman both ask first. Enter on one you have shows
//! `pacman -Qi` ("details"). Shift+Enter opens its page on archlinux.org for
//! Arch's own repositories, `pacman -Si` ("repo_details") for others. Only
//! names pacman itself allows are offered, and they reach bash as $1.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;

use crate::{Answer, Context, Extension, Memo, Row};

const LIMIT: usize = 30;

static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)^\s*(?:pkg|pacman)\s(.*)$").unwrap());
static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9@_+][a-z0-9@._+-]{0,127}$").unwrap());
static REPO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9._-]{1,64}$").unwrap());
static ARCH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9_]+$").unwrap());
static ARCH_REPOS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(core|extra|multilib)(-testing|-staging)?$|^(core|extra)-debug$").unwrap());

#[derive(Debug)]
pub struct Package {
    repo: String,
    name: String,
    version: String,
    arch: String,
    desc: String,
    /// The name, and the name and description, in lower case: searched on
    /// every keystroke, so made once.
    lower: String,
    hay: String,
}

#[derive(Debug, Default)]
pub struct List {
    installed: HashMap<String, String>,
    list: Vec<Package>,
}

/// Lines "Q\tname\tversion" and "S\trepo\tname\tversion\tarch\tdescription".
pub fn parse(text: &str) -> List {
    let mut out = List::default();
    for line in text.split('\n') {
        let f: Vec<&str> = line.split('\t').collect();
        if f[0] == "Q" && f.len() >= 3 && NAME.is_match(f[1]) {
            out.installed.insert(f[1].to_string(), f[2].to_string());
        } else if f[0] == "S" && f.len() >= 6 && REPO.is_match(f[1]) && NAME.is_match(f[2]) {
            let desc = f[5..].join(" ");
            let lower = f[2].to_lowercase();
            out.list.push(Package {
                repo: f[1].into(),
                name: f[2].into(),
                version: f[3].into(),
                arch: if ARCH.is_match(f[4]) { f[4].into() } else { "x86_64".into() },
                hay: format!("{lower} {}", desc.to_lowercase()),
                lower,
                desc,
            });
        }
    }
    out
}

/// Higher is better: the exact name, a name starting with the first word, a
/// name containing it, then every word somewhere in name or description.
fn rank(p: &Package, ws: &[String]) -> f64 {
    let name = &p.lower;
    if !ws.iter().all(|w| p.hay.contains(w.as_str())) {
        return 0.0;
    }
    if *name == ws.join("-") || *name == ws.join("") {
        return 4.0;
    }
    let len = name.encode_utf16().count() as f64;
    if name.starts_with(ws[0].as_str()) {
        return 3.0 - len * 0.001;
    }
    if name.contains(ws[0].as_str()) {
        return 2.0 - len * 0.001;
    }
    1.0
}

/// JavaScript's encodeURIComponent, for the characters a package name has.
fn uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn row(p: &Package, installed: &HashMap<String, String>, n: usize, install: bool) -> Row {
    let have = installed.get(&p.name);
    let qualified = format!("{}/{}", p.repo, p.name);
    let state = match have {
        Some(v) if *v != p.version => format!(" · installed {v}"),
        Some(_) => " · installed".into(),
        None => String::new(),
    };
    let desc = if p.desc.is_empty() { String::new() } else { format!(" · {}", p.desc) };
    let run = if have.is_some() {
        json!({ "kind": "action", "name": "details", "args": [p.name] })
    } else if install {
        json!({ "kind": "action", "name": "install", "args": [p.name, qualified] })
    } else {
        json!({ "kind": "copy", "target": format!("sudo pacman -S {qualified}"), "label": "copy install command" })
    };
    let alt = if ARCH_REPOS.is_match(&p.repo) {
        let url = format!(
            "https://archlinux.org/packages/{}/{}/{}/",
            uri_component(&p.repo),
            uri_component(&p.arch),
            uri_component(&p.name)
        );
        json!({ "kind": "open", "target": url, "label": "archlinux.org" })
    } else {
        json!({ "kind": "action", "name": "repo_details", "args": [p.name, qualified] })
    };
    Row {
        title: p.name.clone(),
        subtitle: format!("{} · {}{state}{desc}", p.version, p.repo),
        icon: (if have.is_some() { "󰏗" } else { "󰏔" }).into(),
        score: 97.0 - n as f64 * 0.001,
        run: Some(run),
        alt: Some(alt),
        ..Default::default()
    }
}

fn note(title: String, subtitle: &str) -> Answer {
    vec![Row { title, subtitle: subtitle.into(), score: 40.0, ..Default::default() }].into()
}

static LIST: Memo<List> = Memo::new();

pub struct Packages;

impl Extension for Packages {
    fn id(&self) -> &'static str {
        "packages"
    }

    fn forget(&self, _load: &str) {
        LIST.forget();
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        let Some(m) = MODE.captures(query) else { return Answer::default() };
        let text = m.get(1).map_or("", |x| x.as_str());
        let ws: Vec<String> = text.to_lowercase().split_whitespace().map(str::to_string).collect();
        let Some(load) = ctx.load("list") else { return note("Reading the package list…".into(), "Packages") };
        let data = LIST.get(load, parse);
        if data.list.is_empty() {
            return note("Couldn't read the package list".into(), "Packages · is expac installed? (pacman -S expac)");
        }
        if ws.is_empty() {
            let about =
                format!("{} packages in your repositories, {} installed", data.list.len(), data.installed.len());
            return note("Type a package name or words".into(), &about);
        }
        let mut hits: Vec<(f64, &Package)> =
            data.list.iter().map(|p| (rank(p, &ws), p)).filter(|(r, _)| *r > 0.0).collect();
        hits.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap()
                .then_with(|| if a.1.name < b.1.name { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater })
        });
        if hits.is_empty() {
            return note(
                format!("No package matches \"{}\"", text.trim()),
                "Packages · your pacman repositories, no AUR",
            );
        }
        let install = ctx.settings.get("install").and_then(|v| v.as_bool()) == Some(true);
        hits.iter()
            .take(LIMIT)
            .enumerate()
            .map(|(n, (_, p))| row(p, &data.installed, n, install))
            .collect::<Vec<_>>()
            .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Load, Loads};
    use serde_json::Value;

    const LIST_TEXT: &str = "Q\tkfind\t25.08-1\nQ\tplocate\t1.1.24-1\n\
        S\textra\tkfind\t25.08-1\tx86_64\tFind files\n\
        S\textra\tplocate\t1.1.25-1\tx86_64\tAlternative to locate, faster\n\
        S\tomarchy\tomarchy-thing\t1-1\tany\tOmarchy's own\n\
        S\textra\t$(touch x)\t1\tany\tevil name\n";

    fn ask(q: &str, settings: Value) -> Vec<Row> {
        let mut loads = Loads::new();
        loads.insert(("packages".into(), "list".into()), Load { text: LIST_TEXT.into(), generation: 1 });
        let data = crate::Data::new();
        let ctx =
            Context::with_loads(&settings, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &data, "packages", &loads);
        Packages.matches(q, &ctx).rows
    }

    #[test]
    fn finds_and_says_what_you_have() {
        let rows = ask("pkg locate", Value::Null);
        assert_eq!(rows[0].title, "plocate");
        assert_eq!(rows[0].subtitle, "1.1.25-1 · extra · installed 1.1.24-1 · Alternative to locate, faster");
        assert_eq!(rows[0].run, Some(json!({ "kind": "action", "name": "details", "args": ["plocate"] })));
        assert_eq!(rows[0].alt.as_ref().unwrap()["target"], "https://archlinux.org/packages/extra/x86_64/plocate/");
        let thing = &ask("pkg omarchy", Value::Null)[0];
        assert_eq!(thing.run.as_ref().unwrap()["target"], "sudo pacman -S omarchy/omarchy-thing");
        assert_eq!(
            thing.alt,
            Some(
                json!({ "kind": "action", "name": "repo_details", "args": ["omarchy-thing", "omarchy/omarchy-thing"] })
            )
        );
        let install = &ask("pkg omarchy", json!({ "install": true }))[0];
        assert_eq!(
            install.run,
            Some(json!({ "kind": "action", "name": "install", "args": ["omarchy-thing", "omarchy/omarchy-thing"] }))
        );
    }

    #[test]
    fn notes() {
        assert_eq!(ask("pkg ", Value::Null)[0].subtitle, "3 packages in your repositories, 2 installed");
        assert_eq!(ask("pkg evil", Value::Null)[0].title, "No package matches \"evil\"");
        assert!(ask("pkgx", Value::Null).is_empty());
    }
}
