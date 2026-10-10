//! A web address typed into the bar opens in your default browser. A port of
//! extensions/url/provider.js, with the host checked by libraries rather than
//! by hand: std for IP addresses, idna (UTS #46, as browsers apply it) for
//! domain names, and the Public Suffix List (psl) for whether a name ends in a
//! real top-level domain.
//!
//!   example.com/path?q=1 · http://localhost:3000 · 192.168.1.1:8080
//!
//! Bare file names (readme.md, notes.txt, archive.zip) stay files: they need a
//! scheme, a port or a path before they read as an address.
//!
//! Where it does better than the JS, on purpose: a bare name needs a
//! top-level domain that exists, so "mr.smith", "e.g" and "john.doe" stay
//! words. Names kept for private networks (.local, .lan, .internal, .test,
//! home.arpa and the like) still open.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::LazyLock;

use regex::Regex;

use crate::{Answer, Context, Extension, Row};

// Launcher queries are full of file names, and a file extension is not a
// reliable tell: some are no TLD at all (notes.txt), others are live ones
// (readme.md, archive.zip). Bare two-part words ending in one of these are a
// file far more often than a host, so they need a scheme, a prefix, a port or
// a path before the bar offers to open a browser. Extensions that read as
// ordinary destinations stay out: io, co, rs, dev, app, ai, me, tv, so, cc.
#[rustfmt::skip]
const FILE_TAILS: &[&str] = &[
    "txt", "md", "rst", "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "log", "csv", "tsv", "xml", "html", "htm", "css", "scss", "sass", "less",
    "js", "jsx", "ts", "tsx", "py", "pyc", "sh", "bash", "zsh", "fish", "lua", "rb", "php", "java", "kt", "swift", "cpp", "hpp", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "psd", "mp3", "mp4", "mkv", "webm", "mov", "wav", "flac", "ogg",
    "zip", "tar", "gz", "bz2", "xz", "zst", "rar", "iso", "deb", "rpm", "exe", "dll", "bin", "img", "bak", "tmp", "swp", "lock", "patch", "diff",
    "sql", "db", "sqlite", "epub", "ttf", "otf", "woff", "woff2", "desktop", "service", "socket", "nix", "whl", "jar", "apk", "dmg", "msi", "srt", "torrent",
];

// Not public suffixes, but names people give machines on their own network:
// RFC 6761 (test, localhost, invalid), RFC 6762 (local), RFC 8375
// (home.arpa), ICANN's .internal, and the long-standing lan, home, corp,
// intranet, private and localdomain.
const PRIVATE_TLDS: &[&str] =
    &["local", "lan", "home", "internal", "intranet", "corp", "private", "localdomain", "test", "localhost", "invalid"];

static SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(https?)://").unwrap());
static AUTHORITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$").unwrap());
static FORBIDDEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[\s\x00-\x1f\x7f\\<>"`]"#).unwrap());
static DOTTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9.]+$").unwrap());

/// The dotted quad the JS accepts: four parts, 0-255, no leading zeros.
fn ipv4(host: &str) -> bool {
    host.split('.').count() == 4 && host.parse::<Ipv4Addr>().is_ok()
}

fn file_tail(host: &str) -> bool {
    let name = host.trim_end_matches('.');
    match name.rsplit_once('.') {
        Some((_, tail)) => FILE_TAILS.contains(&tail.to_lowercase().as_str()),
        None => false,
    }
}

/// A domain name a browser would take: valid under UTS #46 and DNS's
/// length and letter rules. Without a scheme or prefix it also needs a dot
/// and a top-level domain that exists (or a private-network one).
fn domain(host: &str, explicit: bool) -> bool {
    let name = host.strip_suffix('.').unwrap_or(host);
    if name.is_empty() || name.chars().count() > 253 {
        return false;
    }
    let Ok(ascii) = idna::domain_to_ascii_strict(name) else { return false };
    if ascii.is_empty() || ascii.split('.').any(|l| l.is_empty() || l.len() > 63) {
        return false;
    }
    if explicit || ascii == "localhost" {
        return true;
    }
    let Some((_, tld)) = ascii.rsplit_once('.') else { return false };
    if PRIVATE_TLDS.contains(&tld) || ascii.ends_with(".home.arpa") {
        return true;
    }
    (tld.bytes().all(|b| b.is_ascii_alphabetic()) || tld.starts_with("xn--"))
        && psl::suffix(ascii.as_bytes()).is_some_and(|s| s.is_known())
}

/// The URL to open for what was typed, as typed with a scheme added, or None.
/// A typed prefix (`explicit`) permits a single-label intranet host.
/// Unprefixed text needs a domain, IP, localhost or an explicit http(s)
/// scheme to be high confidence. Other schemes belong to other extensions.
pub fn parse(value: &str, explicit: bool) -> Option<String> {
    let text = value.trim();
    if text.is_empty() || FORBIDDEN.is_match(text) {
        return None;
    }
    let scheme = SCHEME.find(text);
    let relative = text.starts_with("//");
    let rest = match scheme {
        Some(m) => &text[m.end()..],
        None if relative => &text[2..],
        None => text,
    };
    let split = rest.find(['/', '?', '#']);
    let (mut authority, suffix) = match split {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return None;
    }
    // Userinfo is unambiguous only with an explicit scheme (never an email).
    if let Some(at) = authority.rfind('@') {
        let user = &authority[..at];
        if scheme.is_none() || user.is_empty() || user.contains('@') {
            return None;
        }
        authority = &authority[at + 1..];
    }
    let m = AUTHORITY.captures(authority)?;
    let port = m.get(2);
    if let Some(p) = port {
        if !matches!(p.as_str().parse::<u32>(), Ok(1..=65535)) {
            return None;
        }
    }
    let host = &m[1];
    let local = if let Some(inner) = host.strip_prefix('[') {
        inner.strip_suffix(']')?.parse::<Ipv6Addr>().ok()?;
        true
    } else if DOTTED.is_match(host) {
        if !ipv4(host) {
            return None;
        }
        true
    } else {
        if !domain(host, scheme.is_some() || explicit) {
            return None;
        }
        if scheme.is_none() && !explicit && suffix.is_empty() && port.is_none() && file_tail(host) {
            return None;
        }
        let lower = host.trim_end_matches('.').to_lowercase();
        lower == "localhost" || lower.ends_with(".localhost")
    };
    // Explicit schemes always win. Bare IP/localhost addresses are commonly
    // local HTTP services; all other scheme-less destinations default to HTTPS.
    Some(match scheme {
        Some(_) => text.to_string(),
        None if relative => format!("https:{text}"),
        None if local => format!("http://{text}"),
        None => format!("https://{text}"),
    })
}

pub struct Url;

impl Extension for Url {
    fn id(&self) -> &'static str {
        "url"
    }

    fn matches(&self, query: &str, _ctx: &Context) -> Answer {
        let Some(url) = parse(query, false) else { return Answer::default() };
        Answer {
            rows: vec![Row {
                title: format!("Open {url}"),
                subtitle: "Default browser".into(),
                icon: String::new(),
                score: 93.0,
                copy: url.clone(),
                run: Some(serde_json::json!({ "kind": "open", "target": url, "label": "open" })),
                alt: Some(serde_json::json!({ "kind": "copy", "target": url, "label": "copy" })),
                ..Default::default()
            }],
            ttl_ms: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(q: &str) -> Option<String> {
        parse(q, false)
    }

    #[test]
    fn addresses() {
        assert_eq!(open("example.com/a?b=1").as_deref(), Some("https://example.com/a?b=1"));
        assert_eq!(open("localhost:3000").as_deref(), Some("http://localhost:3000"));
        assert_eq!(open("192.168.1.1:8080").as_deref(), Some("http://192.168.1.1:8080"));
        assert_eq!(open("[::1]:8080").as_deref(), Some("http://[::1]:8080"));
        assert_eq!(open("http://intranet").as_deref(), Some("http://intranet"));
        assert_eq!(open("//example.com").as_deref(), Some("https://example.com"));
        assert_eq!(open("bücher.de").as_deref(), Some("https://bücher.de"));
        assert_eq!(open("xn--bcher-kva.de").as_deref(), Some("https://xn--bcher-kva.de"));
        assert_eq!(open("https://user:pw@example.com").as_deref(), Some("https://user:pw@example.com"));
        assert_eq!(open("readme.md/").as_deref(), Some("https://readme.md/"));
    }

    #[test]
    fn not_addresses() {
        for q in [
            "readme.md",
            "1.5",
            "notes.txt",
            "hello world",
            "hello",
            "user@example.com",
            "example.com:0",
            "example.com:70000",
            "1.2.3.256",
            "01.2.3.4",
            "1.2.3",
            "[::g]",
            "ftp://example.com",
            "javascript:alert(1)",
            "-bad.com",
            "a_b.com",
            "<x>.com",
        ] {
            assert_eq!(open(q), None, "{q}");
        }
    }

    #[test]
    fn a_bare_name_needs_a_real_tld() {
        for q in ["mr.smith", "john.doe", "e.g", "foo.notatld"] {
            assert_eq!(open(q), None, "{q}");
        }
        for q in
            ["nas.local", "router.lan", "printer.home.arpa", "svc.internal", "app.test", "github.io", "example.co.uk"]
        {
            assert!(open(q).is_some(), "{q}");
        }
        assert_eq!(parse("intranet", true).as_deref(), Some("https://intranet"));
    }
}
