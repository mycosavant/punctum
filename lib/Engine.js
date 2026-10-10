.pragma library
.import "Extensions.js" as Ext

// Runs every enabled provider over a query and returns ranked rows:
//   { provider, icon, image, title, subtitle, copy, run, alt, complete, score,
//     group, section, hero, swatch, appId, pinned }
// `alt` is the Shift+Enter action; `swatch` a colour drawn as the icon tile;
// `appId` marks a row Alt+P can pin.
// Rows come back grouped: `section` is set on the first row of each group,
// and `hero` on a top row that is a direct answer (a sum, a conversion).
// `image` is an icon theme name or path (app icons), drawn instead of `icon`.

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }

// Objects merge key by key; arrays and scalars from `over` replace `base`.
function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  var out = {}
  var k
  for (k in base) out[k] = base[k]
  for (k in over) out[k] = deepMerge(base[k], over[k])
  return out
}

// Strips // and /* */ comments outside strings so the user file can be JSONC.
function parseJsonc(text) {
  var src = String(text || "")
  var out = ""
  var inString = false
  for (var i = 0; i < src.length; i++) {
    var c = src[i]
    if (inString) {
      out += c
      if (c === "\\") { out += src[++i] || "" }
      else if (c === "\"") inString = false
    } else if (c === "\"") { inString = true; out += c }
    else if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n" }
    else if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++ }
    else out += c
  }
  out = out.replace(/,(\s*[}\]])/g, "$1")   // trailing commas
  if (!out.trim()) return {}
  return JSON.parse(out)
}

// ---------------------------------------------------------------- formatting

// Copy text: no grouping separators, so it pastes cleanly into anything.
function plain(n) { return String(n) }

function format(n) {
  if (typeof n !== "number" || !isFinite(n)) return String(n)
  var abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toPrecision(6).replace(/\.?0+e/, "e")
  var s = String(n)
  if (/e/.test(s)) s = n.toFixed(12).replace(/\.?0+$/, "")
  var neg = s[0] === "-"
  if (neg) s = s.slice(1)
  var parts = s.split(".")
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return (neg ? "-" : "") + parts.join(".")
}

var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function formatDate(unixSeconds) {
  var d = new Date(unixSeconds * 1000)
  return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear()
}

// ---------------------------------------------------------------- run

// Every loaded extension, in order: { provider, manifest }. Set by the bar
// once it has found and loaded them (and by the tests).
var registry = []

function setProviders(entries) {
  registry = (entries || []).filter(function(e) { return e && e.provider && typeof e.provider.match === "function" && e.manifest })
}

function providers() { return registry.map(function(e) { return e.provider }) }

// The bar closed: providers that keep anything between keystrokes (a parsed
// clipboard history, the package list) drop it here.
function forget() {
  for (var i = 0; i < registry.length; i++) {
    var p = registry[i].provider
    if (typeof p.forget !== "function") continue
    try { p.forget() } catch (e) { console.warn("commandbar: forget for " + p.id + " failed: " + e) }
  }
}

function manifestOf(p) {
  for (var i = 0; i < registry.length; i++) if (registry[i].provider === p) return registry[i].manifest
  return null
}

// A provider's own view of the bar's background work. Keys are prefixed with
// its id, so two extensions can't read each other's results:
//   ctx.search                  the last search that landed, if it was this
//                               provider's: { key, text, chunks, timedOut, done }
//   ctx.requestSearch(key, argvs, { stdin, timeout })
//                               run argument lists in turn, newest key wins
//   ctx.load(key, argv, { ttl }) text read once (per open, or every ttl ms),
//                               or null while it loads
//   ctx.requestJob(key, argv, { every, rerun })
//                               a background job, at most every N seconds;
//                               rerun searches again when it finishes
function work(p, services) {
  var prefix = p.id + "\n"
  var s = services.search
  var mine = s && typeof s.key === "string" && s.key.indexOf(prefix) === 0
    ? { key: s.key.slice(prefix.length), text: s.text, chunks: s.chunks || [s.text], timedOut: !!s.timedOut, done: s.done !== false, failed: !!s.failed } : null
  // There is one search slot. When the query is in a mode, only that mode's
  // extension may use it; two extensions asking for the same query would
  // otherwise take turns stopping each other for as long as the bar is open.
  var mayAsk = services.requestSearch && (!services.searchOwner || services.searchOwner === p.id)
  var argvs = function(a) { return Array.isArray(a) && Array.isArray(a[0]) ? a : [a] }
  return {
    search: mine,
    requestSearch: mayAsk ? function(key, a, opts) { services.requestSearch(prefix + key, argvs(a), opts || {}) } : null,
    load: function(key, argv, opts) {
      if (services.requestLoad) services.requestLoad(prefix + key, argv, opts || {})
      return services.cached ? services.cached(prefix + key) : null
    },
    requestJob: services.requestJob ? function(key, argv, opts) { services.requestJob(prefix + key, argv, opts || {}, prefix) } : null
  }
}

function contextFor(p, config, services) {
  var w = work(p, services)
  return {
    search: w.search,
    requestSearch: w.requestSearch,
    load: w.load,
    requestJob: w.requestJob,
    settings: config[p.id],
    dir: (manifestOf(p) || {}).dir || "",
    rates: services.rates,
    ratesStatus: services.ratesStatus,
    zones: services.zones || {},
    localZone: services.localZone || "",
    emojis: services.emojis || [],
    processes: services.processes || null,
    apps: services.apps || [],
    windows: services.windows || [],
    launches: services.launches || {},
    agent: services.agent || "",
    pinnedApps: services.pinnedApps || [],
    home: services.home || "",
    omarchyPath: services.omarchyPath || "",
    keywords: commandKeywords(config),
    inMode: function(q) { return modeOf(q, config) !== null },
    modeOf: function(q) { var m = modeOf(q, config); return m ? m.id : "" },
    requestProcesses: services.requestProcesses || null,
    requestRates: services.requestRates || null,
    now: services.now || function() { return new Date() },
    format: format,
    plain: plain,
    formatDate: formatDate
  }
}

// Keywords taken by your own keyword commands, so a feature's keyword can step
// aside for one ("ai" when you have an "ai" command).
function commandKeywords(config) {
  var on = enabledProviders(config).some(function(p) { return p.id === "commands" })
  var cmds = on && config && Array.isArray(config.commands) ? config.commands : []
  var out = []
  for (var i = 0; i < cmds.length; i++) if (cmds[i] && cmds[i].keyword) out.push(String(cmds[i].keyword).toLowerCase())
  return out
}

// The extensions that are on, in order. An explicit "providers" list (the
// older config form, and the tests) picks and orders them itself; otherwise
// each manifest's default, your "extensions" switches, and its "order".
function enabledProviders(config) {
  var out = []
  if (config && Array.isArray(config.providers)) {
    for (var i = 0; i < config.providers.length; i++)
      for (var j = 0; j < registry.length; j++)
        if (registry[j].provider.id === Ext.legacyId(config.providers[i]) && !(registry[j].manifest.missing || []).length) { out.push(registry[j].provider); break }
    return out
  }
  for (var k = 0; k < registry.length; k++) if (Ext.isOn(registry[k].manifest, config)) out.push(registry[k].provider)
  return out
}

// "?" is a small help browser, driven entirely by the query:
//   ?          one row per topic (Open an app, Calculator, Units, …)
//   ?units     that topic's examples, each with its live answer
//   ?money     examples from every topic that match the words
// Providers describe themselves with `help`: [{ id, title, about, icon?,
// examples: ["5 km to mi", { q: "kill ", note: "…" }, { q: "brave", hint: "…" }] }]
// (or a function of ctx returning that). Examples with a note show the note;
// the rest show what the bar would answer, so you see a result before trying
// it, or their hint when there's no answer right now (no matching window).

// Topics in the order people reach for them: each extension's "helpOrder",
// then its own order of topics; keywords last.

function helpTopics(config, services) {
  var topics = []
  var providers = enabledProviders(config)
  for (var i = 0; i < providers.length; i++) {
    var p = providers[i]
    var entries = p.help
    if (typeof entries === "function") {
      try { entries = entries(contextFor(p, config, services)) }
      catch (e) { console.warn("commandbar: help for " + p.id + " failed: " + e); entries = [] }
    }
    for (var j = 0; entries && j < entries.length; j++) {
      var h = entries[j]
      var examples = (h.examples || []).map(function(x) { return typeof x === "string" ? { q: x } : x })
      var m = manifestOf(p)
      topics.push({ id: h.id || p.id, title: h.title || p.name, about: h.about || "", icon: h.icon || p.icon || "", examples: examples,
                    rank: h.id === "keywords" ? 100000 : (m ? m.helpOrder : 500) * 100 + j })
    }
  }
  topics = topics.concat(extensionTopics(config))
  return topics.sort(function(a, b) { return a.rank - b.rank })
}

// "?extensions": every extension found, on or off, with what it runs, reads
// and contacts. Read-only: switches live in your commandbar.json.
var extensionErrors = []
function setExtensionErrors(list) { extensionErrors = Array.isArray(list) ? list : [] }

function extensionTopics(config) {
  if (!registry.length && !extensionErrors.length) return []
  var on = {}
  enabledProviders(config).forEach(function(p) { on[p.id] = true })
  var examples = registry.map(function(e) {
    var m = e.manifest, bits = []
    var perms = m.permissions || {}
    if ((perms.runs || []).length) bits.push("runs " + perms.runs.join(", "))
    if ((perms.reads || []).length) bits.push("reads " + perms.reads.join(", "))
    if ((perms.writes || []).length) bits.push("writes " + perms.writes.join(", "))
    if ((perms.network || []).length) bits.push("contacts " + perms.network.join(", "))
    var state = (m.missing || []).length ? "Off: needs " + m.missing.join(", ")
      : on[m.id] ? "On"
      : Array.isArray(config.providers) ? "Off: add \"" + m.id + "\" to your \"providers\" list"
      : "Off: \"extensions\": { \"" + m.id + "\": true } turns it on"
    return { q: m.name, note: state + (m.user ? " · yours" : "") + (m.type === "script" ? " · script" : "") + " · " + m.description + (bits.length ? " · " + bits.join("; ") : "") }
  })
  extensionErrors.forEach(function(err) { examples.push({ q: err.dir, note: "Not loaded: " + err.error }) })
  return [{ id: "extensions", title: "Extensions", about: "What each one does and touches; switch them in commandbar.json", icon: "󰏗", examples: examples, rank: 99999 }]
}

// What an example answers right now: "3.1069 mi", "Firefox", "🔥 fire".
// Run without the request hooks, so browsing help never fetches rates,
// lists processes or starts a search.
function preview(q, config, services) {
  var quiet = {}
  // Every request hook goes: a preview that started a search would recompute
  // when it landed, re-run the previews and ask again, for ever.
  for (var k in services) quiet[k] = /^request/.test(k) ? null : services[k]
  var rows = run(q, config, quiet)
  var top = rows[0]
  if (!top || top.help || !(top.copy || top.run)) return ""
  return (top.provider === "emoji" ? top.icon + " " : "") + top.title
}

function exampleRow(topic, ex, config, services) {
  var answer = ex.note ? "" : preview(ex.q, config, services)
  return {
    provider: "help",
    providerName: "Help",
    icon: topic.icon,
    title: ex.q.trim() || ex.q,
    subtitle: ex.note || (answer ? "→ " + answer : (ex.hint || "")),
    copy: "",
    run: null,
    complete: ex.q,
    // An example with a live answer comes in selected, so typing replaces
    // it; a mode prefix ("w ", ":") leaves the cursor at the end.
    select: !ex.note && /\S$/.test(ex.q),
    actionLabel: "Try it",
    group: topic.title,
    score: 0,
    help: true,
    helpTopic: topic.id
  }
}

function help(text, config, services) {
  var topics = helpTopics(config, services)
  var t = String(text || "").trim().toLowerCase()
  var rows = []
  var i, j

  if (!t) {
    for (i = 0; i < topics.length; i++) {
      rows.push({
        provider: "help", providerName: "Help", icon: topics[i].icon,
        title: topics[i].title, subtitle: topics[i].about,
        copy: "", run: null, complete: "?" + topics[i].id, select: false,
        actionLabel: "Open", group: "Help", score: 0, help: true
      })
    }
    rows = group(rows)
    rows[0].section = ""   // the search-field chip already says Help
    return rows
  }

  for (i = 0; i < topics.length; i++) {
    if (topics[i].id === t) {
      for (j = 0; j < topics[i].examples.length; j++) rows.push(exampleRow(topics[i], topics[i].examples[j], config, services))
      return group(rows)
    }
  }

  // Search: every word has to appear in the topic or the example.
  var qw = words(t)
  for (i = 0; i < topics.length; i++) {
    var topic = topics[i]
    var topicText = words(topic.id + " " + topic.title + " " + topic.about)
    for (j = 0; j < topic.examples.length; j++) {
      var ex = topic.examples[j]
      if (prefixesAll(qw, topicText.concat(words(ex.q + " " + (ex.note || "")))))
        rows.push(exampleRow(topic, ex, config, services))
    }
  }
  if (rows.length === 0)
    return [{ provider: "help", providerName: "Help", icon: "󰋖", title: "No help matches \"" + t + "\"", subtitle: "Esc goes back to all topics",
              copy: "", run: null, complete: "", select: false, group: "Help", section: "", score: 0, help: true }]
  return group(rows)
}

// The topic a "?id" query has open, for the search-field chip.
function helpTopicTitle(text, config, services) {
  var t = String(text || "").trim().toLowerCase()
  var topics = helpTopics(config, services)
  for (var i = 0; i < topics.length; i++) if (topics[i].id === t) return topics[i].title
  return ""
}

// ---------------------------------------------------------------- commands
//
// Every feature is findable from the search box, Raycast-style: providers list
// `commands` (array, or function of ctx), and any query whose words prefix the
// command's title or keywords shows it — "emo" → Search Emoji, "clock" →
// World Clock. They rank below real answers, so "2+2" still leads with 4.

var BUILTIN_COMMANDS = [
  { title: "Show everything", keywords: "help commands list all features show", text: "Every feature and keyword, with examples", complete: "?", icon: "󰋖" },
  { title: "Extensions", keywords: "extensions plugins features enable disable permissions", text: "Every extension, on or off, and what it touches", complete: "?extensions", icon: "󰏗" },
  { title: "Reset command bar position", keywords: "reset position size move resize window center", text: "Back to the size and place in the config", icon: "󰁌", run: { kind: "reset-geometry", label: "reset" } }
]

function words(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(function(w) { return w.length > 0 })
}

// Every query word must start some word of the haystack.
function prefixesAll(queryWords, hay) {
  for (var i = 0; i < queryWords.length; i++) {
    var hit = false
    for (var j = 0; j < hay.length && !hit; j++) hit = hay[j].indexOf(queryWords[i]) === 0
    if (!hit) return false
  }
  return true
}

function commandRows(query, config, services, existing) {
  var q = query.trim().toLowerCase()
  var qw = words(q)
  if (q.length < 2 || qw.length === 0) return []

  var seen = {}
  for (var e = 0; e < existing.length; e++) seen[existing[e].provider + "|" + existing[e].title.replace(/…$/, "").toLowerCase()] = true

  var sources = enabledProviders(config).map(function(p) { return { p: p, list: p.commands } })
  sources.push({ p: { id: "bar", name: "Command Bar", icon: "󰋖" }, list: BUILTIN_COMMANDS })

  var rows = []
  for (var i = 0; i < sources.length; i++) {
    var p = sources[i].p
    var list = sources[i].list
    if (typeof list === "function") {
      try { list = list(contextFor(p, config, services)) }
      catch (err) { console.warn("commandbar: commands for " + p.id + " failed: " + err); list = [] }
    }
    for (var j = 0; list && j < list.length; j++) {
      var c = list[j]
      var titleWords = words(c.title)
      var inTitle = prefixesAll(qw, titleWords)
      if (!inTitle && !prefixesAll(qw, titleWords.concat(words(c.keywords)))) continue
      if (seen[p.id + "|" + c.title.toLowerCase()]) continue          // the provider already answered it
      if (c.complete && c.complete.trim() === q) continue            // already in that mode
      rows.push({
        provider: p.id,
        providerName: p.name,
        icon: c.icon || p.icon || "",
        title: c.title,
        subtitle: c.text || p.name,
        group: "Commands",
        copy: "",
        run: c.run || null,
        complete: c.complete || "",
        select: !!c.select,
        // A title that starts with the query ("lo" → Lock screen) ranks just
        // above an app whose name does (88); other title hits, then keyword
        // hits, sit below apps and real answers (70+).
        score: c.title.toLowerCase().indexOf(q) === 0 ? 88.5 : (inTitle ? 62 : 56),
        order: i,
        seq: j
      })
    }
  }
  return rows
}

// services: { rates, ratesStatus, zones, emojis, processes, apps, windows, launches, agent, requestProcesses(), requestRates(), now() }
function run(query, config, services) {
  var q = String(query || "")
  if (!q.trim()) return emptyRows(config, services)
  if (/^\s*\?/.test(q)) return help(q.replace(/^\s*\?/, ""), config, services)
  var providers = enabledProviders(config)
  var rows = []
  var owner = modeOf(q, config)
  if (owner) { services = Object.assign({}, services); services.searchOwner = owner.id }

  for (var order = 0; order < providers.length; order++) {
    var p = providers[order]
    var ctx = contextFor(p, config, services)

    var results
    try {
      results = p.match(q, ctx) || []
    } catch (e) {
      console.warn("commandbar: provider " + p.id + " failed: " + e)
      continue
    }

    for (var r = 0; r < results.length; r++) {
      var row = results[r]
      rows.push({
        provider: p.id,
        providerName: p.name,
        icon: row.icon || p.icon || "",
        image: row.image || "",
        title: String(row.title || ""),
        subtitle: String(row.subtitle || ""),
        copy: row.copy === undefined ? String(row.title || "") : String(row.copy),
        run: row.run || null,
        complete: row.complete || "",
        select: !!row.select,
        actionLabel: row.actionLabel || "",
        alt: row.alt || null,
        swatch: row.swatch || "",
        appId: row.appId || "",
        pinned: !!row.pinned,
        score: typeof row.score === "number" ? row.score : 50,
        group: row.group || p.name,
        fallback: !!row.fallback,
        order: order,
        seq: rows.length
      })
    }
  }

  rows = rows.concat(commandRows(q, config, services, rows))

  // Fallback rows ("Ask Claude Code: …") stand in only when nothing else
  // answered, the way Raycast's and Alfred's fallbacks do.
  var answered = rows.some(function(r) { return !r.fallback })
  if (answered) rows = rows.filter(function(r) { return !r.fallback })

  rows.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score
    if (a.order !== b.order) return a.order - b.order
    return a.seq - b.seq
  })
  return group(rows)
}

// What an empty bar lists: rows from providers that define `empty(ctx)`
// (pinned apps), in provider order. Most providers show nothing here.
function emptyRows(config, services) {
  var providers = enabledProviders(config)
  var rows = []
  for (var order = 0; order < providers.length; order++) {
    var p = providers[order]
    if (typeof p.empty !== "function") continue
    var results
    try { results = p.empty(contextFor(p, config, services)) || [] }
    catch (e) { console.warn("commandbar: empty rows for " + p.id + " failed: " + e); continue }
    for (var r = 0; r < results.length; r++) {
      var row = results[r]
      rows.push({
        provider: p.id, providerName: p.name, icon: row.icon || p.icon || "", image: row.image || "",
        title: String(row.title || ""), subtitle: String(row.subtitle || ""),
        copy: row.copy === undefined ? "" : String(row.copy), run: row.run || null, alt: row.alt || null,
        complete: "", select: false, actionLabel: row.actionLabel || "", swatch: "",
        appId: row.appId || "", pinned: !!row.pinned,
        score: 0, group: row.group || p.name, fallback: false, order: order, seq: rows.length
      })
    }
  }
  return group(rows)
}

// Providers whose top row is the answer itself, shown large.
// (an extension says so with "hero": true in its manifest)
function isAnswer(id) {
  for (var i = 0; i < registry.length; i++) if (registry[i].manifest.id === id) return !!registry[i].manifest.hero
  return false
}

// Keeps each group together, in the order of its best row, and labels the
// first row of each. A hero answer stands on its own, so the rest of its
// group gets its own label underneath.
function group(rows) {
  var order = []
  var byGroup = {}
  for (var i = 0; i < rows.length; i++) {
    var g = rows[i].group || rows[i].providerName
    if (!byGroup[g]) { byGroup[g] = []; order.push(g) }
    byGroup[g].push(rows[i])
  }
  var out = []
  for (var o = 0; o < order.length; o++) {
    for (var j = 0; j < byGroup[order[o]].length; j++) {
      var row = byGroup[order[o]][j]
      row.section = j === 0 ? order[o] : ""
      row.hero = false
      out.push(row)
    }
  }
  if (out.length > 0 && isAnswer(out[0].provider) && out[0].copy) {
    out[0].hero = true
    out[0].section = ""
    if (out.length > 1 && !out[1].section) out[1].section = out[0].group
  }
  return out
}

// The mode a query puts the bar in, shown as a chip in the search field:
// ":" emoji, "kill " processes, "w " windows, a keyword and a space.
function mode(query, config) {
  var m = modeOf(query, config)
  return m ? { label: m.label, icon: m.icon } : null
}

// The mode a query is in and whose it is: { id, label, icon } or null.
// Help first; then each extension's static mode pattern, in extension order;
// then providers that work out their chip themselves (keyword commands, the
// agent keyword), so a feature's prefix wins over a keyword of the same name.
function modeOf(query, config) {
  var q = String(query || "")
  if (/^\s*\?/.test(q)) {
    var topic = helpTopicTitle(q.replace(/^\s*\?/, ""), config, {})
    return { id: "help", label: topic ? "Help · " + topic : "Help", icon: "󰋖" }
  }
  var enabled = enabledProviders(config)
  for (var i = 0; i < enabled.length; i++) {
    var man = manifestOf(enabled[i])
    if (!man || !man.mode) continue
    var re
    try { re = new RegExp(man.mode.pattern, "i") } catch (e) { continue }
    if (re.test(q)) return { id: enabled[i].id, label: man.mode.label, icon: man.mode.icon || enabled[i].icon }
  }
  for (var j = 0; j < enabled.length; j++) {
    var p = enabled[j]
    if (typeof p.mode !== "function") continue
    var chip = null
    try { chip = p.mode(q, contextFor(p, config, {})) } catch (e) { chip = null }
    if (chip && chip.label) return { id: p.id, label: String(chip.label), icon: chip.icon || p.icon }
  }
  return null
}
