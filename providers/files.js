.pragma library

// Files and folders under the home folder, found with `fd`. Adapted from
// Keystroke's core/Files.js (MIT, Arseniy Zarechnev, evindor/keystroke).
//
//   ~readme          names containing r…e…a…d…m…e in order
//   ~docs report     "report" in the name, under something matching "docs"
//
// The provider is pure: it says which fd argv answers a query (ctx.requestFiles)
// and turns the paths that come back (ctx.files) into rows. fd runs from
// CommandBar.qml as an argument list, never through a shell; the typed words
// are regex-escaped and come after `--` or inside `--and=`, so none of them can
// be read as an option. Enter opens with the default app; Shift+Enter opens a
// terminal in the folder.

var MIN_QUERY = 2
var CANDIDATES = 400
var LIMIT = 30
var MAX_QUERY = 128

function prefix(query) { return String(query || "").match(/^\s*~\/?(.*)$/) }

function words(query) {
  return String(query || "").trim().split(/[\s\/]+/).filter(function(w) { return w.length > 0 })
}

function escapeRegex(word) { return word.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&") }

// Fuzzy: the letters in order, anywhere within one path segment.
function pattern(word) { return Array.from(word).map(escapeRegex).join("[^/]*") }

// Null when there's nothing worth asking fd.
function key(query, settings) {
  var ws = words(query)
  if (!ws.length || ws.join("").length < MIN_QUERY || String(query).length > MAX_QUERY || ws.length > 8 || /[\u0000-\u001f]/.test(query)) return null
  return ws.join(" ").toLowerCase() + (settings && settings.hidden ? "\nh" : "")
}

function argv(query, home, settings) {
  var ws = words(query)
  var out = ["fd", "--ignore-case", "--full-path", "--color", "never", "--absolute-path",
             "--base-directory", home, "--max-results", String(CANDIDATES), "--threads", "2", "--print0"]
  if (settings && settings.hidden) out.push("--hidden", "--exclude", ".git")
  for (var i = 0; i < ws.length - 1; i++) out.push("--and=" + pattern(ws[i]))
  out.push("--", "[^/]*" + pattern(ws[ws.length - 1]) + "[^/]*/?$")
  return out
}

// NUL-delimited, so a name with a newline in it stays one entry. A walk cut
// short may end mid-record, so the unterminated tail is dropped.
function parse(output, home) {
  var lines = String(output || "").split("\u0000"), out = []
  var root = String(home).replace(/\/+$/, "") + "/"
  for (var i = 0; i < lines.length - 1; i++) {
    var line = lines[i]
    if (!line) continue
    var dir = line.charAt(line.length - 1) === "/"
    var abs = dir ? line.slice(0, -1) : line
    if (abs.indexOf(root) !== 0 || abs.length === root.length) continue
    out.push({ path: abs, rel: abs.slice(root.length), dir: dir })
  }
  return out
}

function baseName(rel) { var s = rel.lastIndexOf("/"); return s >= 0 ? rel.slice(s + 1) : rel }
function parentOf(rel) { var s = rel.lastIndexOf("/"); return s >= 0 ? rel.slice(0, s) : "" }

var ICONS = { folder: "󰉋", image: "󰋩", pdf: "󰈦", archive: "󰀼", audio: "󰈣", video: "󰈫", text: "󰈙", file: "󰈔" }
var KIND = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", svg: "image", avif: "image",
  pdf: "pdf", zip: "archive", tar: "archive", gz: "archive", xz: "archive", zst: "archive", "7z": "archive",
  mp3: "audio", flac: "audio", ogg: "audio", wav: "audio", m4a: "audio", opus: "audio",
  mp4: "video", mkv: "video", webm: "video", mov: "video",
  md: "text", txt: "text", json: "text", toml: "text", yaml: "text", yml: "text", conf: "text", csv: "text"
}

function kindOf(entry) {
  if (entry.dir) return "folder"
  var name = baseName(entry.rel), dot = name.lastIndexOf(".")
  return (dot > 0 && KIND[name.slice(dot + 1).toLowerCase()]) || "file"
}

// fd matched the absolute path, so a word like the user name hits everything;
// re-check below home: the last word in the name, the others in the path.
function subsequence(text, word) {
  for (var i = 0, j = 0; i < text.length; i++) {
    if (text.charAt(i) === "/") { j = 0; continue }
    if (text.charAt(i) === word.charAt(j) && ++j === word.length) return true
  }
  return false
}

function matches(entry, ws) {
  var hay = entry.rel.toLowerCase()
  if (!subsequence(baseName(hay), ws[ws.length - 1].toLowerCase())) return false
  for (var i = 0; i < ws.length - 1; i++) if (!subsequence(hay, ws[i].toLowerCase())) return false
  return true
}

// Higher is better: the name starting with the word, then containing it,
// then a scattered match; shallower paths, then shorter names, win ties.
function rank(entry, ws) {
  var name = baseName(entry.rel).toLowerCase(), last = ws[ws.length - 1].toLowerCase()
  var r = name.indexOf(last) === 0 ? 3 : (name.indexOf(last) >= 0 ? 2 : 1)
  return r - entry.rel.split("/").length * 0.01 - name.length * 0.0001
}

function row(entry, n) {
  var parent = parentOf(entry.rel)
  var dir = entry.dir ? entry.path : entry.path.slice(0, entry.path.lastIndexOf("/"))
  return {
    title: baseName(entry.rel),
    subtitle: (parent ? "~/" + parent : "~") + (entry.dir ? " · Folder" : ""),
    icon: ICONS[kindOf(entry)],
    image: kindOf(entry) === "image" ? entry.path : "",
    score: 97 - n * 0.001,
    copy: "",
    run: { kind: "argv", target: ["xdg-open", entry.path], label: entry.dir ? "open folder" : "open" },
    alt: { kind: "argv", target: ["uwsm-app", "--", "xdg-terminal-exec", "--dir=" + dir], label: "terminal here" }
  }
}

var provider = {
  id: "files",
  name: "Files",
  icon: "󰈞",
  commands: [
    { title: "Find files", keywords: "files folders find search home documents", text: "Files and folders under your home folder", complete: "~" }
  ],
  help: [
    { id: "files", title: "Find files", about: "~ and part of a name. Letters may skip: ~dwnlds finds Downloads. Shift+Enter opens a terminal there",
      examples: [{ q: "~", note: "Type a name after it" }, { q: "~readme", hint: "Files named like readme" }, { q: "~docs report", hint: "\"report\" under a folder like docs" }] }
  ],
  match: function(query, ctx) {
    var m = prefix(query)
    if (!m) return []
    var settings = ctx.settings || {}
    var k = key(m[1], settings)
    if (!k) return [{ title: "Type a file or folder name", subtitle: "At least two letters · searches under ~", score: 40, copy: "" }]
    var have = ctx.files
    if (!have || have.key !== k) {
      if (ctx.requestFiles) ctx.requestFiles(k, argv(m[1], ctx.home, settings))
      // Rows from the previous query stay until fd answers, so the list
      // doesn't flash empty on every keystroke.
      if (!have) return [{ title: "Searching…", subtitle: "Files", score: 40, copy: "" }]
    }
    var ws = words(m[1])
    var hits = have.entries.filter(function(e) { return matches(e, ws) })
    hits.sort(function(a, b) { return rank(b, ws) - rank(a, ws) })
    if (hits.length === 0) return have.key === k ? [{ title: "No file or folder matches \"" + m[1].trim() + "\"", subtitle: "Files", score: 40, copy: "" }] : []
    return hits.slice(0, LIMIT).map(row)
  }
}
