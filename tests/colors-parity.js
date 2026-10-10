// node tests/colors-parity.js [punctumd] — wherever the JS colour provider
// answers, the Rust one in punctumd must give the same HEX, RGB and HSL rows
// (and swatch), then its OKLCH row. Where only Rust answers, the query must be
// a CSS colour function or #rgba hex, which it reads on purpose (colors.rs);
// never a word.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Colors = load(P + "extensions/colors/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

function corpus() {
  const out = ["", "decade", "facade", "add", "bad", "cafe", "beef", "deadbeef", "123456", "abcdef", "ABCDEF", "f64", "#f64", "#F64", "#ff66", "#ff664", "#ff66448",
    "#ff664480", "#f648", "red", "tan", "navy", "transparent", "rgb", "rgb()", "rgb(1,2)", "rgba(1,2,3)", "rgb(1 2 3)", "rgb(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)",
    "rgb(300, 0, 0)", "rgb(1000,0,0)", "RGB(10,20,30)", "rgb( 10 , 20 , 30 )", "rgb(10.5, 20, 30)", "rgb(100%, 0%, 0%)", "hsl(11 100% 63%)", "hsl(120, 100%, 25%)",
    "hsla(120, 100%, 25%, 0.5)", "hwb(0 0% 0%)", "lab(50% 40 59.5)", "lch(52.2% 72.2 50)", "oklab(0.628 0.225 0.126)", "oklch(62.8% 0.2577 29.23)", "oklch(nope)",
    " #ff6644 ", "#ff6644 is nice", "color #ff6644", "0x ff6644", "ff6644ff", "#gggggg"]
  // Every 3- and 6-digit hex shape over a spread of digits, with and without #.
  const digits = "0123456789abcdefABCDEF"
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % digits.length
  for (let i = 0; i < 3000; i++) {
    const n = i % 2 ? 6 : 3
    let h = ""
    for (let j = 0; j < n; j++) h += digits[rnd()]
    out.push(h, "#" + h)
  }
  for (let i = 0; i < 1000; i++) out.push("rgb(" + (i * 37 % 300) + ", " + (i * 91 % 256) + ", " + (i * 13 % 256) + ")")
  return out
}

const queries = corpus()
const input = queries.map((query, id) => JSON.stringify({ id, ext: "colors", query })).join("\n") + "\n"
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l))
const fields = r => ({ title: r.title, subtitle: r.subtitle, swatch: r.swatch, score: r.score, copy: r.copy })
let diffs = 0, extra = 0, answered = 0
queries.forEach((q, id) => {
  const js = Colors.provider.match(q, {}).map(fields)
  const rs = (replies[id].rows || []).map(fields)
  if (rs.length) answered++
  let ok
  if (js.length) ok = rs.length === 4 && JSON.stringify(rs.slice(0, 3)) === JSON.stringify(js) && rs[3].subtitle === "OKLCH" && rs[3].swatch === js[0].swatch
  else if (rs.length) { ok = /^\s*((rgba?|hsla?|hwba?|lab|lch|oklab|oklch)\(.*\)|#([0-9a-f]{4}|[0-9a-f]{8}))\s*$/i.test(q); if (ok) extra++ }
  else ok = true
  if (!ok && diffs++ < 12) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js) + "\n  rust: " + JSON.stringify(rs))
})
console.log((diffs ? "FAIL" : "ok  ") + "  colors: JS and Rust agree on " + (queries.length - diffs - extra) + " of " + queries.length + " queries ("
  + answered + " colours; " + extra + " CSS colour functions or alpha hex only Rust reads)")
process.exit(diffs ? 1 : 0)
