// node tests/processes-parity.js [punctumd] — the JS processes provider and
// the Rust one in punctumd, given the same ps output (this machine's, plus
// made-up lines), must give the same rows. Rust may add processes whose name
// has the typed letters in order, after the rest; they can replace the JS's
// "No process matches" row. SHOW=1 lists those.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Proc = load(P + "extensions/processes/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const ps = spawnSync("ps", ["-u", String(process.getuid()), "--no-headers", "-o", "pid=,rss=,pcpu=,comm:40=,args="], { encoding: "utf8" }).stdout || ""
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n)
const made = [[4242, 2000000, "12.5", "chrome", "/opt/chrome --type=renderer"], [4243, 300000, "3.0", "chrome", "/opt/chrome"], [4244, 1310720, "0.0", "tie", "exact 1.25 GB"],
  [4245, 1048000, "99.9", "Éditeur", "éditeur"], [4246, 10, "0.0", "with space", "a b c"], [4247, 1, "0.0", "ps", "ps x"]]
  .map(([pid, rss, cpu, name, args]) => String(pid).padStart(7) + " " + String(rss).padStart(8) + " " + cpu.padStart(4) + " " + pad(name, 40) + " " + args)
const text = ps + made.join("\n") + "\n"
// Punctum.qml's parse, for the JS provider.
const processes = text.split("\n").map(l => l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+) (.{40}) (.*)$/)).filter(m => m && m[4].trim() !== "ps")
  .map(m => ({ pid: parseInt(m[1], 10), rss: parseInt(m[2], 10), cpu: parseFloat(m[3]), name: m[4].trim(), args: m[5] }))

const names = [...new Set(processes.map(p => p.name.toLowerCase()))]
const queries = ["kill", "kill ", "KILL ", "kill -9 ", "kill --force chrome", "kill -KILL x", "killer", "kill zzzqqq", "kill chrm", "kill  chrome ", "kill 1.25", "kill éditeur", "kill with space"]
for (const n of names) queries.push("kill " + n, "kill " + n.slice(0, 3), "kill -9 " + n, "kill " + n.replace(/[aeiou]/g, ""))
const uniq = [...new Set(queries)]

const lines = [JSON.stringify({ id: "l", op: "load", ext: "processes", key: "ps", text })].concat(uniq.map((query, id) => JSON.stringify({ id, ext: "processes", query })))
const run = spawnSync(bin, [], { input: lines.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 26 })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(1)
// "kill -TERM 1 2" (the JS's shell command) and the "quit" action with ["1", "2"] are the same.
const action = a => !a ? null : a.kind === "run" ? { force: /-KILL/.test(a.target), pids: a.target.split(" ").slice(2) } : { force: a.name === "force_quit", pids: a.args }
const fields = r => ({ title: r.title, subtitle: r.subtitle, score: r.score, copy: r.copy || "", run: action(r.run) })
let diffs = 0, extra = 0
uniq.forEach((q, id) => {
  const js = Proc.provider.match(q, { processes, requestProcesses: () => {} }).map(fields)
  const rs = (replies[id].rows || []).map(fields)
  const none = js.length === 1 && /^No process matches/.test(js[0].title)
  const base = none && rs.length && rs[0].run ? [] : js
  const head = JSON.stringify(rs.slice(0, base.length)) === JSON.stringify(base)
  const tail = rs.slice(base.length)
  if (head && tail.every(r => r.run)) { if (tail.length) { extra++; if (process.env.SHOW) console.log("  + " + JSON.stringify(q) + " → " + tail.map(r => r.title).join(" | ")) } return }
  if (diffs++ < 8) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js.slice(0, 3)) + "\n  rust: " + JSON.stringify(rs.slice(0, 3)))
})
console.log((diffs ? "FAIL" : "ok  ") + "  processes: JS and Rust agree on " + (uniq.length - diffs) + " of " + uniq.length + " queries over " + processes.length
  + " processes (in " + extra + " Rust adds names with the letters in order, after the rest)")
process.exit(diffs ? 1 : 0)
