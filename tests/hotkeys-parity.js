// node tests/hotkeys-parity.js [punctumd] — the JS hotkeys provider and the
// Rust one in punctumd, given the same omarchy-menu-keybindings records
// (tests/fixtures/keybindings.txt, from an Omarchy install, plus odd ones),
// must give the same rows in the same order. In "keys" mode Rust may add
// bindings after them whose labels have the query's letters in order
// (hotkeys.rs), which can replace the JS's "No keybinding matches" row.
// SHOW=1 lists what Rust adds.
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Hot = load(P + "extensions/hotkeys/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const text = fs.readFileSync(P + "tests/fixtures/keybindings.txt", "utf8") + [
  "SUPER + XF86AudioRaiseVolume → Louder\texec\twpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+",
  "SUPER + W → Close window", "  → no keys", "SUPER + Q →  ", "CTRL ALT + DELETE → Lock\texec\tloginctl lock\twith\ttabs",
  "SUPER + F → Full screen\tlua\thl.dsp.window.fullscreen(0)", "SUPER SHIFT + F → Full screen\tlua\thl.dsp.window.fullscreen(0)",
  "SUPER + grave → Éditeur à l'ancienne\texec\tgnome-text-editor", "no arrow at all", ""].join("\n")

function corpus() {
  const out = ["", "keys", "keys ", "keys  ", "KEYS ", "x", "zz", "2+2", "super + f", "keys super + f", "keys super f", "keys + f", "keys super shift + return", "+ +"]
  const words = new Set()
  for (const line of text.split("\n")) for (const w of line.toLowerCase().split(/[^a-z0-9]+/)) if (w) words.add(w)
  for (const w of words) {
    out.push(w, "keys " + w)
    for (let i = 1; i < Math.min(w.length, 6); i++) out.push(w.slice(0, i), "keys " + w.slice(0, i))
    out.push(w.replace(/[aeiou]/g, ""), "keys " + w.replace(/[aeiou]/g, ""))
  }
  out.push("full screen", "screenshot", "keys screenshot", "file manager", "keys file man", "toggle", "keys volume", "lock", "close window", "keys éditeur")
  return [...new Set(out)]
}

const ctx = { load: () => text, omarchyPath: "/usr/share/omarchy" }
const queries = corpus()
const lines = [JSON.stringify({ id: "l", op: "load", ext: "hotkeys", key: "binds", text })]
const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "hotkeys", query }))).join("\n") + "\n"
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
// The JS runs dispatch_binding through bash; Rust names the manifest's
// "dispatch" action with the same two strings.
const action = a => !a ? null : a.kind === "argv" ? { args: a.target.slice(-2) } : a.kind === "action" && a.name === "dispatch" ? { args: a.args } : a
const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon || "", score: r.score, copy: r.copy || "", group: r.group || "", run: action(r.run) })
let diffs = 0, extra = 0, answered = 0
queries.forEach((q, id) => {
  const js = Hot.provider.match(q, ctx).map(fields)
  const rs = (replies[id].rows || []).map(fields)
  if (rs.length) answered++
  const noMatch = js.length === 1 && /^No keybinding matches/.test(js[0].title)
  const base = noMatch && rs.length && rs[0].group ? [] : js
  const head = JSON.stringify(rs.slice(0, base.length)) === JSON.stringify(base)
  const tail = rs.slice(base.length)
  const ok = head && tail.every(r => r.group === "Hotkeys") && rs.length <= 60
  if (ok) { if (tail.length) { extra++; if (process.env.SHOW) console.log("  + " + JSON.stringify(q) + " → " + tail.map(r => r.title).join(" | ")) } return }
  if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js.map(r => r.title + "@" + r.score)) + "\n  rust: " + JSON.stringify(rs.map(r => r.title + "@" + r.score)))
})
console.log((diffs ? "FAIL" : "ok  ") + "  hotkeys: JS and Rust agree on " + (queries.length - diffs) + " of " + queries.length + " queries over " + text.split("\n").length + " records ("
  + answered + " with answers; in " + extra + " Rust adds bindings found by their label's letters in order, after the rest)")
process.exit(diffs ? 1 : 0)
