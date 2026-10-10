// node tests/units-parity.js [punctumd] — the JS units provider and the Rust
// one in punctumd must give the same rows, field for field, for every unit,
// alias and connector across a spread of numbers. Exits 1 on any difference.
// While both exist, this is what keeps them the same.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Engine = load(P + "lib/Engine.js")
const Units = load(P + "extensions/units/provider.js")

function corpus() {
  const aliases = []
  for (const u of Units.UNITS) for (const a of u.slice(3)) aliases.push([u[0], a])
  for (const t of Units.TEMPS) for (const a of t.aliases) aliases.push(["temperature", a])
  const numbers = ["0", "1", "5", "-3.5", "1,234.5", ".25", "-.5", "0.000123", "98.6", "1000000", "123456789012", "0.015625", "7.77777"]
  const connectors = [" to ", " in ", " into ", " as ", " -> ", "→", " = ", "=", " TO "]
  const out = ["", "5", "hello", "5 min", "in 2 weeks", "2+2", "5 ft 11 in", "5'11\"", "6 lb 4 oz to kg", "5 ft 11 in to cm",
               "5 degrees c", "98.6 degree f to c", "5  km   to   mi", "  5 km  ", "5 KM TO MI", "1,00 km", "5 kg to km", "5 c to k to f"]
  for (const [, a] of aliases) for (const n of numbers) { out.push(n + " " + a); out.push(n + a) }
  // Every pair of aliases of one dimension, with one number and a connector each.
  let i = 0
  for (const [d1, a] of aliases) for (const [d2, b] of aliases) {
    if (d1 !== d2 && i++ % 7) continue
    out.push(numbers[i % numbers.length] + " " + a + connectors[i % connectors.length] + b)
  }
  return out
}

function main() {
  const bin = process.argv[2] || P + "target/debug/punctumd"
  const queries = corpus()
  const input = queries.map((q, id) => JSON.stringify({ id, ext: "units", query: q })).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l))
  const ctx = { format: Engine.format, plain: Engine.plain }
  let diffs = 0
  queries.forEach((q, id) => {
    const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon, score: r.score, copy: r.copy })
    const js = Units.provider.match(q, ctx).map(fields)
    const reply = replies[id] || {}
    const rs = reply.rows ? reply.rows.map(fields) : reply.error
    if (JSON.stringify(js) !== JSON.stringify(rs)) {
      if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js) + "\n  rust: " + JSON.stringify(rs))
    }
  })
  const answered = replies.filter(r => r.rows && r.rows.length).length
  console.log((diffs ? "FAIL" : "ok  ") + "  units: JS and Rust agree on " + (queries.length - diffs) + " of " + queries.length + " queries (" + answered + " with answers)")
  process.exit(diffs ? 1 : 0)
}

main()
