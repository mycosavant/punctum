.pragma library

// Clipboard history, from the file Omarchy's clipboard plugin keeps
// (~/.local/state/omarchy/clipboard-history.json). It is read with ctx.load
// the first time "cb " is typed after the bar opens, once (not watched, so a
// copy landing while you browse can't move the rows under the selection),
// and dropped when the bar closes. Nothing here
// writes the file: pins, expiry and deletion stay with the clipboard plugin.
//
//   cb            every entry, pinned ones first
//   cb invoice    entries containing "invoice"
//
// Enter pastes into the window you came from, the way Super+Ctrl+V does
// (copy, then Shift+Insert); Shift+Enter only copies. Text goes to wl-copy on
// stdin, never on a command line. It is the entry as listed, not one looked
// up again by position, so a copy landing while the bar is open can't shift
// a different entry under Enter. Images go through Omarchy's paste script,
// which takes only the file's path.
//
// This is the JS fallback for native/punctumd/src/clipboard.rs, used when
// punctumd isn't installed; tests/clipboard-parity.js keeps the two the
// same, so change both together.

var LIMIT = 50
var PREVIEW = 160
var SEARCH = 8192   // a huge paste is searched by its start only

var HISTORY = "/.local/state/omarchy/clipboard-history.json"
var MAX_FILE = 16 * 1024 * 1024

// Parsed once per text, not on every keystroke.
var memo = { text: null, list: [] }
function historyFrom(text) {
  if (text === null || text === undefined) return []
  if (memo.text !== text) {
    var list = []
    try { var data = JSON.parse(text); if (Array.isArray(data)) list = data } catch (e) {}
    memo = { text: text, list: list }
  }
  return memo.list
}

function prefix(query) { return String(query || "").match(/^\s*(?:cb|clip)\s(.*)$/i) }

function ago(ms, now) {
  if (!ms) return ""
  var s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return Math.floor(s / 60) + " min ago"
  if (s < 86400) return Math.floor(s / 3600) + " h ago"
  return Math.floor(s / 86400) + " d ago"
}

function preview(text) {
  var t = String(text || "").slice(0, PREVIEW * 2).replace(/\s+/g, " ").trim()
  return t.length > PREVIEW ? t.slice(0, PREVIEW) + "…" : t
}

function row(entry, ctx, n) {
  var now = ctx.now().getTime()
  var bin = String(ctx.omarchyPath || "/usr/share/omarchy") + "/bin/"
  var when = ago(entry.addedAt, now)
  var image = entry.type === "image"
  var lines = image ? 0 : String(entry.text).split("\n").length
  var about = [entry.pinned ? "Pinned" : "", when, image ? (entry.mime || "image") : (lines > 1 ? lines + " lines" : "")]
    .filter(function(x) { return x }).join(" · ")
  return {
    title: image ? "Image" + (entry.capturedAt ? " from " + entry.capturedAt : "") : preview(entry.text),
    subtitle: about,
    icon: entry.pinned ? "󰐃" : (image ? "󰋩" : "󰅍"),
    image: image ? entry.path : "",
    score: 97 - n * 0.001,
    copy: "",
    group: entry.pinned ? "Pinned" : "Clipboard",
    run: image
      ? { kind: "argv", target: [bin + "omarchy-clipboard-paste-file", entry.mime || "image/png", entry.path], label: "paste" }
      : { kind: "paste", target: entry.text, label: "paste" },
    alt: image
      ? { kind: "argv", target: [bin + "omarchy-clipboard-paste-file", "--copy-only", entry.mime || "image/png", entry.path], label: "copy" }
      : { kind: "copy", target: entry.text, label: "copy" }
  }
}

var provider = {
  id: "clipboard",
  name: "Clipboard",
  icon: "󰅍",
  commands: [
    { title: "Clipboard history", keywords: "clipboard paste history copied cb clip", text: "Search what you copied, pinned first", complete: "cb " }
  ],
  help: [
    { id: "clipboard", title: "Clipboard history", about: "cb and a space lists what you copied, pinned first. Enter pastes, Shift+Enter copies",
      examples: [{ q: "cb ", note: "Everything, pinned first" }, { q: "cb http", hint: "Entries containing http" }] }
  ],
  forget: function() { memo = { text: null, list: [] } },
  match: function(query, ctx) {
    var m = prefix(query)
    if (!m) return []
    var needle = m[1].trim().toLowerCase()
    var history = historyFrom(ctx.load("history", ["head", "-c", String(MAX_FILE), "--", ctx.home + HISTORY]))
    var pinned = [], rest = []
    for (var i = 0; i < history.length; i++) {
      var e = history[i]
      if (!e || (e.type !== "text" && e.type !== "image")) continue
      if (e.type === "text" && typeof e.text !== "string") continue
      if (e.type === "image" && !/^\//.test(String(e.path || ""))) continue
      if (needle) {
        var hay = e.type === "image" ? "image screenshot " + (e.capturedAt || "") : e.text.slice(0, SEARCH)
        if (hay.toLowerCase().indexOf(needle) < 0) continue
      }
      ;(e.pinned ? pinned : rest).push({ e: e })
    }
    var all = pinned.concat(rest).slice(0, LIMIT)
    if (all.length === 0)
      return [{ title: needle ? "Nothing copied matches \"" + needle + "\"" : "The clipboard history is empty", subtitle: "Clipboard", score: 40, copy: "" }]
    return all.map(function(x, n) { return row(x.e, ctx, n) })
  }
}
