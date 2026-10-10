// node tests/windows-parity.js [punctumd] — the JS windows provider and the
// Rust one in punctumd, given the same windows and apps, must give the same
// rows in the same order. Rust may add windows after them whose titles have
// the query's letters in order (windows.rs); in "w" mode that can replace
// the JS's "No window matches" row. SHOW=1 lists what Rust adds.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Win = load(P + "extensions/windows/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const apps = [
  ["brave-browser", "Brave", "Web Browser", ["internet"]], ["firefox", "Firefox", "Web Browser", []], ["org.gnome.Nautilus", "Files", "File Manager", ["folder"]],
  ["code", "Visual Studio Code", "Text Editor", ["vscode"]], ["signal", "Signal", "Messenger", ["chat"]], ["spotify", "Spotify", "Music Player", []],
  ["obsidian", "Obsidian", "", ["notes"]], ["com.mitchellh.ghostty", "Ghostty", "Terminal", ["shell"]], ["éditeur", "Éditeur", "", []],
].map(([id, name, generic, keywords]) => ({ id, name, generic, comment: "", keywords, icon: id, wmclass: id === "code" ? "Code" : "", actions: [] }))
const titles = ["Netflix - Brave", "GitHub - Brave", "Pull request #12 · mycosavant/punctum", "Inbox (3) - Proton Mail", "Images", "Downloads", "~/Code", "btop",
  "Omarchy Rust rewrite feasibility", "nvim README.md", "Spotify Premium", "Signal", "Obsidian - notes", "Visual Studio Code", "main.rs - punctum - Visual Studio Code",
  "Mozilla Firefox", "Firefox Private Browsing", "YouTube — Firefox", "", "Untitled", "Éditeur de texte", "CPU at 100%", "watch -n1 sensors", "ssh hypha@server"]
const classes = ["brave-browser", "brave-browser", "brave-browser", "firefox", "org.gnome.Nautilus", "org.gnome.Nautilus", "com.mitchellh.ghostty", "com.mitchellh.ghostty",
  "com.mitchellh.ghostty", "com.mitchellh.ghostty", "spotify", "signal", "obsidian", "Code", "Code", "firefox", "firefox", "firefox", "unknown.app", "kitty", "éditeur",
  "com.mitchellh.ghostty", "foot", "Alacritty"]
const windows = titles.map((title, i) => ({ address: "0x" + (0xa0 + i).toString(16), cls: classes[i], title, workspace: i % 7 === 0 ? "special:scratch" : String(1 + i % 5), focus: (i * 7) % titles.length }))
windows.push({ address: "$(rm -rf ~)", cls: "evil", title: "Evil", workspace: "1", focus: 99 }, { address: "0xff", cls: "x", title: "no focus field", workspace: 3 })

function corpus() {
  const out = ["", "w", "w ", "w  ", "W ", "x", "zz", "2+2"]
  const words = new Set()
  for (const t of titles.concat(apps.map(a => a.name), classes)) for (const w of t.toLowerCase().split(/[^a-z0-9#~%]+/)) if (w) words.add(w)
  for (const w of words) {
    out.push(w, "w " + w)
    for (let i = 1; i < Math.min(w.length, 6); i++) out.push(w.slice(0, i), "w " + w.slice(0, i))
    out.push(w.replace(/[aeiou]/g, ""), "w " + w.replace(/[aeiou]/g, ""))
  }
  out.push("pull request", "w pull request", "omarchy rust", "w omrch", "omrch", "vs code", "w vs", "brave git", "rust rewrite", "w rst rwrt", "proton mail", "w ssh")
  return [...new Set(out)]
}

const ctx = { windows, apps }
const queries = corpus()
const lines = [["apps", apps], ["windows", windows]].map(([key, value]) => JSON.stringify({ id: "d", op: "data", key, value }))
const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "windows", query }))).join("\n") + "\n"
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
const action = a => a ? { kind: a.kind, target: a.target, label: a.label } : null
const fields = r => ({ title: r.title, subtitle: r.subtitle, image: r.image || "", icon: r.icon || "", score: r.score, copy: r.copy || "", run: action(r.run) })
let diffs = 0, extra = 0, answered = 0
queries.forEach((q, id) => {
  const js = Win.provider.match(q, ctx).map(fields)
  const rs = (replies[id].rows || []).map(fields)
  if (rs.length) answered++
  const noMatch = js.length === 1 && /^No window matches/.test(js[0].title)
  const base = noMatch && rs.length && rs[0].run ? [] : js
  const head = JSON.stringify(rs.slice(0, base.length)) === JSON.stringify(base)
  const tail = rs.slice(base.length)
  const ok = head && tail.every(r => r.run && r.run.kind === "window") && rs.length <= 8
  if (ok) { if (tail.length) { extra++; if (process.env.SHOW) console.log("  + " + JSON.stringify(q) + " → " + tail.map(r => r.title).join(" | ")) } return }
  if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js.map(r => r.title + "@" + r.score)) + "\n  rust: " + JSON.stringify(rs.map(r => r.title + "@" + r.score)))
})
console.log((diffs ? "FAIL" : "ok  ") + "  windows: JS and Rust agree on " + (queries.length - diffs) + " of " + queries.length + " queries over " + windows.length + " windows ("
  + answered + " with answers; in " + extra + " Rust adds windows found by their title's letters in order, after the rest)")
process.exit(diffs ? 1 : 0)
