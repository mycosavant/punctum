.pragma library

// Keyword commands defined entirely in config — the no-code extension point.
//
//   { "keyword": "g",    "title": "Search Google", "open": "https://www.google.com/search?q={q}" }
//   { "keyword": "lock", "title": "Lock screen",   "run":  "omarchy-system-lock" }
//
// `open` gets {q} URL-encoded and is handed to xdg-open; `run` gets {q}
// shell-quoted and runs under bash. Nothing runs until Enter.
//
// A `run` template that puts {q} inside quotes ("{q}" or '{q}') is refused:
// the quoting below only holds where {q} stands as a bare word.

function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }

// True when every {q} in a shell template sits outside quotes, so the
// single-quoted text that replaces it is one literal word to bash.
function bareQuery(template) {
  var quote = ""
  for (var i = 0; i < template.length; i++) {
    if (template.substr(i, 3) === "{q}") { if (quote) return false; i += 2; continue }
    var c = template.charAt(i)
    if (quote === "'") { if (c === "'") quote = ""; continue }
    if (c === "\\") { i++; continue }
    if (quote === "\"") { if (c === "\"") quote = ""; continue }
    if (c === "'" || c === "\"") quote = c
  }
  return true
}

function takesQuery(cmd) { return /\{q\}/.test(cmd.open || cmd.run || "") }

// What a row will do, said plainly: the site it opens or the command it runs.
function describe(target) {
  if (target.kind === "open") {
    var host = String(target.target).match(/^[a-z]+:\/\/(?:www\.)?([^\/?#]+)/i)
    return "Opens " + (host ? host[1] : target.target)
  }
  return "Runs " + target.target
}

function build(cmd, q) {
  // Replacements are functions: a replacement string would expand $', $` and
  // $& from the typed text into pieces of the template.
  if (cmd.open) return { kind: "open", target: cmd.open.replace(/\{q\}/g, function() { return encodeURIComponent(q) }) }
  if (cmd.run) {
    if (!bareQuery(cmd.run)) return null
    return { kind: "run", target: cmd.run.replace(/\{q\}/g, function() { return shellQuote(q) }) }
  }
  return null
}

var provider = {
  id: "commands",
  name: "Commands",
  icon: "󰘳",
  // One help topic listing every configured keyword and what it does.
  help: function(ctx) {
    var list = Array.isArray(ctx.settings) ? ctx.settings : []
    var examples = []
    for (var i = 0; i < list.length; i++) {
      var cmd = list[i]
      if (!cmd || !cmd.keyword || !(cmd.open || cmd.run) || !build(cmd, "")) continue
      var kw = String(cmd.keyword)
      var what = describe(build(cmd, "{q}"))
      examples.push({ q: takesQuery(cmd) ? kw + " " : kw, note: (cmd.title || kw) + ". " + what.replace(/%7Bq%7D|'\{q\}'/g, "…") })
    }
    if (examples.length === 0) return []
    return [{ id: "keywords", title: "Keywords", icon: "󰌌", about: "Your shortcuts, set in commandbar.json", examples: examples }]
  },
  // Searchable by keyword and title: "goo" finds Search Google, "lo" finds Lock screen.
  commands: function(ctx) {
    var list = Array.isArray(ctx.settings) ? ctx.settings : []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var cmd = list[i]
      if (!cmd || !cmd.keyword || !(cmd.open || cmd.run) || !build(cmd, "")) continue
      var kw = String(cmd.keyword)
      out.push({
        title: cmd.title || kw,
        keywords: kw + " " + (cmd.keywords || ""),
        text: "Keyword \"" + kw + "\"",
        icon: cmd.icon || (cmd.open ? "󰖟" : "󰘳"),
        complete: takesQuery(cmd) ? kw + " " : "",
        run: takesQuery(cmd) ? null : build(cmd, "")
      })
    }
    return out
  },
  match: function(query, ctx) {
    var list = ctx.settings
    if (!Array.isArray(list)) return []
    var text = query.replace(/^\s+/, "")
    var space = text.search(/\s/)
    var word = (space === -1 ? text : text.slice(0, space)).toLowerCase()
    var rest = space === -1 ? "" : text.slice(space).trim()
    var out = []

    for (var i = 0; i < list.length; i++) {
      var cmd = list[i]
      if (!cmd || !cmd.keyword || !(cmd.open || cmd.run)) continue
      var kw = String(cmd.keyword).toLowerCase()
      var title = cmd.title || kw
      var icon = cmd.icon || (cmd.open ? "󰖟" : "󰘳")

      if (word === kw && !build(cmd, "")) {
        out.push({ title: title + " is switched off", subtitle: "Its \"run\" puts {q} inside quotes; write it bare, as in notify-send {q}", score: 98, icon: icon, copy: "" })
      } else if (word === kw) {
        if (takesQuery(cmd)) {
          if (!rest) {
            out.push({ title: title + "…", subtitle: "Type your search after \"" + kw + " \"", score: 95, icon: icon, copy: "" })
          } else {
            var withQuery = build(cmd, rest)
            out.push({ title: title + ": " + rest, subtitle: describe(withQuery), score: 98, icon: icon, copy: rest, run: withQuery })
          }
        } else if (!rest) {
          var plain = build(cmd, "")
          out.push({ title: title, subtitle: describe(plain), score: 98, icon: icon, copy: "", run: plain })
        }
      }
    }
    return out
  }
}
