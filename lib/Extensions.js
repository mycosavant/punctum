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
//                                         // "native": served by punctumd (bundled
//                                         // only); entry, if any, is its JS
//                                         // fallback for when punctumd isn't there
//                                         // "wasm": a WebAssembly component run in
//                                         // punctumd's sandbox; "module" is the .wasm,
//                                         // "source" its source beside it (docs/wasm.md)
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
// A native extension names every program the bar may run for it, since
// punctumd itself runs none (docs/native.md):
//   "loads":   { "list": { "command": ["expac", "…"], "ttl": 30000 } }
//              output punctumd asks for by key; the bar runs it and sends it
//   "actions": { "install": { "command": ["…", "{1}"], "label": "install", "input": false } }
//              what its rows may run on Enter, by name, with punctumd's
//              strings in place of {1}…{9}
//   "searches": { "walk": { "command": ["fd", "--and={2*}", "--", "{1}"] } }
//              commands an answer asks the bar to run for this query, through
//              its search runner (newest query wins, 3 s each); their output
//              goes back to punctumd as it lands
// In all three, {omarchy}, {home} and {dir} are Omarchy's folder, your home
// and the extension's folder. A load is kept between opens when it has a ttl,
// unless it says "keep": false. {2*} is every string from the second on,
// each its own argument with the text around it repeated (--and=a --and=b).
//
// A script extension runs inside a bubblewrap sandbox unless its manifest
// says "sandbox": false: no network, an empty home folder, nothing
// writable but a private /tmp. It asks for more in the manifest:
//   "sandbox": { "network": true, "home": "none" | "read" | "read-write",
//                "reads": ["~/.config/thing"], "writes": ["~/.cache/thing"] }
// ?extensions shows what each one got. bin/punctum-sandbox builds the
// bwrap command when it runs, resolving every path itself without following
// symlinks. Commands a sandboxed script's rows run on Enter run in the same
// sandbox.
//
// A script extension also has "command": ["./run", "--flag"] (a leading ./ is
// the extension's own folder), a mode (it runs only in its mode), and may
// have "refresh": { "command": [...], "every": 60 }, a background job run on
// a query in its mode at most every N seconds, after which the query runs
// again.
//
// The bundled extensions live in the plugin's extensions/ folder; yours go in
// ~/.config/omarchy/punctum/extensions/<id>/, and one with the id of a
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
var TYPES = { js: true, script: true, native: true, wasm: true }
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

// A native extension's command template, or null. {omarchy}, {home} and
// {dir} may be anywhere; {1}…{9} (punctumd's strings, for an action) only
// where they're data: never in the script after a -c, where a string would
// become code. Nothing else in braces is a placeholder.
var KEY = /^[a-z][a-z0-9_-]{0,31}$/
var PLACE = /\{(omarchy|home|dir|[1-9])\}/g
//
// Where a command runs code: a flag that takes a script (bash -c, sh -lc,
// python3 -c) through the script itself, and one that takes a program or a
// command line (-e as xdg-terminal-exec and perl read it, env -S, exec,
// --eval) through what it takes. After a script come its positional
// arguments ($1, $2), and after "--" only operands: there a string is data
// whatever it starts with. Anywhere else a string that starts with "-" could
// be read as an option (fd --exec=…), so fill refuses one.
var SCRIPT_FLAG = /^-[A-Za-z]*c[A-Za-z]*$|^--command(=.*)?$/
var PROGRAM_FLAG = /^-[A-Za-z]*[eS][A-Za-z]*$|^--(eval|exec|execute|split-string)(=.*)?$|^(exec|eval)$/
var ARG = /\{[1-9]\*?\}/

function regions(c) {
  var code = {}, data = c.length
  for (var i = 0; i < c.length; i++) {
    var script = SCRIPT_FLAG.test(c[i])
    if (!script && !PROGRAM_FLAG.test(c[i])) continue
    var j = i + 1
    while (j < c.length && c[j] !== "--" && c[j].charAt(0) === "-") j++   // bash -c -e 'script'
    if (j < c.length && c[j] === "--") j++
    for (var k = i; k <= j && k < c.length; k++) code[k] = true
    if (script) data = j + 1
  }
  var dashes = c.indexOf("--")
  if (dashes >= 0 && !code[dashes] && dashes + 1 < data) data = dashes + 1
  return { code: code, data: data }
}

function template(v, args) {
  var c = strings(v, 64)
  if (c.length === 0 || c.length !== (Array.isArray(v) ? v.length : -1) || !c[0]) return null
  var r = regions(c)
  for (var i = 0; i < c.length; i++) {
    if (!ARG.test(c[i])) continue
    if (!args || r.code[i]) return null
    // Glued to a flag: only as --name=value, after the "=".
    if (c[i].charAt(0) === "-" && !/^--[A-Za-z0-9][A-Za-z0-9-]*=[^{]*\{[1-9]\*?\}/.test(c[i])) return null
  }
  return c
}

// A template with its placeholders filled, or null if one can't be: no
// home, or an argument punctumd didn't give.
function fill(cmd, m, ctx, args) {
  var out = [], data = regions(cmd).data
  // A whole-argument string from punctumd that starts with "-" only where
  // it can't be an option.
  var optionLike = function(i, a) { return i < data && cmd[i].charAt(0) === "{" && typeof a === "string" && a.charAt(0) === "-" }
  // One element with its placeholders filled from these strings, or null.
  var part = function(text, strs) {
    var bad = false
    var done = text.replace(PLACE, function(all, name) {
      if (name === "omarchy") return String(ctx.omarchyPath || "/usr/share/omarchy")
      if (name === "home") { if (!ctx.home) bad = true; return String(ctx.home || "") }
      if (name === "dir") return m.dir
      var a = strs ? strs[Number(name) - 1] : undefined
      if (typeof a !== "string" || a.length > 8192 || a.indexOf("\u0000") >= 0) bad = true
      return bad ? "" : a
    })
    return bad ? null : done
  }
  for (var i = 0; i < cmd.length; i++) {
    // {n*}: one argument per string from the nth on, none if there are none.
    var many = /\{([1-9])\*\}/.exec(cmd[i])
    if (many) {
      var rest = (args || []).slice(Number(many[1]) - 1)
      if (rest.length > 64) return null
      for (var r = 0; r < rest.length; r++) {
        var one = optionLike(i, rest[r]) ? null : part(cmd[i].replace(many[0], "{1}"), [rest[r]])
        if (one === null) return null
        out.push(one)
      }
      continue
    }
    var placeholder = /^\{([1-9])\}$/.exec(cmd[i])
    if (placeholder && optionLike(i, (args || [])[Number(placeholder[1]) - 1])) return null
    var filled = part(cmd[i], args)
    if (filled === null) return null
    out.push(filled)
  }
  return out
}

// What a script's or a WebAssembly extension's own commands and help
// examples may do on Enter: copy text, or open a web or mail address. Never
// run a program, type text, or switch (and so approve) an extension: those
// run outside its sandbox, and nothing in ?extensions would show them.
function outsiderAction(a) {
  if (!isObject(a)) return null
  if (a.kind === "copy" && typeof a.target === "string" && a.target.length <= MAX_TEXT) return { kind: "copy", target: a.target, label: "copy" }
  if (a.kind === "open" && /^(https?:\/\/|mailto:)/i.test(String(a.target || ""))) return { kind: "open", target: String(a.target).slice(0, 8192), label: "open" }
  return null
}

function outsiderRow(c, type) {
  if (!isObject(c) || (type !== "script" && type !== "wasm")) return c
  var out = Object.assign({}, c)
  if (c.run !== undefined) out.run = outsiderAction(c.run)
  if (c.alt !== undefined) out.alt = outsiderAction(c.alt)
  return out
}

function outsiderTopic(t, type) {
  if (!isObject(t) || !Array.isArray(t.examples)) return t
  return Object.assign({}, t, { examples: t.examples.map(function(e) { return isObject(e) ? outsiderRow(e, type) : e }) })
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
  if (!TYPES[type]) return { error: "type must be \"js\", \"script\", \"native\" or \"wasm\"" }
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
    help: Array.isArray(m.help) ? m.help.map(function(t) { return outsiderTopic(t, type) }) : [],
    commands: Array.isArray(m.commands) ? m.commands.map(function(c) { return outsiderRow(c, type) }) : [],
    minQuery: Math.max(0, Math.min(64, num(m.minQuery, 1))),
    placeholder: typeof m.placeholder === "string" ? m.placeholder.slice(0, 120) : "",
    // native: it lists rows on the empty bar too (pinned apps)
    empty: type === "native" && m.empty === true,
    loads: {},
    actions: {},
    searches: {},
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
  } else if (type === "native" || type === "wasm") {
    if (type === "native" && m.entry !== undefined && (typeof m.entry !== "string" || !/^[A-Za-z0-9_-]+\.js$/.test(m.entry))) return { error: "entry must be a .js file in the extension's folder" }
    if (type === "wasm" && (typeof m.module !== "string" || !/^[A-Za-z0-9._-]+\.wasm$/.test(m.module))) return { error: "module must be a .wasm file in the extension's folder" }
    if (type === "wasm" && (typeof m.source !== "string" || !m.source || m.source.charAt(0) === "/" || m.source.split("/").indexOf("..") >= 0)) return { error: "source must name its source, in its folder" }
    out.entry = type === "native" ? m.entry || "" : ""
    if (type === "wasm") { out.module = m.module; out.source = m.source.replace(/\/+$/, "") }
    var loads = isObject(m.loads) ? m.loads : {}, actions = isObject(m.actions) ? m.actions : {}, searches = isObject(m.searches) ? m.searches : {}
    if (m.loads !== undefined && !isObject(m.loads)) return { error: "loads must be an object" }
    if (m.actions !== undefined && !isObject(m.actions)) return { error: "actions must be an object" }
    if (m.searches !== undefined && !isObject(m.searches)) return { error: "searches must be an object" }
    // A module's answers can't ask for searches (the interface has none),
    // so a manifest can't name ones nobody approved.
    if (type === "wasm" && m.searches !== undefined) return { error: "a WebAssembly extension can't have searches" }
    for (var lk in loads) {
      var l = loads[lk], lc = isObject(l) ? template(l.command, false) : null
      if (!KEY.test(lk) || !lc) return { error: "loads." + lk + " needs a command: a list of strings, with no {1}…{9}" }
      var ttl = Math.max(0, num(l.ttl, 0))
      out.loads[lk] = { command: lc, ttl: ttl, keep: ttl > 0 && l.keep !== false }
    }
    for (var sk in searches) {
      var sr = searches[sk], sc = isObject(sr) ? template(sr.command, true) : null
      if (!KEY.test(sk) || !sc) return { error: "searches." + sk + " needs a command: a list of strings, {1}…{9} never in a script" }
      out.searches[sk] = { command: sc }
    }
    for (var ak in actions) {
      var a = actions[ak], ac = isObject(a) ? template(a.command, true) : null
      if (!KEY.test(ak) || !ac) return { error: "actions." + ak + " needs a command: a list of strings, {1}…{9} never in a script" }
      out.actions[ak] = { command: ac, label: typeof a.label === "string" && a.label ? a.label.slice(0, 30) : "run " + basename(ac[0]), input: a.input === true }
    }
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
// Places a sandboxed script may never write: they run code or hold keys, or
// they're the bar's own (a script that could add an extension there could
// add an unsandboxed one). bin/punctum-sandbox checks the same list.
var DENY_WRITES = [".bashrc", ".bash_profile", ".bash_login", ".profile", ".zshrc", ".zprofile", ".zshenv",
  ".xinitrc", ".xprofile", ".pam_environment", ".ssh", ".gnupg", ".local/bin", ".config/hypr", ".config/systemd",
  ".config/autostart", ".config/uwsm", ".config/environment.d", ".config/omarchy", ".cache/punctum",
  ".local/share/applications", ".config/fish", ".config/nvim", ".config/git", ".gitconfig"]

function parts(p) { return p.slice(2).split("/") }
function within(a, b) { return a.length >= b.length && b.every(function(x, i) { return a[i] === x }) }

// { sandbox: {...} | false } or { error }. Absent means the strictest one.
function sandboxOf(v) {
  if (v === false) return { sandbox: false }
  if (v === undefined || v === true) v = {}
  if (!isObject(v)) return { error: "sandbox must be false or an object" }
  var home = v.home === undefined ? "none" : v.home
  if (!HOME_MODES[home]) return { error: "sandbox.home must be \"none\", \"read\" or \"read-write\"" }
  var paths = function(list) {
    if (list === undefined) return []
    if (!Array.isArray(list) || list.length > 16) return null
    for (var i = 0; i < list.length; i++)
      if (typeof list[i] !== "string" || !SAFE_PATH.test(list[i]) || parts(list[i]).some(function(s) { return s === "" || s === "." || s === ".." })) return null
    return list.slice()
  }
  var reads = paths(v.reads), writes = paths(v.writes)
  if (reads === null || writes === null) return { error: "sandbox.reads and sandbox.writes are lists of paths under ~/ (no empty, . or .. parts)" }
  // One inside another lets a script plant a link in the outer one that the
  // inner one would follow; list each place once.
  var all = reads.concat(writes).map(parts)
  for (var a = 0; a < all.length; a++)
    for (var b = 0; b < all.length; b++)
      if (a !== b && within(all[a], all[b])) return { error: "sandbox paths " + all[a].join("/") + " and " + all[b].join("/") + " overlap" }
  for (var w = 0; w < writes.length; w++)
    for (var d = 0; d < DENY_WRITES.length; d++) {
      var dp = DENY_WRITES[d].split("/"), wp = parts(writes[w])
      if (within(wp, dp) || within(dp, wp)) return { error: "a sandbox may not write " + writes[w] + ": it runs code or holds keys" }
    }
  return { sandbox: { network: v.network === true, home: home, reads: reads, writes: writes } }
}

// The argument list that runs `command` for this extension: through
// bin/punctum-sandbox (helper), which builds the bwrap command when it
// runs, or as it is when the manifest says "sandbox": false. Fails closed:
// null when it should be sandboxed but can't be (no home, no helper).
function wrap(m, command, home, helper) {
  if (!m.sandbox) return command
  if (!home || home.charAt(0) !== "/" || !helper || helper.charAt(0) !== "/") return null
  var sb = m.sandbox
  var spec = { dir: m.dir, home: home, network: !!sb.network, home_mode: sb.home, reads: sb.reads, writes: sb.writes }
  return ["python3", helper, JSON.stringify(spec), "--"].concat(command)
}

// What ?extensions says about it.
function sandboxSummary(m) {
  if (m.type !== "script") return ""
  if (!m.sandbox) return "not sandboxed"
  var sb = m.sandbox, bits = [sb.network ? "network on" : "no network",
    sb.home === "none" ? "home hidden" : sb.home === "read" ? "home readable (sockets in it too)" : "home writable, which is not a sandbox"]
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
    // A native extension is code inside punctumd, which ships with the bar.
    if (m.type === "native" && m.user) { errors.push({ dir: f.dir, error: "native extensions come with Punctum; write yours as a script, js or wasm extension" }); continue }
    if (m.type === "wasm") {
      var w = isObject(f.wasm) ? f.wasm : {}
      if (!/^[0-9a-f]{64}$/.test(String(w.sha256)) || typeof w.module !== "string") { errors.push({ dir: f.dir, error: "its module wasn't read" }); continue }
      m.sha256 = w.sha256
      m.manifestSha256 = /^[0-9a-f]{64}$/.test(String(w.manifest_sha256)) ? w.manifest_sha256 : ""
      m.wasmModule = w.module
      m.bytes = Number(w.bytes) || 0
      m.sourcePath = typeof w.source === "string" ? w.source : m.dir + "/" + m.source
      m.sourceIsDir = w.source_is_dir === true
    }
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

// WebAssembly extensions you approved in ?extensions: { id: { module, manifest } },
// the SHA-256s of the module and the manifest you saw. One whose module or
// manifest changed since is off until you approve it again.
var wasmTrust = {}
function setWasmTrust(t) { wasmTrust = isObject(t) ? t : {} }
function approved(m) {
  var t = wasmTrust[m.id]
  return isObject(t) && t.module === m.sha256 && t.manifest === m.manifestSha256
}

function isOn(manifest, userConfig) {
  if (manifest.missing && manifest.missing.length) return false
  if (manifest.type === "wasm" && !approved(manifest)) return false
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
      var cmd = wrap(m, m.command, ctx.home, ctx.sandboxHelper)
      if (!cmd) return [{ title: m.name + " can't run sandboxed here", subtitle: "No home folder or sandbox helper", score: 40, copy: "" }]
      if (m.refresh && ctx.requestJob) { var rc = wrap(m, m.refresh.command, ctx.home, ctx.sandboxHelper); if (rc) ctx.requestJob("refresh", rc, { every: m.refresh.every, rerun: true }) }
      var key = text
      var have = ctx.search
      if (!have || have.key !== key) {
        if (ctx.requestSearch) ctx.requestSearch(key, [cmd], {
          stdin: JSON.stringify({ protocol: 1, query: q, text: text, settings: ctx.settings === undefined ? {} : ctx.settings, home: ctx.home })
        })
        if (!have) return [{ title: "Searching…", subtitle: m.name, score: 40, copy: "" }]
      }
      if (have.failed && have.key === key) return [{ title: m.name + " couldn't run", subtitle: have.error || (m.command[0] + " · is it executable?"), score: 40, copy: "" }]
      var out = parseOutput(have.text)
      if (out.error) return have.key === key ? [{ title: m.name + ": " + out.error, subtitle: m.dir, score: 40, copy: "" }] : []
      if (!out.items.length && have.key === key)
        return [{ title: have.timedOut ? "Stopped after 3 s" : (out.message || "Nothing found"), subtitle: m.name, score: 40, copy: "" }]
      // A command a sandboxed script's row runs on Enter runs in the same
      // sandbox; one that can't be sandboxed isn't offered.
      if (m.sandbox) out.items.forEach(function(it) {
        ["run", "alt"].forEach(function(k) {
          var a = it[k]
          if (!a || a.kind !== "argv") return
          var w = wrap(m, a.target, ctx.home, ctx.sandboxHelper)
          if (!w) { it[k] = null; return }
          a.target = w
          a.label = a.label + " (sandboxed)"
        })
      })
      return out.items
    }
  }
}

// ---------------------------------------------------------------- native extensions

// A provider object for a native extension, answered by punctumd, the bar's
// Rust daemon, through ctx.native(query): the rows when they're in, null
// while it's asking (they land a moment later and the bar runs the query
// again). Help and commands come from the manifest; with "empty": true, its
// answer to "" is what it lists on the empty bar. Rows go through the same
// checks as a script's, keeping their own scores, and may also use the
// bar's own app and window actions, checked here. They can't name a program
// to run: only one of the manifest's "actions", by name, with strings for
// its {1}…{9}.
//
// An answer may say it "needs" loads, by the manifest's keys: the bar runs
// each one's command (through ctx.load, once per open or every ttl ms) and
// sends punctumd the output, after which the query is asked again.
var APP_ID = /^[A-Za-z0-9._+-]{1,200}$/

function cleanNativeAction(a, m, ctx) {
  // A sandboxed module opens web and mail addresses, never a local file.
  if (m && m.type === "wasm" && isObject(a) && a.kind === "open" && !/^(https?:\/\/|mailto:)/i.test(String(a.target || ""))) return null
  if (isObject(a) && a.kind === "action") {
    var t = m && m.actions ? m.actions[a.name] : null
    if (!t || !Object.prototype.hasOwnProperty.call(m.actions, a.name) || (a.args !== undefined && !Array.isArray(a.args))) return null
    var argv = fill(t.command, m, ctx || {}, a.args || [])
    if (!argv) return null
    var act = { kind: "argv", target: argv, label: t.label }
    if (t.input && typeof a.input === "string" && a.input.length <= 65536) act.input = a.input
    return act
  }
  if (isObject(a) && a.kind === "argv") return null
  if (isObject(a) && a.kind === "app") {
    if (typeof a.target !== "string" || !APP_ID.test(a.target)) return null
    var label = a.label === "open new" ? "open new" : "open"
    if (a.action === undefined) return { kind: "app", target: a.target, label: label }
    return a.action === Math.floor(a.action) && a.action >= 0 && a.action < 100 ? { kind: "app", target: a.target, action: a.action, label: label } : null
  }
  if (isObject(a) && a.kind === "window")
    return typeof a.target === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(a.target) ? { kind: "window", target: a.target, label: "switch" } : null
  return cleanAction(a)
}

function cleanNativeRow(it, n, m, ctx) {
  var row = cleanItem(it, n)
  if (!row) return null
  row.run = cleanNativeAction(it.run, m, ctx)
  row.alt = cleanNativeAction(it.alt, m, ctx)
  if (typeof it.score === "number" && isFinite(it.score)) row.score = it.score
  if (typeof it.swatch === "string" && /^#[0-9a-f]{6}$/.test(it.swatch)) row.swatch = it.swatch
  if (typeof it.group === "string" && it.group) row.group = it.group.slice(0, 60)
  // A sandboxed module's rows stay under its own heading ("Roman · sandboxed")
  // and can't outrank an answer in its own mode.
  if (m && m.type === "wasm") { row.score = Math.max(0, Math.min(97, row.score)); delete row.group }
  if (typeof it.appId === "string" && APP_ID.test(it.appId)) row.appId = it.appId
  if (it.pinned === true) row.pinned = true
  return row
}

// What the bar keeps of one of punctumd's replies, for ctx.native: its rows,
// the loads and the search it asks for, and until when it holds (0: until
// the config changes). Everything nativeProvider reads must be here.
function nativeAnswer(r, now) {
  var ttl = Number(r && r.ttl)
  return { rows: r && Array.isArray(r.rows) ? r.rows : [], needs: r && Array.isArray(r.needs) ? r.needs : [],
           search: r && isObject(r.search) ? r.search : null, until: ttl > 0 ? now + ttl : 0 }
}

function nativeProvider(m) {
  // A WebAssembly extension with a mode sees only queries in it: less of
  // what you type reaches code you didn't write. (The bar's own native
  // extensions may answer outside their mode, as Windows does for "brave".)
  var only = m.type === "wasm" && m.mode ? new RegExp(m.mode.pattern, "i") : null
  var rowsFor = function(query, ctx) {
    if (only && !only.test(String(query || ""))) return []
    var reply = ctx.native ? ctx.native(String(query || "")) : null
    var rows = Array.isArray(reply) ? reply : isObject(reply) && Array.isArray(reply.rows) ? reply.rows : null
    var needs = isObject(reply) && Array.isArray(reply.needs) ? reply.needs : []
    for (var k = 0; k < needs.length && k < 8; k++) {
      var l = typeof needs[k] === "string" && Object.prototype.hasOwnProperty.call(m.loads, needs[k]) ? m.loads[needs[k]] : null
      var argv = l ? fill(l.command, m, ctx, null) : null
      if (argv && ctx.load) ctx.load(needs[k], argv, { ttl: l.ttl, keep: l.keep, native: true })
    }
    // A search this answer asks for: the manifest's commands, filled with
    // its strings, run by the bar's search runner for this key. What has
    // landed for this extension goes back to punctumd.
    var want = isObject(reply) && isObject(reply.search) ? reply.search : null
    if (want && typeof want.key === "string" && want.key.length <= 1024 && Array.isArray(want.runs) && ctx.requestSearch && (!ctx.search || ctx.search.key !== want.key)) {
      var argvs = []
      for (var s = 0; s < want.runs.length && s < 4; s++) {
        var run = want.runs[s], t = isObject(run) && typeof run.name === "string" && Object.prototype.hasOwnProperty.call(m.searches, run.name) ? m.searches[run.name] : null
        var filled = t && (run.args === undefined || Array.isArray(run.args)) ? fill(t.command, m, ctx, run.args || []) : null
        if (filled) argvs.push(filled)
      }
      if (argvs.length === want.runs.length && argvs.length) ctx.requestSearch(want.key, argvs)
    }
    if (ctx.search && ctx.nativeSearch) ctx.nativeSearch(ctx.search)
    if (!rows) return []
    var out = []
    for (var i = 0; i < rows.length && out.length < MAX_ITEMS; i++) {
      var row = cleanNativeRow(rows[i], out.length, m, ctx)
      if (row) out.push(row)
    }
    return out
  }
  var p = {
    id: m.id,
    // A sandboxed module's group says so.
    name: m.type === "wasm" ? m.name + " · sandboxed" : m.name,
    icon: m.icon,
    help: m.help,
    commands: m.commands,
    match: function(query, ctx) { return String(query || "") === "" ? [] : rowsFor(query, ctx) }
  }
  if (m.empty) p.empty = function(ctx) { return rowsFor("", ctx) }
  return p
}
