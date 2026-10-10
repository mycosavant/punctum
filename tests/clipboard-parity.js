// node tests/clipboard-parity.js [punctumd] — the JS clipboard provider and
// the Rust one in punctumd, given the same clipboard history, must give the
// same rows in the same order. The one difference: Rust says it's reading
// the history before it has it, where the JS says it's empty; the bar's
// load is always there here.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Clip = load(P + "extensions/clipboard/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const texts = ["invoice 42", "https://github.com/mycosavant/punctum/pull/12", "sudo pacman -S rust", "line one\nline two\nline three",
  "  padded\t\twith   space  ", "Ünïcödé façade naïve", "emoji 😀 party 🎉🎉", "x".repeat(400), "word ".repeat(100), "😀".repeat(200),
  "café\r\nnewline", "", "INVOICE uppercase", "{\"json\": true}", "tab\tseparated\tvalues", "a".repeat(9000) + "needle at the end"]
const history = []
texts.forEach((text, i) => history.push({ type: "text", text, addedAt: NOW - i * 3700 * 1000 * (i % 3 + 1), pinned: i % 5 === 2 }))
history.push({ type: "image", path: "/home/u/Pictures/shot.png", mime: "image/png", capturedAt: "2026-10-10 09:00", addedAt: NOW - 30000 })
history.push({ type: "image", path: "/tmp/b.jpg", pinned: true, addedAt: NOW - 86400000 * 3 })
history.push({ type: "image", path: "relative.png" }, { type: "text", text: 5 }, { type: "file", path: "/x" }, "junk", null,
  { type: "text", text: "no time" }, { type: "text", text: "future", addedAt: NOW + 50000 }, { type: "image", path: "/x.png", mime: "", capturedAt: "" })
const files = [JSON.stringify(history), "not json", "{}", "[]", JSON.stringify([{ type: "text", text: "only" }])]

function corpus() {
  const out = ["", "cb", "cb ", "cb  ", "CB ", "clip ", "clip", "cbx", "cb invoice", "cb INVOICE", "cb zzz", "cb image", "cb screenshot", "cb 2026",
    "cb line two", "cb façade", "cb FAÇADE", "cb 😀", "cb needle", "cb padded", "cb https", "cb     invoice   ", "clip json", "cb x", "cb ü", "cb no"]
  for (const t of texts) for (const w of t.toLowerCase().split(/\s+/)) if (w && w.length < 30) out.push("cb " + w, "cb " + Array.from(w).slice(0, 3).join(""))
  return [...new Set(out)]
}

const queries = corpus()
let diffs = 0, total = 0
const action = a => a ? (a.kind === "argv" ? { file: a.target.slice(-2), copyOnly: a.target.includes("--copy-only") }
  : a.kind === "action" ? { file: a.args, copyOnly: a.name === "copy_file" } : { kind: a.kind, target: a.target, label: a.label }) : null
const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon || "", image: r.image || "", score: r.score, copy: r.copy || "", group: r.group || "", run: action(r.run), alt: action(r.alt) })
for (const file of files) {
  Clip.provider.forget()
  const ctx = { load: () => file, now: () => new Date(NOW), omarchyPath: "/usr/share/omarchy", home: "/home/u" }
  const lines = [JSON.stringify({ id: "l", op: "load", ext: "clipboard", key: "history", text: file })]
  const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "clipboard", query, now: NOW }))).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
  queries.forEach((q, id) => {
    total++
    const js = JSON.stringify(Clip.provider.match(q, ctx).map(fields)), rs = JSON.stringify((replies[id].rows || []).map(fields))
    if (js === rs) return
    if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + " over " + file.slice(0, 20) + "\n  js:   " + js.slice(0, 600) + "\n  rust: " + rs.slice(0, 600))
  })
}
console.log((diffs ? "FAIL" : "ok  ") + "  clipboard: JS and Rust agree on " + (total - diffs) + " of " + total + " queries over " + files.length + " history files")
process.exit(diffs ? 1 : 0)
