// node tests/time-parity.js [punctumd] — the JS time provider and the Rust one
// in punctumd must give the same rows for zones, conversions and dates, in a
// few places and moments. The JS gets its zone offsets the way the bar gives
// them, from `date` at that moment. Where Rust answers and the JS couldn't (a
// zone the bar never probed), that's counted as Rust's, not a difference.
// Differences on purpose are left out of the corpus and pinned in time.rs's
// tests: offsets at the converted moment, month ends, years before 100.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Engine = load(P + "lib/Engine.js")
const Tz = load(P + "lib/tzcities.js")
const Time = load(P + "extensions/time/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const SCENARIOS = [
  { local: "Asia/Colombo", at: [2026, 8, 23, 14, 0], settings: { home: "Asia/Colombo" } },
  { local: "America/Chicago", at: [2026, 6, 4, 9, 15], settings: {} },
  { local: "Europe/London", at: [2026, 11, 31, 23, 50], settings: { home: "Asia/Tokyo", clock24: false, zones: ["Europe/London", "Pacific/Auckland"] } },
]

function corpus() {
  const out = ["time", "now", "clock", "times", "time in here", "time in home", "time in asia/tokyo", "time in reykjavik", "hello", "", "tokyo", "time in"]
  const keys = Object.keys(Tz.CITIES)
  for (const k of keys) out.push("time in " + k, k + " time", "what's the time in " + k + "?")
  const hours = ["3pm", "9am", "11pm", "12am", "12pm", "0:00", "23:59", "15:30", "7.45", "13pm", "24:00", "9", "9:5 pm", "1:61"]
  const conn = [" to ", " in ", " -> ", " => "]
  keys.forEach((k, i) => {
    if (i % 3) return
    const h = hours[i % hours.length], c = conn[i % conn.length]
    out.push(h + c + k, h + " lkt" + c + k, h + " " + keys[(i * 7) % keys.length] + c + k, h + " here" + c + k)
  })
  const dates = ["today", "tomorrow", "yesterday", "christmas", "xmas", "new year", "new years", "new year's", "dec 25", "december 25th", "25 dec",
    "25th december 2027", "jan 1, 2027", "jan. 1", "2026-01-01", "2026-2-28", "2027-12-31", "feb 29", "feb 30", "sept 3", "sep 3rd", "mar 3", "marble 3",
    "friday", "next friday", "last friday", "this mon", "coming sun", "fri", "next tue", "last sat", "wednesday", "nov 5", "5 nov 2025", "2028-02-29"]
  const safe = ["today", "tomorrow", "dec 25", "jan 1, 2027", "2026-01-01", "next friday", "nov 5", "mar 3"]   // days ≤ 28: month sums agree
  for (const d of dates) out.push(d, "days until " + d, "until " + d, "how many days until " + d + "?", "days since " + d, "since " + d, "days before " + d)
  for (const d of safe) for (const u of ["days", "d", "weeks", "wk", "months", "mo", "years", "y", "fortnights"]) out.push(d + " + 45 " + u, d + " - 2 " + u, d + "+3" + u)
  for (const u of ["days", "day", "d", "weeks", "w", "months", "m", "years", "yrs", "hours"]) out.push("in 3 " + u, "in 3" + u, "3 " + u + " from now", "3 " + u + " later", "10 " + u + " ago")
  dates.forEach((a, i) => { const b = dates[(i * 5 + 3) % dates.length]; out.push(a + " to " + b, "between " + a + " and " + b, "from " + a + " until " + b, "days " + a + " - " + b) })
  return out
}

function zonesAt(epoch, extra, local) {
  const list = Tz.allZones(extra).concat([local])
  const r = spawnSync("bash", ["-c", "for z in \"$@\"; do printf '%s ' \"$z\"; TZ=\"$z\" date -d @" + Math.floor(epoch / 1000) + " +'%z %Z'; done", "_"].concat(list), { encoding: "utf8" })
  const zones = {}
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(\S+) ([+-])(\d\d)(\d\d) (\S+)$/)
    if (m) zones[m[1]] = { offset: (m[2] === "-" ? -1 : 1) * (parseInt(m[3], 10) * 60 + parseInt(m[4], 10)), abbr: m[5] }
  }
  return zones
}

const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon || "", score: r.score, copy: r.copy })
const queries = corpus()
let diffs = 0, total = 0, rustOnly = 0, answered = 0, skipped = 0
// Month and year sums from a day the target month may not have: Rust ends on
// the month's last day, the JS rolls over (see time.rs).
const MONTHLY = /\b(months?|mos?|m|years?|yrs?|y)\b|\d(months?|mos?|m|years?|yrs?|y)\b/
for (const s of SCENARIOS) {
  process.env.TZ = s.local
  const nowDate = new Date(s.at[0], s.at[1], s.at[2], s.at[3], s.at[4])
  const settings = Object.assign({ zones: ["UTC", "America/New_York", "Europe/London"], clock24: true }, s.settings)
  const ctx = { settings, zones: zonesAt(nowDate.getTime(), (settings.zones || []).concat(settings.home ? [settings.home] : []), s.local),
                localZone: s.local, now: () => new Date(nowDate.getTime()), format: Engine.format, plain: Engine.plain }
  const input = queries.map((query, id) => JSON.stringify({ id, ext: "time", query, settings, now: nowDate.getTime(), local_zone: s.local })).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l))
  queries.forEach((q, id) => {
    if (s.at[2] > 28 && MONTHLY.test(q)) { skipped++; return }
    total++
    const js = Time.provider.match(q, ctx).map(fields)
    const rs = replies[id].rows ? replies[id].rows.map(fields) : replies[id].error
    if (Array.isArray(rs) && rs.length) answered++
    if (JSON.stringify(js) === JSON.stringify(rs)) return
    const jsNone = js.length === 0 || (js.length === 1 && /^Looking up time zones/.test(js[0].title))
    if (jsNone && Array.isArray(rs) && rs.length) { rustOnly++; return }
    if (diffs++ < 12) console.log("FAIL  " + s.local + " " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js) + "\n  rust: " + JSON.stringify(rs))
  })
}
console.log((diffs ? "FAIL" : "ok  ") + "  time: JS and Rust agree on " + (total - diffs - rustOnly) + " of " + total + " queries in " + SCENARIOS.length
  + " places (" + answered + " with answers; " + rustOnly + " only Rust answers, from zones the bar never probed; "
  + skipped + " month sums from the 29th on left out, as they differ on purpose)")
process.exit(diffs ? 1 : 0)
