.pragma library

// Bangs, as in DuckDuckGo: a ! and a short name sends the rest of the query
// to one site.
//
//   !nasb john 3:16 · john 3:16 !nasb · !aw hyprland · !     (lists your bangs)
//
// Yours are "bangs": { "engines": { "nasb": { "title": "…", "open": "https://…{q}" } } }
// in commandbar.json. They merge over the defaults by name, and "g": null
// drops a default. A bang that isn't listed goes to "fallback" (DuckDuckGo,
// which knows thousands) with the whole query, bang included, the way Zen
// sends it when DuckDuckGo is its search engine. "fallback": "" keeps every
// unlisted bang here. Only http(s) addresses are opened; {q} is URL-encoded.

var BANG = "[a-z0-9][a-z0-9._-]{0,24}"
var LEADING = new RegExp("^\\s*!(" + BANG + ")(?:\\s+([\\s\\S]*))?$", "i")
var TRAILING = new RegExp("^\\s*(\\S[\\s\\S]*?)\\s+!(" + BANG + ")\\s*$", "i")
var DEFAULT_FALLBACK = "https://duckduckgo.com/?q={q}"

function engines(settings) {
  var e = settings && settings.engines && typeof settings.engines === "object" ? settings.engines : {}
  var out = {}
  for (var k in e) {
    var v = e[k]
    if (!v || typeof v !== "object" || !new RegExp("^" + BANG + "$", "i").test(k)) continue
    if (!/^https?:\/\/[^\s]+$/i.test(String(v.open || ""))) continue
    out[k.toLowerCase()] = { bang: k.toLowerCase(), title: String(v.title || "!" + k), open: String(v.open), home: /^https?:\/\//i.test(String(v.home || "")) ? String(v.home) : "" }
  }
  return out
}

function fallback(settings) {
  var f = settings && settings.fallback !== undefined ? settings.fallback : DEFAULT_FALLBACK
  return /^https?:\/\/[^\s]+$/i.test(String(f || "")) && String(f).indexOf("{q}") >= 0 ? String(f) : ""
}

// A replacement function, so "$&" in the query stays literal.
function fill(template, q) { return template.replace(/\{q\}/g, function() { return encodeURIComponent(q) }) }

function host(u) { var m = String(u).match(/^[a-z]+:\/\/(?:www\.)?([^\/?#]+)/i); return m ? m[1] : u }

// { bang, q } from "!nasb john 3:16" or "john 3:16 !nasb", or null.
function split(query) {
  var m = String(query || "").match(LEADING)
  if (m) return { bang: m[1].toLowerCase(), q: (m[2] || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim(), leading: true }
  m = String(query || "").match(TRAILING)
  if (m) return { bang: m[2].toLowerCase(), q: m[1].replace(/[\u0000-\u001f\u007f]/g, " ").trim(), leading: false }
  return null
}

function sorted(list) { return Object.keys(list).sort().map(function(k) { return list[k] }) }

var provider = {
  id: "bangs",
  name: "Bangs",
  icon: "󰈸",
  commands: [
    { title: "Bangs", keywords: "bang bangs search engine duckduckgo !", text: "! and a short name: !nasb john 3:16", complete: "!" }
  ],
  help: function(ctx) {
    var list = sorted(engines(ctx.settings))
    var examples = list.slice(0, 20).map(function(e) { return { q: "!" + e.bang + " ", note: e.title + ". Opens " + host(e.open) } })
    return [{ id: "bangs", title: "Bangs", icon: "󰈸", about: "! and a name sends the rest to that site. Unlisted bangs go to " + (fallback(ctx.settings) ? host(fallback(ctx.settings)) : "nowhere") + ". Set yours under \"bangs\" in commandbar.json", examples: examples }]
  },
  match: function(query, ctx) {
    var list = engines(ctx.settings)
    // "!" or "!na": the bangs that start that way.
    var partial = String(query || "").match(/^\s*!([a-z0-9._-]*)$/i)
    if (partial) {
      var p = partial[1].toLowerCase()
      var hits = sorted(list).filter(function(e) { return e.bang.indexOf(p) === 0 })
      var out = hits.slice(0, 30).map(function(e, i) {
        return { title: "!" + e.bang + "  " + e.title, subtitle: "Opens " + host(e.open), score: (e.bang === p ? 97 : 90) - i * 0.001, copy: "",
                 complete: "!" + e.bang + " ", run: e.bang === p && e.home ? { kind: "open", target: e.home, label: "open" } : null }
      })
      if (!out.length && p) {
        var f = fallback(ctx.settings)
        out.push({ title: "!" + p + " isn't one of your bangs", subtitle: f ? "Add a search after it and " + host(f) + " will take it" : "Add it under \"bangs\" in commandbar.json", score: 90, copy: "" })
      }
      return out
    }
    var s = split(query)
    if (!s) return []
    var e = list[s.bang]
    if (e) {
      if (!s.q) return [{ title: e.title + "…", subtitle: e.home ? "Enter opens " + host(e.home) + ", or type a search" : "Type your search after !" + e.bang, score: 97, copy: "",
                          run: e.home ? { kind: "open", target: e.home, label: "open" } : null }]
      var target = fill(e.open, s.q)
      return [{ title: e.title + ": " + s.q, subtitle: "Opens " + host(e.open), score: 98, copy: "", run: { kind: "open", target: target, label: "open" },
                alt: { kind: "copy", target: target, label: "copy link" } }]
    }
    var fb = fallback(ctx.settings)
    if (!fb || !s.q) return []
    var whole = "!" + s.bang + " " + s.q
    return [{ title: "!" + s.bang + " " + s.q, subtitle: "Not one of your bangs · " + host(fb) + " resolves it", score: 96, copy: "",
              run: { kind: "open", target: fill(fb, whole), label: "open" } }]
  }
}
