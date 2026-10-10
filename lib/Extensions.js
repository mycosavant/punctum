.pragma library

// Extensions: what they are, which are on, and their settings. Pure, so the
// tests run it in Node.
//
// An extension is a folder with an extension.json:
//
//   {
//     "schema": 1,
//     "id": "bible", "name": "Bible", "version": "1.0.0",
//     "description": "Scripture references on Bible Gateway",
//     "icon": "󰂺",
//     "type": "js",                       // "js": entry is a provider file
//     "entry": "provider.js",             // "script": command is any executable
//     "enabled": true,                    // when the user hasn't said
//     "order": 90,                        // ties between extensions, lower first
//     "helpOrder": 120,                   // place in the ? list
//     "hero": false,                      // its top row is an answer, shown large
//     "mode": { "pattern": "^\\s*bible\\s", "label": "Bible" },
//     "defaults": { "versions": ["NASB"] },
//     "requires": ["rg"],                 // commands it needs on PATH
//     "permissions": { "runs": [], "reads": [], "network": [], "writes": [] }
//   }
//
// A script extension runs inside a bubblewrap sandbox unless its manifest
// says "sandbox": false: no network, an empty home folder, nothing
// writable but a private /tmp. It asks for more in the manifest:
//   "sandbox": { "network": true, "home": "none" | "read" | "read-write",
//                "reads": ["~/.config/thing"], "writes": ["~/.cache/thing"] }
// ?extensions shows what each one got, and the bar enforces it.
//
// A script extension also has "command": ["./run", "--flag"] (a leading ./ is
// the extension's own folder), a mode (it runs only in its mode), and may
// have "refresh": { "command": [...], "every": 60 }, a background job run on
// a query in its mode at most every N seconds, after which the query runs
// again.
//
// The bundled extensions live in the plugin's extensions/ folder; yours go in
// ~/.config/omarchy/commandbar/extensions/<id>/, and one with the id of a
// bundled extension replaces it.

var SCHEMA = 1
var ID = /^[a-z0-9][a-z0-9_-]{0,31}$/
// The bar's own settings and words it uses; an extension with one of these
// ids would overwrite that setting (an id "window" wiped the card's geometry)
// or switch other extensions off from its manifest.
var RESERVED = { window: true, glass: true, hotkey: true, extensions: true, providers: true, help: true, bar: true }
// Ids that were renamed, as an older "providers" list may still name them.
var RENAMED = { locate: "everywhere" }
function legacyId(id) { return RENAMED[id] || id }
var TYPES = { js: true, script: true }
var LIST_KEYS = ["runs", "reads", "network", "writes"]

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }

function strings(v, max) {
  return Array.isArray(v) ? v.filter(function(x) { return typeof x === "string" && x.length > 0 && x.length <= 200 }).slice(0, max || 32) : []
}

function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback }

// A command list from a manifest: strings, the first one a path inside the
// extension folder (./x) or a bare command name. Never a shell string.
function command(v, dir) {
  var c = strings(v, 64)
  if (c.length === 0 || c.length !== (Array.isArray(v) ? v.length : -1)) return null
  var first = c[0]
  if (first.indexOf("./") === 0) {
    var rest = first.slice(2)
    if (!rest || rest.split("/").some(function(part) { return part === ".." || part === "" })) return null
    c[0] = dir + "/" + rest
  } else if (!/^[A-Za-z0-9._+-]+$/.test(first)) {
    return null
  }
  return c
}

// The manifest, cleaned, or { error } saying what's wrong with it.
function validate(raw, dir) {
  var m = raw
  if (typeof raw === "string") {
    try { m = JSON.parse(raw) } catch (e) { return { error: "extension.json isn't valid JSON" } }
  }
  if (!isObject(m)) return { error: "extension.json isn't an object" }
  if (m.schema !== SCHEMA) return { error: "unsupported schema " + JSON.stringify(m.schema) + " (this bar reads " + SCHEMA + ")" }
  if (typeof m.id !== "string" || !ID.test(m.id)) return { error: "id must be lower-case letters, digits, - or _ (up to 32)" }
  if (RESERVED[m.id] || RENAMED[m.id]) return { error: "the id \"" + m.id + "\" is taken by the bar itself" }
  var type = m.type || "js"
  if (!TYPES[type]) return { error: "type must be \"js\" or \"script\"" }
  var out = {
    id: m.id,
    name: typeof m.name === "string" && m.name ? m.name.slice(0, 60) : m.id,
    version: typeof m.version === "string" ? m.version.slice(0, 32) : "",
    description: typeof m.description === "string" ? m.description.slice(0, 300) : "",
    icon: typeof m.icon === "string" ? m.icon.slice(0, 8) : "",
    type: type,
    dir: String(dir || ""),
    enabled: m.enabled !== false,
    hero: m.hero === true,
    order: num(m.order, 500),
    helpOrder: num(m.helpOrder, 500),
    defaults: m.defaults === undefined ? {} : m.defaults,
    requires: strings(m.requires).filter(function(x) { return /^[A-Za-z0-9._+-]+$/.test(x) }),
    permissions: {},
    mode: null,
    entry: "",
    command: null,
    refresh: null,
    help: Array.isArray(m.help) ? m.help : [],
    commands: Array.isArray(m.commands) ? m.commands : [],
    minQuery: Math.max(0, Math.min(64, num(m.minQuery, 1))),
    placeholder: typeof m.placeholder === "string" ? m.placeholder.slice(0, 120) : "",
    sandbox: null
  }
  var perms = isObject(m.permissions) ? m.permissions : {}
  for (var i = 0; i < LIST_KEYS.length; i++) out.permissions[LIST_KEYS[i]] = strings(perms[LIST_KEYS[i]])
  if (m.mode !== undefined) {
    if (!isObject(m.mode) || typeof m.mode.pattern !== "string") return { error: "mode needs a \"pattern\"" }
    try { new RegExp(m.mode.pattern, "i") } catch (e) { return { error: "mode.pattern isn't a valid regular expression" } }
    out.mode = { pattern: m.mode.pattern, label: typeof m.mode.label === "string" ? m.mode.label.slice(0, 30) : out.name, icon: typeof m.mode.icon === "string" ? m.mode.icon.slice(0, 8) : out.icon }
  }
  if (type === "js") {
    var entry = typeof m.entry === "string" ? m.entry : "provider.js"
    if (!/^[A-Za-z0-9_-]+\.js$/.test(entry)) return { error: "entry must be a .js file in the extension's folder" }
    out.entry = entry
  } else {
    out.command = command(m.command, out.dir)
    if (!out.command) return { error: "command must be a list of strings starting with ./file or a command name" }
    if (!out.mode) return { error: "a script extension needs a mode, so it only runs when asked" }
    var sb = sandboxOf(m.sandbox)
    if (sb.error) return { error: sb.error }
    out.sandbox = sb.sandbox
    if (out.sandbox) out.requires = out.requires.concat(["bwrap"])
    if (m.refresh !== undefined) {
      var rc = isObject(m.refresh) ? command(m.refresh.command, out.dir) : null
      if (!rc) return { error: "refresh.command must be a list of strings" }
      out.refresh = { command: rc, every: Math.max(5, num(m.refresh.every, 60)) }
    }
  }
  return out
}

// ---------------------------------------------------------------- the sandbox

var HOME_MODES = { none: true, read: true, "read-write": true }
var SAFE_PATH = /^~\/[A-Za-z0-9._@+\/-]+$/

// { sandbox: {...} | false } or { error }. Absent means the strictest one.
function sandboxOf(v) {
  if (v === false) return { sandbox: false }
  if (v === undefined || v === true) v = {}
  if (!isObject(v)) return { error: "sandbox must be false or an object" }
  var home = v.home === undefined ? "none" : v.home
  if (!HOME_MODES[home]) return { error: "sandbox.home must be \"none\", \"read\" or \"read-write\"" }
  var paths = function(list, what) {
    if (list === undefined) return []
    if (!Array.isArray(list) || list.length > 16) return null
    for (var i = 0; i < list.length; i++)
      if (typeof list[i] !== "string" || !SAFE_PATH.test(list[i]) || list[i].split("/").indexOf("..") !== -1) return null
    return list.slice()
  }
  var reads = paths(v.reads), writes = paths(v.writes)
  if (reads === null || writes === null) return { error: "sandbox.reads and sandbox.writes are lists of paths under ~/ (no ..)" }
  return { sandbox: { network: v.network === true, home: home, reads: reads, writes: writes } }
}

function expand(p, home) { return home.replace(/\/+$/, "") + p.slice(1) }

// The argument list that runs `command` for this extension: inside bwrap
// with exactly what the manifest asked for, or as it is when the manifest
// says "sandbox": false. The extension's folder is mounted read-only and is
// the working directory; the session's runtime folder (Wayland, D-Bus) is
// never mounted, so a sandboxed script can't reach the desktop.
function wrap(m, command, home) {
  if (!m.sandbox || !home || home.charAt(0) !== "/") return command
  var sb = m.sandbox
  var a = ["bwrap", "--unshare-all", "--die-with-parent", "--new-session"]
  if (sb.network) a.push("--share-net")
  a.push("--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/bin", "/sbin",
         "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib", "/lib64",
         "--ro-bind", "/etc", "/etc", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp")
  if (sb.home === "read") a.push("--ro-bind", home, home)
  else if (sb.home === "read-write") a.push("--bind", home, home)
  else a.push("--tmpfs", home)
  for (var i = 0; i < sb.reads.length; i++) a.push("--ro-bind-try", expand(sb.reads[i], home), expand(sb.reads[i], home))
  for (var j = 0; j < sb.writes.length; j++) a.push("--bind-try", expand(sb.writes[j], home), expand(sb.writes[j], home))
  a.push("--ro-bind", m.dir, m.dir, "--chdir", m.dir, "--setenv", "HOME", home, "--unsetenv", "DBUS_SESSION_BUS_ADDRESS",
         "--unsetenv", "WAYLAND_DISPLAY", "--unsetenv", "DISPLAY", "--unsetenv", "XDG_RUNTIME_DIR", "--")
  return a.concat(command)
}

// What ?extensions says about it.
function sandboxSummary(m) {
  if (m.type !== "script") return ""
  if (!m.sandbox) return "not sandboxed"
  var sb = m.sandbox, bits = [sb.network ? "network on" : "no network",
    sb.home === "none" ? "home hidden" : sb.home === "read" ? "home read-only" : "home writable"]
  if (sb.reads.length) bits.push("reads " + sb.reads.join(", "))
  if (sb.writes.length) bits.push("writes " + sb.writes.join(", "))
  return "sandboxed: " + bits.join(", ")
}

// Bundled first, then yours; yours replaces a bundled one with the same id.
// found: [{ dir, manifest (text or object), missing: [commands not on PATH], user }]
function collect(found) {
  var byId = {}, errors = []
  for (var i = 0; i < (found || []).length; i++) {
    var f = found[i]
    var m = validate(f.manifest, f.dir)
    if (m.error) { errors.push({ dir: f.dir, error: m.error }); continue }
    m.user = !!f.user
    m.missing = strings(f.missing)
    if (byId[m.id] && !m.user && byId[m.id].user) continue
    if (byId[m.id] && m.user && byId[m.id].user) { errors.push({ dir: f.dir, error: "another of your extensions, " + byId[m.id].dir + ", has the id \"" + m.id + "\"" }); continue }
    byId[m.id] = m
  }
  var list = []
  for (var id in byId) list.push(byId[id])
  list.sort(function(a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1) })
  return { list: list, errors: errors }
}

// Whether the user has it on: "extensions": { "bible": false } or
// { "bible": { "enabled": false } } wins over the manifest's default. The
// older "providers": [...] list, if present, decides on its own.
function userSays(id, userConfig) {
  var u = userConfig || {}
  if (Array.isArray(u.providers)) return u.providers.map(legacyId).indexOf(id) !== -1
  var e = isObject(u.extensions) ? u.extensions[id] : undefined
  if (typeof e === "boolean") return e
  if (isObject(e) && typeof e.enabled === "boolean") return e.enabled
  return null
}

// Switches flipped in the bar (Enter in ?extensions), kept in the bar's cache
// rather than your config file, laid over your config: { id: true|false }.
function withSwitches(userConfig, switches) {
  var u = deepMerge(userConfig || {}, {})
  var sw = isObject(switches) ? switches : {}
  if (Array.isArray(u.providers)) {
    var list = u.providers.map(legacyId)
    for (var id in sw) {
      var at = list.indexOf(id)
      if (sw[id] === true && at === -1) list.push(id)
      else if (sw[id] === false && at !== -1) list.splice(at, 1)
    }
    u.providers = list
  } else {
    var ex = isObject(u.extensions) ? deepMerge(u.extensions, {}) : {}
    for (var k in sw) if (typeof sw[k] === "boolean") ex[k] = sw[k]
    u.extensions = ex
  }
  return u
}

function isOn(manifest, userConfig) {
  if (manifest.missing && manifest.missing.length) return false
  var said = userSays(manifest.id, userConfig)
  return said === null ? manifest.enabled : said
}

// Objects merge key by key; arrays and scalars from `over` replace `base`;
// null removes a key.
function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  var out = {}
  var k
  for (k in base) out[k] = base[k]
  for (k in over) {
    if (over[k] === null && isObject(base)) { delete out[k]; continue }
    out[k] = deepMerge(base[k], over[k])
  }
  return out
}

// The config providers see: the bar's defaults and your file, with each
// extension's section built from its manifest defaults and your section.
function effectiveConfig(barDefaults, manifests, userConfig) {
  var cfg = deepMerge(barDefaults || {}, userConfig || {})
  for (var i = 0; i < (manifests || []).length; i++) {
    var m = manifests[i]
    var mine = userConfig ? userConfig[m.id] : undefined
    // An older config's section under a renamed id ("locate") still counts.
    for (var old in RENAMED) if (RENAMED[old] === m.id && mine === undefined && userConfig) mine = userConfig[old]
    cfg[m.id] = deepMerge(m.defaults, mine)
  }
  return cfg
}

// ---------------------------------------------------------------- script extensions

// What a script may ask the bar to do on Enter. The bar carries it out; the
// footer names it.
var ACTIONS = { open: true, copy: true, paste: true, edit: true, argv: true }
var MAX_ITEMS = 200
var MAX_TEXT = 1024 * 1024

// The footer label is the bar's own description of the action, never the
// script's: a row a script labels "Open" can't run something else unseen.
function basename(p) { return String(p).split("/").pop() }

function cleanAction(a) {
  if (!isObject(a) || !ACTIONS[a.kind]) return null
  var label = a.kind === "argv" ? "" : a.kind
  if (a.kind === "open") {
    var t = String(a.target || "")
    if (!/^(https?:\/\/|mailto:|file:\/\/\/)/i.test(t) && t.charAt(0) !== "/") return null
    return { kind: "open", target: t.slice(0, 8192), label: label }
  }
  if (a.kind === "copy" || a.kind === "paste") {
    if (typeof a.target !== "string" || a.target.length > MAX_TEXT) return null
    return { kind: a.kind, target: a.target, label: label }
  }
  if (a.kind === "edit") {
    if (typeof a.target !== "string" || a.target.charAt(0) !== "/" || !(a.line >= 1 && a.line <= 10000000)) return null
    return { kind: "edit", target: a.target, line: Math.floor(a.line), label: label }
  }
  var argv = Array.isArray(a.target) ? a.target : null
  if (!argv || argv.length === 0 || argv.length > 64 || !argv.every(function(x) { return typeof x === "string" && x.length <= 8192 }) || !argv[0]) return null
  var input = typeof a.input === "string" && a.input.length <= 65536 ? a.input : undefined
  label = "run " + basename(argv[0])
  return input === undefined ? { kind: "argv", target: argv.slice(), label: label } : { kind: "argv", target: argv.slice(), input: input, label: label }
}

function cleanItem(it, n) {
  if (!isObject(it) || typeof it.title !== "string") return null
  var image = typeof it.image === "string" && (it.image.charAt(0) === "/" || /^[A-Za-z0-9._-]+$/.test(it.image)) ? it.image : ""
  return {
    title: it.title.slice(0, 500),
    subtitle: typeof it.subtitle === "string" ? it.subtitle.slice(0, 500) : "",
    icon: typeof it.icon === "string" ? it.icon.slice(0, 8) : "",
    image: image,
    copy: typeof it.copy === "string" ? it.copy.slice(0, MAX_TEXT) : "",
    run: cleanAction(it.run),
    alt: cleanAction(it.alt),
    complete: typeof it.complete === "string" ? it.complete.slice(0, 500) : "",
    score: 97 - n * 0.001
  }
}

// { items: [rows], message } from a script's output, or { error }.
function parseOutput(text) {
  var t = String(text || "").trim()
  if (!t) return { items: [], message: "" }
  var data
  try { data = JSON.parse(t) } catch (e) { return { error: "its output isn't JSON" } }
  var items = Array.isArray(data) ? data : (isObject(data) && Array.isArray(data.items) ? data.items : null)
  if (!items) return { error: "its output has no \"items\" list" }
  var out = []
  for (var i = 0; i < items.length && out.length < MAX_ITEMS; i++) {
    var row = cleanItem(items[i], out.length)
    if (row) out.push(row)
  }
  return { items: out, message: isObject(data) && typeof data.message === "string" ? data.message.slice(0, 200) : "" }
}

// A provider object for a script extension. It runs the command through the
// bar's shared search (ctx.requestSearch, newest query wins, 3 s limit) with
// a JSON request on stdin:
//   { "protocol": 1, "query": "<the whole query>", "text": "<after the mode prefix>",
//     "settings": {...}, "home": "/home/you" }
// and turns the JSON it prints into rows.
function scriptProvider(m) {
  var re = new RegExp(m.mode.pattern, "i")
  return {
    id: m.id,
    name: m.name,
    icon: m.icon,
    help: m.help,
    commands: m.commands,
    match: function(query, ctx) {
      var q = String(query || "")
      var hit = q.match(re)
      if (!hit) return []
      var text = q.slice(hit[0].length)
      if (text.trim().length < m.minQuery)
        return [{ title: m.placeholder || "Type after \"" + hit[0].trim() + "\"", subtitle: m.name, score: 40, copy: "" }]
      if (m.refresh && ctx.requestJob) ctx.requestJob("refresh", wrap(m, m.refresh.command, ctx.home), { every: m.refresh.every, rerun: true })
      var key = text
      var have = ctx.search
      if (!have || have.key !== key) {
        if (ctx.requestSearch) ctx.requestSearch(key, [wrap(m, m.command, ctx.home)], {
          stdin: JSON.stringify({ protocol: 1, query: q, text: text, settings: ctx.settings === undefined ? {} : ctx.settings, home: ctx.home })
        })
        if (!have) return [{ title: "Searching…", subtitle: m.name, score: 40, copy: "" }]
      }
      if (have.failed && have.key === key) return [{ title: m.name + " couldn't start", subtitle: m.command[0] + " · is it executable?", score: 40, copy: "" }]
      var out = parseOutput(have.text)
      if (out.error) return have.key === key ? [{ title: m.name + ": " + out.error, subtitle: m.dir, score: 40, copy: "" }] : []
      if (!out.items.length && have.key === key)
        return [{ title: have.timedOut ? "Stopped after 3 s" : (out.message || "Nothing found"), subtitle: m.name, score: 40, copy: "" }]
      return out.items
    }
  }
}
