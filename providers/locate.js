.pragma library
.import "files.js" as Files

// Everything-style file search: names anywhere on the disk, as you type.
//
//   /notes · /report .pdf$ · /dwnlds · /hosts !backup · /'exact name
//
// Names come from two plocate indexes: the system's (rebuilt nightly by
// plocate-updatedb.timer, so it misses today's files) for everything outside
// your home folder, and a private one of your home folder, rebuilt in about
// half a second on the first "/" query after the bar opens, at most once a
// minute. fzf filters what they return, so its query syntax works: words in
// any order, 'exact, ^start (of a name), end$, !leave-out.
// "locate": { "exclude": [...] } drops paths containing any of those
// strings, to keep caches and package trees out of the way.
//
// Measured 2026-10-09: 602k paths in the system index, a literal lookup in
// 10 ms, a letters-in-order lookup in 50 ms, fzf ranking in about 5 ms.
//
// The script is fixed; the query reaches it as arguments. plocate gets plain
// words (a pass with the words as typed, then a pass with the letters in
// order, so "dwnlds" finds Downloads without the fuzzy pass crowding out
// the obvious answer), and fzf gets the whole query as one --filter= value.

var MIN_QUERY = 2
var LIMIT = 40
var MAX_QUERY = 160
var DEFAULT_EXCLUDE = ["/.cache/", "/.cargo/registry/", "/.cargo/git/", "/node_modules/", "/.local/share/Trash/", "/.git/"]

var SCRIPT = [
  'c="${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-commandbar"; home="$c/home.db"; sys=/var/lib/plocate/plocate.db',
  'q=$1; n=$2; ex=$3; shift 3',
  'case $n in ""|*[!0-9]*) exit 2;; esac',
  // Every command is bounded: stopping the bash above it doesn't stop them.
  'loc() { timeout 3 plocate -0 -i "$@" 2>/dev/null; }',
  // Drops paths under $1 (the system index's copy of home is a day old; the
  // private one is current) and anything containing an exclusion.
  'keep() { awk -v RS="\\0" -v ORS="\\0" -v h="$1" -v ex="$ex" \'BEGIN { k = split(tolower(ex), e, "\\n") } h != "" && index($0, h) == 1 { next } { p = tolower($0); for (i = 1; i <= k; i++) if (e[i] != "" && index(p, e[i])) next; print }\'; }',
  // The cap comes after the filters, so a word common under home or in a
  // cache can't use it up before the rest of the disk is reached.
  'pass() { if [ -r "$home" ]; then loc -d "$sys" "$@" | keep "$HOME/" | head -z -n 3000; loc -d "$home" "$@" | keep "" | head -z -n 3000; else loc -d "$sys" "$@" | keep "" | head -z -n 3000; fi; }',
  '{ [ "$n" -gt 0 ] && pass -- "${@:1:n}"; [ $# -gt "$n" ] && pass --regexp -- "${@:n+1}"; } | timeout 3 fzf --read0 --print0 --scheme=path --filter="$q" 2>/dev/null | head -z -n 400'
].join("\n")

// Rebuilds the private index of home. Run from CommandBar.qml.
var INDEX_SCRIPT = 'umask 077; c="${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-commandbar"; mkdir -p "$c" && updatedb -l 0 -U "$HOME" -o "$c/home.db.tmp" && chmod 600 "$c/home.db.tmp" && mv -f "$c/home.db.tmp" "$c/home.db"'

function prefix(query) { return String(query || "").match(/^\s*\/(.*)$/) }

function terms(text) { return String(text || "").trim().split(/\s+/).filter(function(t) { return t && t !== "|" }) }

// The plain words plocate can look for: fzf's operators stripped, negated
// terms left to fzf.
function literals(ts) {
  var out = []
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i]
    if (t.charAt(0) === "!") continue
    t = t.replace(/^['^]+/, "").replace(/\$$/, "")
    if (t.length >= 1) out.push(t)
  }
  return out
}

// plocate reads an unescaped * ? or [ as a glob over the whole path, so
// "file[1]" would find nothing.
function globSafe(t) { return t.replace(/[\\*?[\]]/g, "\\$&") }

// fzf anchors ^ to the whole line, and every path starts with "/", so ^down
// never matched a name: it becomes an exact match at a segment start.
function fzfQuery(ts) {
  return ts.map(function(t) { return /^\^[^\/]/.test(t) ? "'/" + t.slice(1) : t }).join(" ")
}

// Letters in order inside one path segment, as a basic regex. Only letters
// and digits go in, so nothing needs escaping. Exact terms ('x) and short
// ones get no fuzzy pass.
function fuzzies(ts) {
  var out = []
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i]
    if (/^[!']/.test(t)) continue
    var letters = t.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (letters.length >= 3) out.push(letters.split("").join("[^/]*"))
  }
  return out
}

function excludes(settings) {
  var e = settings && Array.isArray(settings.exclude) ? settings.exclude : DEFAULT_EXCLUDE
  return e.map(String).filter(function(x) { return x && !/\s/.test(x) })
}

// Null when there's nothing worth asking.
function plan(text, settings) {
  var ts = terms(text)
  var lit = literals(ts)
  if (!lit.length || lit.join("").length < MIN_QUERY || String(text).length > MAX_QUERY || ts.length > 10 || /[\u0000-\u001f]/.test(text)) return null
  var fz = fuzzies(ts)
  // A fuzzy pass only helps when it can find something the literal one can't.
  if (fz.length !== lit.length) fz = []
  var q = fzfQuery(ts), ex = excludes(settings).join("\n")
  var argv = ["bash", "-c", SCRIPT, "commandbar-locate", q, String(lit.length), ex].concat(lit.map(globSafe), fz)
  return { key: "locate\n" + q + "\n" + ex, argv: argv }
}

function parse(output) {
  var parts = String(output || "").split("\u0000"), out = [], seen = {}
  for (var i = 0; i < parts.length - 1; i++) {
    var p = parts[i]
    if (p.charAt(0) !== "/" || seen[p]) continue
    seen[p] = true
    out.push(p)
  }
  return out
}

// fzf filters and applies the query syntax; the order is the desktop's: a
// name that is the word, then starts with it, contains it, or has its letters
// in order, a small lift for your home folder and a small drop for hidden
// paths, then shallower and shorter. fzf's own order breaks ties. (fzf alone
// put ~/Downloads under an Android icon file for "dwnlds".)
function rank(path, lits, home) {
  var name = path.slice(path.lastIndexOf("/") + 1).toLowerCase(), best = 0
  for (var i = 0; i < lits.length; i++) {
    var w = lits[i].toLowerCase()
    var r = name === w ? 4 : name.indexOf(w) === 0 ? 3 : name.indexOf(w) >= 0 ? 2 : Files.subsequence(name, w) ? 1 : 0
    if (r > best) best = r
  }
  var inHome = home && path.indexOf(home + "/") === 0
  return best + (inHome ? 0.5 : 0) - (/\/\./.test(inHome ? path.slice(home.length) : path) ? 0.2 : 0)
    - path.split("/").length * 0.01 - name.length * 0.0001
}

function ordered(paths, text, home) {
  var lits = literals(terms(text))
  return paths.map(function(p, i) { return { p: p, i: i, r: rank(p, lits, home) } })
    .sort(function(a, b) { return b.r - a.r || a.i - b.i })
    .map(function(x) { return x.p })
}

function short(path, home) { return home && (path === home || path.indexOf(home + "/") === 0) ? "~" + path.slice(home.length) : path }

function row(path, ctx, n) {
  var slash = path.lastIndexOf("/")
  var name = path.slice(slash + 1) || "/"
  var dir = path.slice(0, slash) || "/"
  var entry = { rel: name, dir: false }
  var kind = Files.kindOf(entry)
  return {
    title: name,
    subtitle: short(dir, ctx.home),
    icon: Files.ICONS[kind],
    image: kind === "image" ? path : "",
    score: 97 - n * 0.001,
    copy: "",
    run: { kind: "argv", target: ["xdg-open", path], label: "open" },
    alt: { kind: "argv", target: ["uwsm-app", "--", "xdg-terminal-exec", "--dir=" + dir], label: "terminal here" }
  }
}

var provider = {
  id: "locate",
  name: "Everywhere",
  icon: "󰍉",
  commands: [
    { title: "Find files everywhere", keywords: "files everything locate find search disk system", text: "/ and a name: every file on the disk, instantly", complete: "/" }
  ],
  help: [
    { id: "locate", title: "Find everywhere", about: "/ and a name searches every file on the disk. fzf syntax: 'exact, ^start, end$, !leave-out. Home is current; elsewhere is as of last night",
      examples: [{ q: "/", note: "Type a name after it" }, { q: "/report .pdf$", hint: "PDFs with report in the name" }, { q: "/hosts !backup", hint: "Leave out backups" }] }
  ],
  match: function(query, ctx) {
    var m = prefix(query)
    if (!m) return []
    var p = plan(m[1], ctx.settings)
    if (!p) return [{ title: "Type a file or folder name", subtitle: "Everywhere on the disk · 'exact ^start end$ !leave-out", score: 40, copy: "" }]
    if (ctx.requestHomeIndex) ctx.requestHomeIndex()
    var have = ctx.search
    if (!have || have.key !== p.key) {
      if (ctx.requestSearch) ctx.requestSearch(p.key, p.argv)
      if (!have || have.key.indexOf("locate\n") !== 0) return [{ title: "Searching…", subtitle: "Everywhere", score: 40, copy: "" }]
    }
    var paths = ordered(parse(have.text), m[1], ctx.home)
    if (!paths.length && have.key === p.key && have.timedOut) return [{ title: "Stopped after 3 s", subtitle: "Everywhere · try a longer name", score: 40, copy: "" }]
    if (!paths.length) return have.key === p.key ? [{ title: "Nothing named like \"" + m[1].trim() + "\"", subtitle: "Everywhere · files from today outside your home folder show up tomorrow", score: 40, copy: "" }] : []
    return paths.slice(0, LIMIT).map(function(path, n) { return row(path, ctx, n) })
  }
}
