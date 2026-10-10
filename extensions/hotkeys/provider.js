.pragma library
.import "../../lib/Match.js" as Match

// Omarchy's keybindings, findable by what they do, with the keys next to
// them so next time you press the keys instead. Adapted from Keystroke's
// core/Hotkeys.js (evindor/keystroke, MIT; its notice is in LICENSE).
//
//   full screen      → Full screen · Super + F
//   keys             every binding, in Super+K's order
//   keys screenshot  bindings about screenshots
//
// The list and the dispatch both come from `omarchy-menu-keybindings`, the
// script behind Super+K: Punctum.qml sources it and prints its cached
// records (ctx.load reads that text), one per line:
//
//   "SUPER + F            → Full screen\tlua\thl.dsp.window.fullscreen(…)"
//
// Enter runs the bind through the same script's dispatch_binding, so it does
// exactly what pressing the keys does. The dispatcher and its argument are
// separate argv entries; no shell parses them.

var ARROW = " → "
var ROOT_LIMIT = 3
var LIMIT = 60

var cache = { text: null, binds: [] }

function parse(text) {
  if (cache.text === text) return cache.binds
  var lines = String(text || "").split("\n")
  var binds = [], byAction = {}
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    var at = fields[0].indexOf(ARROW)
    if (at < 0) continue
    var combo = fields[0].slice(0, at).trim().replace(/\s+/g, " ")
    var label = fields[0].slice(at + ARROW.length).trim()
    if (!combo || !label) continue
    var dispatcher = (fields[1] || "").trim()
    var arg = fields.slice(2).join("\t").trim()
    // The same action on two keys is one row listing both.
    var k = label + "\u001f" + dispatcher + "\u001f" + arg
    if (byAction[k]) { if (byAction[k].combos.indexOf(combo) < 0) byAction[k].combos.push(combo); continue }
    var bind = { label: label, combos: [combo], dispatcher: dispatcher, arg: arg, order: binds.length }
    byAction[k] = bind
    binds.push(bind)
  }
  cache = { text: text, binds: binds }
  return binds
}

var MODS = { SUPER: "Super", SHIFT: "Shift", CTRL: "Ctrl", ALT: "Alt" }
var KEYS = {
  RETURN: "↵", ENTER: "↵", SPACE: "Space", ESCAPE: "Esc", TAB: "Tab", BACKSPACE: "⌫", DELETE: "Del",
  PRINT: "Print", HOME: "Home", END: "End", LEFT: "←", RIGHT: "→", UP: "↑", DOWN: "↓",
  COMMA: ",", PERIOD: ".", MINUS: "-", EQUAL: "=", SLASH: "/", BACKSLASH: "\\", GRAVE: "`"
}

function keyName(raw) {
  var key = String(raw || "").trim(), upper = key.toUpperCase()
  if (KEYS[upper]) return KEYS[upper]
  if (key.indexOf("XF86") === 0) return key.slice(4).replace(/([a-z])([A-Z])/g, "$1 $2")
  if (/^[A-Z]$|^F[0-9]{1,2}$/.test(upper)) return upper
  if (upper === key && key.length > 1) return key.charAt(0) + key.slice(1).toLowerCase()
  return key
}

// "SUPER SHIFT + RETURN" → "Super + Shift + ↵"
function keys(combo) {
  var plus = combo.lastIndexOf(" + ")
  var mods = plus < 0 ? [] : combo.slice(0, plus).split(/\s+/)
  var parts = mods.filter(function(m) { return m }).map(function(m) { return MODS[m.toUpperCase()] || keyName(m) })
  parts.push(keyName(plus < 0 ? combo : combo.slice(plus + 3)))
  return parts.join(" + ")
}

function comboWords(bind) {
  return bind.combos.map(function(c) { return c.toLowerCase().replace(/\s*\+\s*/g, " ") }).join(" ")
}

// How well the query names this bind: by its label, its keys ("super f"),
// or the command it runs ("screenshot" → omarchy-capture-screenshot).
function rank(bind, q, qw) {
  var label = bind.label.toLowerCase()
  if (label === q) return 3
  if (label.indexOf(q) === 0 || Match.prefixesAll(qw, Match.words(bind.label))) return 2
  for (var c = 0; c < bind.combos.length; c++)
    if (bind.combos[c].toLowerCase().replace(/\s*\+\s*/g, " ").replace(/\s+/g, " ") === qw.join(" ")) return 2.5
  if (Match.prefixesAll(qw, Match.words(bind.label + " " + comboWords(bind) + " " + (bind.dispatcher === "exec" ? bind.arg : "")))) return 1
  return 0
}

function row(bind, score, ctx) {
  var shown = bind.combos.map(keys).join("  ·  ")
  var runnable = !!bind.dispatcher
  return {
    title: bind.label,
    subtitle: shown + (runnable ? "" : " · only from the keyboard"),
    icon: "󰌌",
    score: score,
    copy: "",
    group: "Hotkeys",
    run: runnable ? { kind: "argv", label: "run", target: ["bash", "-c",
      "source \"$0\" --print >/dev/null && dispatch_binding \"$1\" \"$2\"",
      String(ctx.omarchyPath || "/usr/share/omarchy") + "/bin/omarchy-menu-keybindings", bind.dispatcher, bind.arg] } : null
  }
}

var provider = {
  id: "hotkeys",
  name: "Hotkeys",
  icon: "󰌌",
  commands: [
    { title: "Keybindings", keywords: "hotkeys keys shortcuts bindings hyprland", text: "Every keybinding, searchable", complete: "keys " }
  ],
  help: [
    { id: "hotkeys", title: "Keybindings", about: "Type what you want to do to see its keys. keys and a space lists every binding",
      examples: [{ q: "full screen", hint: "Shows Super + F" }, { q: "keys ", note: "Every binding, in Super+K's order" }, { q: "keys screenshot", hint: "Bindings about screenshots" }] }
  ],
  match: function(query, ctx) {
    // omarchy-menu-keybindings keeps its own cache keyed on `hyprctl binds`,
    // so this is cheap; it is asked at most every 30 s and kept between opens.
    // It relies on the script's top level only defining functions under
    // --print: if an Omarchy update changes that, these rows go empty.
    var binds = parse(ctx.load("binds", ["bash", "-c", "source \"$0\" --print >/dev/null && output_binding_records",
                                         (ctx.omarchyPath || "/usr/share/omarchy") + "/bin/omarchy-menu-keybindings"], { ttl: 30000 }) || "")
    var mode = query.match(/^\s*keys\s(.*)$/i)
    var q = (mode ? mode[1] : query).trim().toLowerCase().replace(/\s+/g, " ").replace(/(^|\s)\+(?=\s|$)/g, " ").trim()
    var qw = Match.words(q)
    if (mode) {
      if (!binds.length) return [{ title: "Reading keybindings…", subtitle: "Hotkeys", score: 40, copy: "" }]
      var out = []
      for (var i = 0; i < binds.length && out.length < LIMIT; i++)
        if (!q || rank(binds[i], q, qw) > 0) out.push(row(binds[i], 97 - out.length * 0.001, ctx))
      return out.length ? out : [{ title: "No keybinding matches \"" + q + "\"", subtitle: "Hotkeys", score: 40, copy: "" }]
    }
    // Mixed into ordinary results: a few runnable ones, under apps.
    if (q.length < 3 || qw.length === 0) return []
    var hits = []
    for (var j = 0; j < binds.length; j++) {
      if (!binds[j].dispatcher) continue
      var r = rank(binds[j], q, qw)
      if (r >= 2) hits.push({ b: binds[j], r: r })
    }
    hits.sort(function(a, b) { return b.r - a.r || a.b.order - b.b.order })
    return hits.slice(0, ROOT_LIMIT).map(function(h, n) { return row(h.b, 66 + h.r - n * 0.01, ctx) })
  }
}
