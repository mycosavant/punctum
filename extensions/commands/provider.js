.pragma library

// Keyword commands defined entirely in config — the no-code extension point.
//
//   { "keyword": "g",    "title": "Search Google", "open": "https://www.google.com/search?q={q}" }
//   { "keyword": "lock", "title": "Lock screen",   "run":  "omarchy-system-lock" }
//
// `open` gets {q} URL-encoded and is handed to xdg-open. `run` runs under
// bash with the typed text as $1, never spliced into the script: {q} becomes
// "$1" (or $1 inside double quotes), so bash expands it once as a value and
// never parses it as code. Nothing runs until Enter.
//
// Two kinds of template are refused, with a message, because bash would
// evaluate the value itself there: {q} inside single quotes (it wouldn't
// expand at all), and any template using arithmetic, array subscripts or a
// builtin that takes a variable's name ($(( )), (( )), [[ ]], let, declare,
// ${…[…]}, ${!…}, test -v, printf -v, read, mapfile, unset, getopts,
// wait -p), where a value such as a[$(cmd)] runs cmd. Measured with bash
// 5.3 on 2026-10-10: test -v, [ -v ], ${!x}, printf -v, read and declare -n
// ran it; the rest are refused because they take a name too.
//
// Templates that hand the value to another shell on purpose (eval, sh -c,
// ssh host {q}) run it as code by design: that is what they're for.

var EVALUATES = new RegExp([
  "\\(\\(", "\\[\\[", "\\$\\[", "\\$\\{[^}]*\\[", "\\$\\{!",
  "\\b(let|declare|typeset|local|read|mapfile|readarray|unset|getopts)\\b",
  "\\bprintf\\s+-v\\b", "\\bwait\\s+-p\\b",
  "(^|[\\s;&|(!])(test|\\[)\\s+(!\\s+)?-[vR]\\b"
].join("|"))

// The script with each {q} turned into a reference to $1, or null when the
// template is refused. Tracks bash quoting and skips comments.
function script(template) {
  if (EVALUATES.test(template)) return null
  var out = "", quote = "", word = true
  for (var i = 0; i < template.length; i++) {
    if (template.substr(i, 3) === "{q}") {
      if (quote === "'") return null
      out += quote === "\"" ? "${1}" : "\"$1\""
      i += 2; word = false
      continue
    }
    var c = template.charAt(i)
    out += c
    if (quote === "'") { if (c === "'") quote = ""; continue }
    if (c === "\\") { out += template.charAt(++i); word = false; continue }
    if (quote === "\"") { if (c === "\"") quote = ""; continue }
    if (c === "#" && word) {
      // A comment runs to the end of the line; a {q} in it does nothing.
      var nl = template.indexOf("\n", i)
      var rest = nl < 0 ? template.slice(i + 1) : template.slice(i + 1, nl)
      out += rest.replace(/\{q\}/g, "")
      i += rest.length
      continue
    }
    if (c === "'" || c === "\"") quote = c
    word = /[\s;&|()<>]/.test(c)
  }
  return quote ? null : out
}

function takesQuery(cmd) { return /\{q\}/.test(cmd.open || cmd.run || "") }

// What a row will do, said plainly: the site it opens or the command it runs.
function describe(target) {
  if (target.kind === "open") {
    var host = String(target.target).match(/^[a-z]+:\/\/(?:www\.)?([^\/?#]+)/i)
    return "Opens " + (host ? host[1] : target.target)
  }
  return "Runs " + target.template
}

function build(cmd, q) {
  // A replacement function, not a string: a string would expand $', $` and
  // $& from the typed text.
  if (cmd.open) return { kind: "open", target: cmd.open.replace(/\{q\}/g, function() { return encodeURIComponent(q) }) }
  if (cmd.run) {
    var body = script(String(cmd.run))
    if (body === null) return null
    return { kind: "shell", target: body, arg: String(q), template: String(cmd.run) }
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
      examples.push({ q: takesQuery(cmd) ? kw + " " : kw, note: (cmd.title || kw) + ". " + what.replace(/%7Bq%7D|\{q\}/g, "…") })
    }
    if (examples.length === 0) return []
    return [{ id: "keywords", title: "Keywords", icon: "󰌌", about: "Your shortcuts, set in punctum.json", examples: examples }]
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
  // The chip for a keyword you typed with a space after it: "g foo" → Search Google.
  mode: function(query, ctx) {
    var m = String(query || "").match(/^\s*(\S+)\s/)
    var list = Array.isArray(ctx.settings) ? ctx.settings : []
    for (var i = 0; m && i < list.length; i++) {
      var cmd = list[i]
      if (cmd && String(cmd.keyword || "").toLowerCase() === m[1].toLowerCase())
        return { label: cmd.title || cmd.keyword, icon: cmd.icon || (cmd.open ? "󰖟" : "󰘳") }
    }
    return null
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
        out.push({ title: title + " is switched off", subtitle: "Its \"run\" puts {q} in single quotes or uses arithmetic; see providers/commands.js", score: 98, icon: icon, copy: "" })
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
