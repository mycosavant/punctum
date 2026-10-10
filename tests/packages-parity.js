// node tests/packages-parity.js [punctumd] — the JS packages provider and the
// Rust one in punctumd, given the same expac output, must give the same rows
// in the same order. It uses this machine's package list when expac is
// installed, and a small made-up one otherwise.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Pkg = load(P + "extensions/packages/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const made = ["Q\tkfind\t25.08-1", "Q\tplocate\t1.1.24-1", "Q\tbash\t5.3-1",
  "S\textra\tkfind\t25.08-1\tx86_64\tFind files", "S\textra\tplocate\t1.1.25-1\tx86_64\tAlternative to locate, faster",
  "S\tomarchy\tomarchy-thing\t1-1\tany\tOmarchy's own", "S\textra\t$(touch x)\t1\tany\tevil name", "S\tcore\tbash\t5.3-1\tx86_64\tThe GNU Bourne Again shell",
  "S\tcore\tbash-completion\t2.16-1\tany\tProgrammable completion for the bash shell", "S\textra\tlib32-foo\t1\tweird arch!\tdesc\twith\ttabs",
  "S\tmultilib\tlib32-glibc\t2.42-1\tx86_64\tGNU C Library (32-bit)", "S\textra-testing\tg++-thing\t1\tx86_64\t", "S\tcore-debug\tgcc-debug\t15-1\tx86_64\tDetached debugging symbols",
  "S\textra\tc++utilities\t5.1-1\tx86_64\tUseful C++ classes", "S\textra\tpython-a\t1\tany\tA", "S\textra\tpython-b\t1\tany\tA", "short", ""].join("\n")
const expac = spawnSync("bash", ["-c", "expac -Q 'Q\\t%n\\t%v' && expac -S 'S\\t%r\\t%n\\t%v\\t%a\\t%d'"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const real = expac.status === 0 && expac.stdout.length > 1000
const text = real ? expac.stdout + made : made

function corpus() {
  const out = ["", "pkg", "pkg ", "pkg  ", "PKG ", "pacman ", "pkgx", "pkg zzzzzz", "pkg kfind", "pkg file search", "pkg bash", "pkg BASH", "pkg bash completion",
    "pkg c++", "pkg lib32", "pkg gnu c", "pkg python", "pkg locate", "pkg omarchy", "pkg   kfind   ", "pkg evil", "pkg debug", "pkg g++", "pkg a"]
  const words = new Set()
  for (const line of text.split("\n").slice(0, 4000)) for (const w of line.toLowerCase().split(/[\s\t]+/)) if (/^[a-z][a-z0-9+-]{2,}$/.test(w)) words.add(w)
  let i = 0
  for (const w of words) { if (i++ % 7) continue; out.push("pkg " + w, "pkg " + w.slice(0, 3)) }
  return [...new Set(out)]
}

const queries = corpus()
let diffs = 0, total = 0
const action = a => !a ? null : a.kind === "argv" ? { terminal: a.target[a.target.length - 1], script: a.target[8], label: a.label }
  : a.kind === "action" ? { terminal: a.args[a.args.length - 1], script: { details: "pacman -Qi -- \"$1\"; omarchy-show-done", repo_details: "pacman -Si -- \"$1\"; omarchy-show-done", install: "sudo pacman -S -- \"$1\"; s=$?; [ \"$s\" = 130 ] || omarchy-show-done" }[a.name], label: { details: "details", repo_details: "details", install: "install" }[a.name] }
  : { kind: a.kind, target: a.target, label: a.label }
const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon || "", score: r.score, copy: r.copy || "", run: action(r.run), alt: action(r.alt) })
for (const settings of [{ install: false }, { install: true }]) {
  Pkg.provider.forget()
  const ctx = { load: () => text, settings }
  const lines = [JSON.stringify({ id: "l", op: "load", ext: "packages", key: "list", text })]
  const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "packages", query, settings }))).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
  queries.forEach((q, id) => {
    total++
    const js = JSON.stringify(Pkg.provider.match(q, ctx).map(fields)), rs = JSON.stringify((replies[id].rows || []).map(fields))
    if (js === rs) return
    if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + js.slice(0, 600) + "\n  rust: " + rs.slice(0, 600))
  })
}
console.log((diffs ? "FAIL" : "ok  ") + "  packages: JS and Rust agree on " + (total - diffs) + " of " + total + " queries over " + text.split("\n").length + " lines of expac output" + (real ? " (this machine's)" : " (made up; no expac)"))
process.exit(diffs ? 1 : 0)
