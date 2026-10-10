.pragma library

// Packages from the repositories in your pacman.conf (Arch's, and Omarchy's
// own on this machine); the AUR isn't searched.
//
//   pkg kfind · pkg file search
//
// The whole list is read once, the first time "pkg " is typed after the bar
// opens, with expac (installed packages, then every package in the sync
// databases), and dropped when the bar closes. Nothing is fetched from the
// network: it searches what your last `pacman -Sy` downloaded.
//
// Enter on a package you don't have opens a terminal running
// `sudo pacman -S <repo>/<name>`, so pacman shows what it will do and asks
// first, and a name in two repositories installs from the row you chose.
// Enter on one you have shows `pacman -Qi`. Shift+Enter opens its page on
// archlinux.org for Arch's own repositories, `pacman -Si` for others. The
// name reaches bash as $1, and only names pacman itself allows are offered.

var LIMIT = 30
var NAME = /^[a-z0-9@_+][a-z0-9@._+-]{0,127}$/
var REPO = /^[a-z0-9._-]{1,64}$/

// The script is fixed; the package name is its $1.
var INSTALL = "sudo pacman -S -- \"$1\"; s=$?; [ \"$s\" = 130 ] || omarchy-show-done"
var DETAILS = "pacman -Qi -- \"$1\"; omarchy-show-done"
var REPO_DETAILS = "pacman -Si -- \"$1\"; omarchy-show-done"
var ARCH_REPOS = /^(core|extra|multilib)(-testing|-staging)?$|^(core|extra)-debug$/

// Lines "Q\tname\tversion" and "S\trepo\tname\tversion\tarch\tdescription".
function parse(text) {
  var installed = {}, list = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("\t")
    if (f[0] === "Q" && f.length >= 3 && NAME.test(f[1])) installed[f[1]] = f[2]
    else if (f[0] === "S" && f.length >= 6 && REPO.test(f[1]) && NAME.test(f[2]))
      list.push({ repo: f[1], name: f[2], version: f[3], arch: /^[a-z0-9_]+$/.test(f[4]) ? f[4] : "x86_64", desc: f.slice(5).join(" ") })
  }
  return { installed: installed, list: list }
}

// Every package, read once per open with expac (about 0.15 s and 1.2 MB for
// 15,000 packages, measured 2026-10-09) and dropped when the bar closes, so
// an install shows up next time.
var LIST = ["bash", "-c", "expac -Q 'Q\\t%n\\t%v' && expac -S 'S\\t%r\\t%n\\t%v\\t%a\\t%d'"]

// The same text parses to the same list; keep it rather than split 1.2 MB on
// every keystroke.
var memo = { text: null, data: null }
function parsed(text) {
  if (text === null || text === undefined) return null
  if (memo.text !== text) memo = { text: text, data: parse(text) }
  return memo.data
}

function words(q) { return String(q || "").toLowerCase().split(/\s+/).filter(function(w) { return w }) }

// Higher is better: the exact name, a name starting with the first word, a
// name containing it, then every word somewhere in name or description.
function rank(p, ws) {
  var name = p.name.toLowerCase(), hay = name + " " + p.desc.toLowerCase()
  for (var i = 0; i < ws.length; i++) if (hay.indexOf(ws[i]) < 0) return 0
  var q = ws.join("-")
  if (name === q || name === ws.join("")) return 4
  if (name.indexOf(ws[0]) === 0) return 3 - name.length * 0.001
  if (name.indexOf(ws[0]) >= 0) return 2 - name.length * 0.001
  return 1
}

function terminal(script, title, name) {
  return ["uwsm-app", "--", "xdg-terminal-exec", "--app-id=org.omarchy.terminal", "--title=" + title, "-e", "bash", "-c", script, "commandbar-pkg", name]
}

function row(p, installed, n) {
  var have = Object.prototype.hasOwnProperty.call(installed, p.name)
  var newer = have && installed[p.name] !== p.version
  return {
    title: p.name,
    subtitle: p.version + " · " + p.repo + (have ? (newer ? " · installed " + installed[p.name] : " · installed") : "") + (p.desc ? " · " + p.desc : ""),
    icon: have ? "󰏗" : "󰏔",
    score: 97 - n * 0.001,
    copy: "",
    run: have ? { kind: "argv", target: terminal(DETAILS, "Package " + p.name, p.name), label: "details" }
              : { kind: "argv", target: terminal(INSTALL, "Install " + p.name, p.repo + "/" + p.name), label: "install" },
    alt: ARCH_REPOS.test(p.repo)
      ? { kind: "open", target: "https://archlinux.org/packages/" + encodeURIComponent(p.repo) + "/" + encodeURIComponent(p.arch) + "/" + encodeURIComponent(p.name) + "/", label: "archlinux.org" }
      : { kind: "argv", target: terminal(REPO_DETAILS, "Package " + p.name, p.repo + "/" + p.name), label: "details" }
  }
}

var provider = {
  id: "packages",
  name: "Packages",
  icon: "󰏖",
  commands: [
    { title: "Search packages", keywords: "packages pacman install software arch repo", text: "pkg and a name, from your pacman repositories", complete: "pkg " }
  ],
  help: [
    { id: "packages", title: "Packages", about: "pkg and a name searches your pacman repositories. Enter installs one you don't have (pacman asks first) or shows one you do; Shift+Enter opens archlinux.org",
      examples: [{ q: "pkg ", note: "Type a name after it" }, { q: "pkg kfind", hint: "A package by name" }, { q: "pkg file search", hint: "Words in the description" }] }
  ],
  forget: function() { memo = { text: null, data: null } },
  match: function(query, ctx) {
    var m = String(query || "").match(/^\s*(?:pkg|pacman)\s([\s\S]*)$/i)
    if (!m) return []
    var ws = words(m[1])
    var data = parsed(ctx.load("list", LIST))
    if (!data) return [{ title: "Reading the package list…", subtitle: "Packages", score: 40, copy: "" }]
    if (!data.list.length) return [{ title: "Couldn't read the package list", subtitle: "Packages · is expac installed? (pacman -S expac)", score: 40, copy: "" }]
    if (!ws.length) return [{ title: "Type a package name or words", subtitle: data.list.length + " packages in your repositories, " + Object.keys(data.installed).length + " installed", score: 40, copy: "" }]
    var hits = []
    for (var i = 0; i < data.list.length; i++) {
      var r = rank(data.list[i], ws)
      if (r > 0) hits.push({ p: data.list[i], r: r })
    }
    hits.sort(function(a, b) { return b.r - a.r || (a.p.name < b.p.name ? -1 : 1) })
    if (!hits.length) return [{ title: "No package matches \"" + m[1].trim() + "\"", subtitle: "Packages · your pacman repositories, no AUR", score: 40, copy: "" }]
    return hits.slice(0, LIMIT).map(function(h, n) { return row(h.p, data.installed, n) })
  }
}
