//! A path as a row for Punctum (or --json), and the home index.

use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::search::{cache_dir, home_db};

fn kind_of(path: &str, is_dir: bool) -> &'static str {
    if is_dir {
        return "folder";
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some(dot) = name.rfind('.').filter(|d| *d > 0) else { return "file" };
    match name[dot + 1..].to_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "avif" | "bmp" | "tiff" | "heic" => "image",
        "pdf" => "pdf",
        "zip" | "tar" | "gz" | "xz" | "zst" | "7z" | "bz2" | "rar" => "archive",
        "mp3" | "flac" | "ogg" | "wav" | "m4a" | "opus" => "audio",
        "mp4" | "mkv" | "webm" | "mov" | "avi" => "video",
        "md" | "txt" | "json" | "toml" | "yaml" | "yml" | "conf" | "csv" | "ini" | "log" => "text",
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

/// ~/x for a path under home.
pub fn short(path: &str, home: &str) -> String {
    let h = home.trim_end_matches('/');
    if path == h || path.starts_with(&format!("{h}/")) { format!("~{}", &path[h.len()..]) } else { path.to_string() }
}

pub fn human_size(n: u64) -> String {
    let mut v = n as f64;
    for unit in ["B", "KB", "MB", "GB"] {
        if v < 1024.0 || unit == "GB" {
            return if unit == "B" { format!("{} {unit}", v as u64) } else { format!("{v:.1} {unit}") };
        }
        v /= 1024.0;
    }
    unreachable!()
}

pub fn human_age(t: f64) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64());
    let d = (now - t).max(0.0);
    for (size, unit) in [(86400.0 * 365.0, "y"), (86400.0, "d"), (3600.0, "h"), (60.0, "min")] {
        if d >= size {
            return format!("{} {unit} ago", (d / size).floor() as u64);
        }
    }
    "just now".into()
}

/// The row for a path: its name, its folder (and with `details` its size
/// and age), Enter opens it, Shift+Enter a terminal in its folder.
pub fn item(path: &str, home: &str, details: bool) -> Value {
    let st = std::fs::metadata(path).ok();
    let is_dir = st.as_ref().is_some_and(|s| s.is_dir());
    let slash = path.rfind('/').unwrap_or(0);
    let name = if path[slash + 1..].is_empty() { "/" } else { &path[slash + 1..] };
    let folder = if slash == 0 { "/" } else { &path[..slash] };
    let k = kind_of(path, is_dir);
    let mut subtitle = short(folder, home) + if is_dir { " · Folder" } else { "" };
    if details && let Some(st) = &st {
        let when = human_age(st.mtime() as f64 + st.mtime_nsec() as f64 / 1e9);
        subtitle += &if is_dir { format!(" · {when}") } else { format!(" · {} · {when}", human_size(st.len())) };
    }
    json!({
        "title": name,
        "subtitle": subtitle,
        "icon": icon(k),
        // Only a regular file goes to the image loader: a FIFO named x.png
        // would block the thread that reads it.
        "image": if k == "image" && st.as_ref().is_some_and(|s| s.is_file()) { path } else { "" },
        "run": { "kind": "open", "target": path, "label": if is_dir { "open folder" } else { "open" } },
        "alt": { "kind": "argv", "target": ["uwsm-app", "--", "xdg-terminal-exec", format!("--dir={}", if is_dir { path } else { folder })], "label": "terminal here" },
    })
}

/// Rebuild the index of your home folder with updatedb, unless it's younger
/// than `max_age` seconds. It's written to a file of its own and moved into
/// place, so a refresh from the bar and one from a terminal at the same
/// moment can't write into each other; the folder is 700 and the index 600.
pub fn index(max_age: Option<f64>) -> i32 {
    let db = home_db();
    // Young enough: younger than max_age (any age, for an endless one), or
    // dated in the future, as Python's arithmetic counts it.
    if let (Some(age), Ok(st)) = (max_age, std::fs::metadata(&db))
        && let Ok(modified) = st.modified()
    {
        let young = match (modified.elapsed(), Duration::try_from_secs_f64(age.max(0.0))) {
            (Err(_), _) => true,
            (Ok(_), Err(_)) => true,
            (Ok(e), Ok(limit)) => e < limit,
        };
        if young {
            return 0;
        }
    }
    let dir = cache_dir();
    if std::fs::create_dir_all(&dir).is_err()
        || std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).is_err()
    {
        eprintln!("everywhere: can't make {}", dir.display());
        return 1;
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let tmp = dir.join(format!("home.db.{}.{nanos}", std::process::id()));
    if std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp).is_err() {
        eprintln!("everywhere: can't write {}", tmp.display());
        return 1;
    }
    let home = crate::search::home();
    let ok =
        match Command::new("updatedb").args(["-l", "0", "-U", &home, "-o"]).arg(&tmp).stdout(Stdio::null()).status() {
            Ok(s) => s.success(),
            Err(e) => {
                eprintln!("everywhere: can't run updatedb ({e}); it comes with plocate");
                false
            }
        };
    let done = ok
        && std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).is_ok()
        && std::fs::rename(&tmp, &db).is_ok();
    let _ = std::fs::remove_file(&tmp);
    if done { 0 } else { 1 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_names() {
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(5 << 40), "5120.0 GB");
        assert_eq!(short("/home/u/x", "/home/u"), "~/x");
        assert_eq!(short("/home/uv/x", "/home/u"), "/home/uv/x");
        assert_eq!(kind_of("/a/b.JPG", false), "image");
        assert_eq!(kind_of("/a/.bashrc", false), "file");
        let row = item("/etc", "/home/u", false);
        assert_eq!(row["title"], "etc");
        assert_eq!(row["subtitle"], "/ · Folder");
        assert_eq!(row["alt"]["target"][3], "--dir=/etc");
    }
}
