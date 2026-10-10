.pragma library
.import "../../lib/FileKinds.js" as FileKinds

// What's inside your files, with ripgrep, under your home folder.
//
//   rg invoice 2024 · rg TODO
//
// The words are found as typed (a fixed string, not a regex), ignoring case
// unless you type a capital. ripgrep's own defaults decide what it skips:
// hidden files, anything a .gitignore lists, and binary files;
// "contents": { "hidden": true } searches hidden files too (~/.config).
// Files over 4 MB are skipped; at most 3 lines per file and 300 lines in all
// come back, and a search still running after 3 s is stopped.
//
// Enter opens the file in your Omarchy default editor at that line
// (bin/punctum-edit, which speaks each editor's line syntax; Ghostty drops
// the +LINE that omarchy-launch-editor would pass). Shift+Enter opens it with
// its default app. The words reach rg as one argument after --.

var MIN_QUERY = 3
var LIMIT = 40
var MAX_QUERY = 200

var SCRIPT = 'timeout 3 rg --null --line-number --no-heading --color never --smart-case --fixed-strings --max-count 3 '
  + '--max-columns 240 --max-columns-preview --max-filesize 4M --threads 4 ${2:+--hidden} -- "$1" "$HOME" 2>/dev/null | head -n 300'

function prefix(query) { return String(query || "").match(/^\s*(?:rg|grep)\s([\s\S]*)$/i) }

function plan(text, settings) {
  var t = String(text || "").trim()
  if (t.length < MIN_QUERY || t.length > MAX_QUERY || /[\u0000-\u001f]/.test(t)) return null
  var hidden = !!(settings && settings.hidden)
  return { key: (hidden ? "h\n" : "") + t, argv: ["bash", "-c", SCRIPT, "punctum-rg", t].concat(hidden ? ["1"] : []) }
}

// "path\0LINE:text" per line.
function parse(output) {
  var lines = String(output || "").split("\n"), out = []
  for (var i = 0; i < lines.length; i++) {
    var nul = lines[i].indexOf("\u0000")
    if (nul <= 0) continue
    var path = lines[i].slice(0, nul), rest = lines[i].slice(nul + 1)
    var m = rest.match(/^(\d+):([\s\S]*)$/)
    if (!m || path.charAt(0) !== "/") continue
    out.push({ path: path, line: Number(m[1]), text: m[2].replace(/\s+/g, " ").trim() })
  }
  return out
}

function short(path, home) { return home && path.indexOf(home + "/") === 0 ? "~" + path.slice(home.length) : path }

function row(hit, ctx, n) {
  var name = hit.path.slice(hit.path.lastIndexOf("/") + 1)
  return {
    title: hit.text || name,
    subtitle: short(hit.path, ctx.home) + ":" + hit.line,
    icon: FileKinds.ICONS[FileKinds.kindOf({ rel: name, dir: false })],
    score: 97 - n * 0.001,
    copy: "",
    run: { kind: "edit", target: hit.path, line: hit.line, label: "edit at line" },
    alt: { kind: "open", target: hit.path, label: "open" }
  }
}

var provider = {
  id: "contents",
  name: "In files",
  icon: "󱎸",
  commands: [
    { title: "Search inside files", keywords: "contents grep ripgrep text inside search files", text: "rg and words: lines in your files that contain them", complete: "rg " }
  ],
  help: [
    { id: "contents", title: "Search inside files", about: "rg and words finds lines containing them under ~ (hidden and git-ignored files skipped). Enter edits at the line, Shift+Enter opens",
      examples: [{ q: "rg ", note: "Type words after it" }, { q: "rg invoice", hint: "Lines mentioning invoice" }] }
  ],
  match: function(query, ctx) {
    var m = prefix(query)
    if (!m) return []
    var p = plan(m[1], ctx.settings)
    if (!p) return [{ title: "Type at least three letters", subtitle: "Searches inside files under ~", score: 40, copy: "" }]
    var have = ctx.search
    if (!have || have.key !== p.key) {
      if (ctx.requestSearch) ctx.requestSearch(p.key, p.argv)
      if (!have) return [{ title: "Searching…", subtitle: "In files", score: 40, copy: "" }]
    }
    var hits = parse(have.text)
    if (!hits.length && have.key === p.key && have.timedOut) return [{ title: "Stopped after 3 s", subtitle: "In files · try more specific words", score: 40, copy: "" }]
    if (!hits.length) return have.key === p.key ? [{ title: "No line contains \"" + m[1].trim() + "\"", subtitle: "In files · hidden and git-ignored files are skipped", score: 40, copy: "" }] : []
    return hits.slice(0, LIMIT).map(function(h, n) { return row(h, ctx, n) })
  }
}
