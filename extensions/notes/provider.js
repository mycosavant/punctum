.pragma library

// Quick capture into a note, such as your Obsidian inbox.
//
//   n call the dentist      → "- 2026-10-08 18:05 call the dentist" at the end of the inbox
//
// The inbox is "notes": { "inbox": "~/Vault/Inbox.md" } in commandbar.json,
// and "format" shapes the line ({text}, {date}, {time}). bin/commandbar-note
// appends it: the text goes on stdin, a symlink is refused, and the folder has
// to exist already, so a typo in the path can't create a stray vault.

var DEFAULT_FORMAT = "- {date} {time} {text}"

function pad(n) { return (n < 10 ? "0" : "") + n }

function inboxPath(settings, home) {
  var p = String((settings && settings.inbox) || "").trim()
  if (!p) return ""
  if (p === "~" || p.indexOf("~/") === 0) p = home + p.slice(1)
  return p.charAt(0) === "/" ? p : ""
}

function line(text, settings, now) {
  var d = now
  var date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
  var time = pad(d.getHours()) + ":" + pad(d.getMinutes())
  var format = String((settings && settings.format) || DEFAULT_FORMAT)
  if (format.indexOf("{text}") < 0) format = DEFAULT_FORMAT
  // Replacement functions, so "$&" in what you type stays "$&".
  return format.replace(/\{date\}/g, function() { return date })
    .replace(/\{time\}/g, function() { return time })
    .replace(/\{text\}/g, function() { return text })
}

function shortPath(path, home) {
  return home && path.indexOf(home + "/") === 0 ? "~" + path.slice(home.length) : path
}

var provider = {
  id: "notes",
  name: "Note",
  icon: "󰎞",
  commands: [
    { title: "Add a note to the inbox", keywords: "note notes inbox obsidian capture jot todo", text: "n and your note", complete: "n " }
  ],
  help: [
    { id: "notes", title: "Inbox note", about: "n and a line adds it to the end of your inbox note (notes.inbox in commandbar.json)",
      examples: [{ q: "n call the dentist", note: "Appends \"- <date> <time> call the dentist\"" }] }
  ],
  match: function(query, ctx) {
    var m = String(query || "").match(/^\s*(?:n|note)\s(.*)$/i)
    if (!m) return []
    var text = m[1].replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    var path = inboxPath(ctx.settings, ctx.home)
    if (!path) return [{ title: "Set your inbox note first", subtitle: "\"notes\": { \"inbox\": \"~/Vault/Inbox.md\" } in ~/.config/omarchy/extensions/commandbar.json", score: 98, copy: "" }]
    if (!text) return [{ title: "Type your note", subtitle: "Added to the end of " + shortPath(path, ctx.home), score: 98, copy: "" }]
    return [{ title: "Add: " + text, subtitle: "→ " + shortPath(path, ctx.home), score: 98, copy: "",
              run: { kind: "note", target: line(text, ctx.settings, ctx.now()), path: path, label: "add note" } }]
  }
}
