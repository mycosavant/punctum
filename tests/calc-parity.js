// node tests/calc-parity.js [punctumd] — the JS calculator (lib/Calc.js,
// extensions/math) and the Rust one in punctumd must give the same answer to
// every query here, generated and hand-written: same title, copy, subtitle
// and score. Where the JS gives none, Rust may answer through fend: a plain
// number, ranked below the parser's answers, marked "· fend". SHOW=1 lists
// those.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Math_ = load(P + "extensions/math/provider.js")
const Engine = load(P + "lib/Engine.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const hand = ["12*8 + 15%", "sqrt(2) * pi", "15% of 200", "5!", "-2^2", "2^3^2", "3x4", "3 x 4", "3X(4)", "2pi", "pi", "π", "Π*2", "e", "tau", "1,000 * 2",
  "1,000,000/3", "max(1,2,3)", "min(1, 2)", "max(1,000, 5)", "10 % 3", "10%", "50 + 10%", "50 - 10%", "50 * 10%", "7 mod -3", "-7 mod 3", "2 ** 10 =", "2 ** 10=  ",
  "1/0", "-1/0", "0/0", "1e3", "1e-3 * 5", "1.5e+3+1", "1.e5", ".5+.5", "1..2", "1.2.3", "1_000_000 + 1", "1__0", "100!", "171!", "170!", "-3!", "3.5!", "(1+2)*3",
  "((2))", "(1+2", "1+2)", "2(3)", "(2)(3)", "sin(2)", "cos(pi)", "tan(1)", "asin(1)", "acos(0.5)", "atan(1)*4", "exp(1)", "ln(10)", "log(1000)", "log2(8)",
  "log(2)", "cbrt(27)", "cbrt(-8)", "abs(-3.2)", "round(2.5)", "round(-2.5)", "round(-0.4)", "floor(-1.5)", "ceil(1.2)", "sqrt(-1)", "0.1+0.2", "0.1*3",
  "1/3", "2/3*3", "10/3", "123456789*987654321", "2^53+1", "2^1023*2", "2^-1074", "1e308*10", "-0", "-(0)", "0*-1", "5 min", "min(5)", "5 km to mi",
  "hello", "42", "  42  ", "4 2", "2 2", "+5", "--5", "-+-5", "5-", "*5", "5*", "", " ", "=", "2+2=", "2+2 = ", "2÷4", "3×3", "5−2", "2^0.5", "(-8)^(1/3)",
  "0xff + 1", "255 to hex", "0b101 * 2", "2^200", "1/3 to fraction", "sqrt(-4)", "9^9^9", "10 choose 3", "5 km", "100 usd to eur", "today + 3 days", "1 + ",
  "sin(90°)", "3 dozen", "50 % of 3", "of 5", "5 of", "x4", "4x", "4 x", "4 xy", "2e", "2e+", "e2", "2 e 2", "mod 5", "5 mod", "log", "log()", "max()", "max(,1)"]
function* generated() {
  const nums = ["0", "1", "2", "7", "0.5", "1.25", "10", "99", "1000", "3.14159", "1e3", "2.5e-4"], ops = ["+", "-", "*", "/", "^", "%", " mod ", " of ", ""]
  for (const a of nums) for (const o of ops) for (const b of nums) yield a + o + b
  for (const f of ["sqrt", "sin", "cos", "tan", "ln", "log", "log2", "exp", "abs", "round", "floor", "ceil", "cbrt", "asin", "acos", "atan"])
    for (const a of nums.concat(["-1", "-0.5", "pi", "e", "2pi"])) yield f + "(" + a + ")"
  for (let i = 0; i < 400; i++) { // a fixed pseudo-random mix
    let s = "", seed = i * 2654435761 % 4294967296
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let k = 0, len = 2 + rnd(4); k < len; k++) s += (k ? ops[rnd(6)] : "") + (rnd(5) === 0 ? "(" + nums[rnd(nums.length)] + "+" + nums[rnd(nums.length)] + ")" : nums[rnd(nums.length)]) + (rnd(9) === 0 ? "%" : rnd(13) === 0 ? "!" : "")
    yield s
  }
}
const queries = [...new Set(hand.concat([...generated()]))]
const settingsList = [{ precision: 10 }, { precision: 4 }, { precision: 0 }, { precision: 150 }, {}]
const ctx = settings => ({ settings, format: Engine.format, plain: Engine.plain })
const fields = r => ({ title: r.title, subtitle: r.subtitle, score: r.score, copy: r.copy })
let diffs = 0, fend = 0, total = 0, answered = 0
for (const settings of settingsList) {
  const input = queries.map((query, id) => JSON.stringify({ id, ext: "math", query, settings })).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 26 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l))
  queries.forEach((q, id) => {
    total++
    let js
    try { js = Math_.provider.match(q, ctx(settings)).map(fields) } catch (e) { js = [] }   // RangeError: no answer
    const rs = (replies[id].rows || []).map(fields)
    if (js.length) answered++
    if (JSON.stringify(js) === JSON.stringify(rs)) return
    if (!js.length && rs.length === 1 && / · fend$/.test(rs[0].subtitle) && rs[0].score === 70) { fend++; if (process.env.SHOW && settings.precision === 10) console.log("  + " + JSON.stringify(q) + " → " + rs[0].title.slice(0, 80)); return }
    if (diffs++ < 15) console.log("FAIL  " + JSON.stringify(q) + " " + JSON.stringify(settings) + "\n  js:   " + JSON.stringify(js) + "\n  rust: " + JSON.stringify(rs))
  })
}
console.log((diffs ? "FAIL" : "ok  ") + "  calc: JS and Rust agree on " + (total - diffs - fend) + " of " + total + " queries (" + queries.length + " under " + settingsList.length
  + " precision settings; " + answered + " answered; " + fend + " only fend answers)")
process.exit(diffs ? 1 : 0)
