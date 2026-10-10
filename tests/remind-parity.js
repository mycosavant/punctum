// node tests/remind-parity.js [punctumd] — the JS reminders provider and the
// Rust one in punctumd, as of the same moments in the same time zones, must
// give the same rows. Each zone runs in its own node (TZ is read at start),
// at moments around its clock changes too.
const { spawnSync } = require("child_process")
const path = require("path")
const P = path.join(__dirname, "..") + "/"
const bin = process.argv[2] || P + "target/debug/punctumd"

if (!process.env.REMIND_ZONE) {
  const zones = ["Asia/Colombo", "America/New_York", "Europe/London", "Australia/Lord_Howe", "UTC", "Pacific/Chatham"]
  let fail = false, lines = []
  for (const zone of zones) {
    const r = spawnSync(process.execPath, [__filename, bin], { env: Object.assign({}, process.env, { TZ: zone, REMIND_ZONE: zone }), encoding: "utf8", maxBuffer: 1 << 26 })
    process.stdout.write(r.stdout.split("\n").filter(l => /^(FAIL|  )/.test(l)).slice(0, 30).map(l => l + "\n").join(""))
    if (r.status !== 0) fail = true
    lines.push(r.stdout.trim().split("\n").pop())
  }
  const sum = lines.map(l => l.match(/(\d+) of (\d+)/)).filter(Boolean).reduce((a, m) => [a[0] + +m[1], a[1] + +m[2]], [0, 0])
  console.log((fail ? "FAIL" : "ok  ") + "  remind: JS and Rust agree on " + sum[0] + " of " + sum[1] + " queries, as of " + zones.length + " zones at 6 moments each (clock changes among them)")
  process.exit(fail ? 1 : 0)
}

const load = require("./loader")
const Rem = load(P + "extensions/remind/provider.js")
const zone = process.env.REMIND_ZONE
// Local wall times: an ordinary afternoon, late evening, just before
// midnight, a Friday morning, and the evenings before spring and autumn
// clock changes in the north and south.
const moments = [[2026, 8, 23, 14, 0, 0], [2026, 8, 23, 23, 58, 30], [2026, 8, 25, 9, 15, 0], [2026, 2, 7, 22, 0, 0], [2026, 9, 31, 21, 0, 0], [2026, 3, 4, 20, 0, 0]]
  .map(([y, mo, d, h, mi, s]) => new Date(y, mo, d, h, mi, s).getTime())

function corpus() {
  const out = ["", "remind", "remind ", "reminder ", "remind me", "remind me ", "!remindme ", "!remind ", "alarm", "alarm ", "wake", "wake me 7am", "alarm clock", "wake on lan", "reminders",
    "remind tea", "remind 10m tea", "remind 10 min tea", "remind 1h30m stretch", "remind 1h 30m stretch", "remind 1 hour and 30 minutes x", "remind 2.5h x", "remind 0.1s x", "remind 90s x",
    "remind 20 tea", "remind 0 tea", "remind 12345 tea", "remind 5", "remind in 5 days pay rent", "remind for 3d x", "remind after 2 hours x", "remind 400d x", "remind 366d x",
    "remind me to call mom at 3pm", "remind me that the oven is on in 20m", "remind about the game at 7", "remind at 7 call", "remind at 12 lunch", "remind at 0 x", "remind 7:30 x",
    "remind 24:00 x", "remind 13pm x", "remind 0am x", "remind 12am x", "remind 12pm x", "remind 9 a.m. x", "remind 9 p.m. x", "remind 9a.m x", "remind 9pm x",
    "remind tomorrow 9am dentist", "remind tonight 8 x", "remind tonight 8pm x", "remind today 9am x", "remind today 11pm x", "remind noon x", "remind midnight x",
    "remind friday noon lunch", "remind fri 9am x", "remind thursday 3pm x", "remind thurs 3pm x", "remind tues 3pm x", "remind sat midnight x", "remind sunday x at 5",
    "remind 9am friday x", "remind buy 2 eggs at 5pm", "remind a 3d printer at 5pm", "remind call 555 1234", "remind 3 things", "remind me to", "remind me at", "remind x in",
    "alarm 6:45", "alarm tomorrow 7am", "alarm at 6", "alarm 6", "alarm in 8h", "alarm for 30m", "wake me at 7", "wake 7:00", "alarm today 6am", "alarm noon",
    "remind 2am x", "remind 2:30am x", "remind 1:30am x", "remind tomorrow 2:30am x", "remind tomorrow 1:30am x", "remind sunday 2:30 x", "remind 3am x", "remind tomorrow 3am",
    "REMIND 10M TEA", "remind   10m    tea  ", "remind 10m\ttea", "remind 10m tea\u0007", "remind 10m 😀 party", "remind 10mtea", "remind 10m and 5s x", "remind 1d2h x", "remind 1h30 x"]
  return [...new Set(out)]
}

const queries = corpus()
const action = a => !a ? null : a.kind === "argv" ? { args: a.target.slice(1), input: a.input === undefined ? null : a.input }
  : { args: { remind_in: ["--in"], remind_at: ["--at"], alarm_in: ["--in"], alarm_at: ["--at"], cancel: ["--cancel"] }[a.name].concat(a.args).concat(/^alarm/.test(a.name) ? ["--alarm"] : []), input: a.input === undefined ? null : a.input }
const fields = r => ({ title: r.title, subtitle: r.subtitle, score: r.score, copy: r.copy || "", run: action(r.run), alt: action(r.alt) })
const list = JSON.stringify({ reminders: [{ timer: "omarchy-reminder-1-abc.timer", label: "Tea", atTime: "14:10", remaining: "9m", message: "tea" },
  { timer: "bad; rm", label: "x" }, null, { timer: "omarchy-reminder-2.timer", atTime: "", remaining: 5 }] })
let diffs = 0, total = 0
for (const now of moments) {
  const ctx = { now: () => new Date(now), dir: "/x", load: () => list }
  const lines = [JSON.stringify({ id: "l", op: "load", ext: "remind", key: "list", text: list })]
  const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "remind", query, now, local_zone: zone }))).join("\n") + "\n"
  const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 26 })
  if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
  const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
  queries.forEach((q, id) => {
    total++
    const js = JSON.stringify(Rem.provider.match(q, ctx).map(fields)), rs = JSON.stringify((replies[id].rows || []).map(fields))
    if (js === rs) return
    if (diffs++ < 10) console.log("FAIL  " + zone + " " + new Date(now).toString().slice(0, 24) + " " + JSON.stringify(q) + "\n  js:   " + js.slice(0, 400) + "\n  rust: " + rs.slice(0, 400))
  })
}
console.log((diffs ? "FAIL" : "ok  ") + "  remind " + zone + ": " + (total - diffs) + " of " + total)
process.exit(diffs ? 1 : 0)
