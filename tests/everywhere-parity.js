// node tests/everywhere-parity.js [everywhere] — Everywhere's Rust build and
// its Python version (extensions/everywhere/everywhere.py), over a scratch
// home folder of ~2,000 files and its own index (and the system's, where
// there is one). The Python version lets fzf cut the matches to 400 before
// ranking; the Rust one ranks them all. So the check is that the Rust list
// is never worse: at every position its path ranks at least as high as the
// Python one's, by the Python version's own rank(). Both lists are counted
// alike for queries with filters. SHOW=1 lists where Rust ranks higher.
const { spawnSync } = require("child_process")
const fs = require("fs"), os = require("os"), path = require("path")
const P = path.join(__dirname, "..") + "/"
const PY = P + "extensions/everywhere/everywhere.py"
const bin = process.argv[2] || P + "target/debug/everywhere"
if (!fs.existsSync(bin)) { console.log("--    everywhere: untested, no " + bin + " (cargo build)"); process.exit(0) }

// A home whose folder name has none of the searched words' letters in order.
const home = fs.mkdtempSync((process.env.XDG_RUNTIME_DIR || os.tmpdir()) + "/qz-")
const words = ["notes", "report", "budget", "readme", "config", "invoice", "photo", "draft", "backup", "index", "main", "todo", "lib", "download", "hosts"]
const exts = ["md", "txt", "pdf", "png", "rs", "json", "toml", "jpg", ""]
let n = 0
for (let a = 0; a < 12; a++) for (let b = 0; b < 4; b++) {
  const dir = home + "/" + [words[a], "Docs", "src", ".config", "Downloads", "work"][(a + b) % 6] + "/" + words[(a * 3 + b) % words.length] + (b === 3 ? "/.hidden" : "")
  fs.mkdirSync(dir, { recursive: true })
  for (let c = 0; c < 40; c++, n++) {
    const name = (c % 3 ? words[(a + c) % words.length] : words[(b + c) % words.length].toUpperCase()) + (c % 5 ? "-" + c : "") + (exts[c % exts.length] ? "." + exts[c % exts.length] : "")
    fs.writeFileSync(dir + "/" + name, "x".repeat(c * 100))
  }
}
const env = Object.assign({}, process.env, { HOME: home, XDG_CACHE_HOME: home + "/.cache" })
spawnSync(bin, ["--index"], { env })
const queries = ["notes", "nts", "report", "rprt", "readme", "budget pdf", "invoice !backup", "^main", "'todo", "todo$", "config", "photo .png$", "dwnld",
  "hosts", "lib", "index", "main", "draft ext:md", "notes size:>2k", "readme type:file", "ext:pdf", "ext:png,jpg", "report dm:week", "'exact", "zzzz", "dr ft",
  "notes report", "NOTES", "budget-1", "lib.rs", "src main", ".config", "!notes report"]
// The Python version's rank, for both lists.
const rankPy = "import importlib.machinery as m, importlib.util as u, json, sys\nl = m.SourceFileLoader('ew', sys.argv[1]); s = u.spec_from_loader('ew', l); ew = u.module_from_spec(s); l.exec_module(ew)\nreq = json.load(sys.stdin)\nts, f = ew.split_filters(ew.terms(req['q']))\nlits = ew.literals(ts) or ['.' + e for e in (f.get('ext') or [])]\nprint(json.dumps([[ew.rank(p, lits, req['home']) for p in lst] for lst in req['lists']]))"
let worse = 0, better = 0, same = 0
for (const q of queries) {
  const run = cmd => spawnSync(cmd[0], cmd.slice(1).concat(["--limit", "25", "--print0", "--", ...q.split(" ")]), { env, encoding: "utf8", timeout: 20000 }).stdout.split("\0").filter(Boolean)
  const py = run(["python3", PY]), rs = run([bin])
  const [rp, rr] = JSON.parse(spawnSync("python3", ["-I", "-c", rankPy, PY], { input: JSON.stringify({ q, home, lists: [py, rs] }), encoding: "utf8" }).stdout)
  const bad = rp.map((r, i) => i).filter(i => i >= rr.length ? true : rr[i] < rp[i] - 1e-9)
  const up = rr.map((r, i) => i).filter(i => i >= rp.length || rr[i] > rp[i] + 1e-9)
  if (bad.length) { if (worse++ < 8) console.log("FAIL  " + JSON.stringify(q) + " worse at " + bad.slice(0, 5) + "\n  py:   " + py.slice(0, 5).map(p => p.replace(home, "~")).join(" ") + "\n  rust: " + rs.slice(0, 5).map(p => p.replace(home, "~")).join(" ")) }
  else if (up.length) { better++; if (process.env.SHOW) console.log("  + " + JSON.stringify(q) + " higher at " + up.slice(0, 8)) }
  else same++
}
fs.rmSync(home, { recursive: true, force: true })
console.log((worse ? "FAIL" : "ok  ") + "  everywhere: Rust no worse than Python at any position on " + (queries.length - worse) + " of " + queries.length + " queries over " + n
  + " files (" + same + " rank the same throughout; " + better + " where Rust ranks a better match higher)")
process.exit(worse ? 1 : 0)
