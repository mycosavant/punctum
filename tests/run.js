// node tests/run.js — exercises every provider against mocked rates, zones and clock.
const load = require("./loader")
const P = require("path").join(__dirname, "..") + "/"
const Engine = load(P + "lib/Engine.js")
const Ext = load(P + "lib/Extensions.js")
const Extensions = require("./extensions")
const loaded = Extensions.install(Engine, Ext, Extensions.discover([{ dir: P + "extensions" }]))
// The defaults every provider sees: the bar's own plus each manifest's.
const defaults = Ext.effectiveConfig(Engine.parseJsonc(require("fs").readFileSync(P + "config.default.json", "utf8")), loaded.manifests, {})
// Most cases run as a Sri Lanka user; the neutral defaults are checked separately below.
const config = Engine.deepMerge(defaults, { currency: { home: "LKR", favorites: ["USD", "EUR", "INR"] }, time: { home: "Asia/Colombo" } })
const rates = { rates: { USD: 1, LKR: 300.5, EUR: 0.9, INR: 83.2, GBP: 0.78, JPY: 150 }, updated: 1790000000, stale: false }
const zones = { "Asia/Colombo": { offset: 330, abbr: "+0530" }, "UTC": { offset: 0, abbr: "UTC" }, "America/New_York": { offset: -240, abbr: "EDT" }, "Europe/London": { offset: 60, abbr: "BST" }, "America/Los_Angeles": { offset: -420, abbr: "PDT" }, "Asia/Tokyo": { offset: 540, abbr: "JST" } }
const now = () => new Date(2026, 8, 23, 14, 0)   // 23 Sep 2026 14:00 local
let fails = 0
const emojis = JSON.parse(require("fs").readFileSync("/usr/share/omarchy/shell/plugins/emojis/emojis.json", "utf8"))
const processes = [
  { pid: 101, rss: 400000, cpu: 12.5, name: "chrome", args: "/opt/google/chrome/chrome" },
  { pid: 102, rss: 200000, cpu: 3.0, name: "chrome", args: "/opt/google/chrome/chrome --type=renderer" },
  { pid: 103, rss: 50000, cpu: 0.1, name: "Web Content", args: "/usr/lib/firefox/firefox -contentproc" },
  { pid: 104, rss: 90000, cpu: 20.0, name: "node", args: "node server.js" }
]
const app = (id, name, generic, actions, keywords) => ({ id, name, generic: generic || "", comment: "", keywords: keywords || [], icon: id, actions: (actions || []).map((n, i) => ({ index: i, name: n })) })
const apps = [
  app("brave-browser", "Brave", "Web Browser", ["New Window", "New Private Window"]),
  app("firefox", "Firefox", "Web Browser", ["New Window", "New Private Window"]),
  app("org.gnome.Nautilus", "Files", "File Manager", [], ["folder", "explorer"]),
  app("Alacritty", "Alacritty", "Terminal", [], ["shell", "prompt"]),
  app("code", "Visual Studio Code", "Text Editor", ["New Empty Window"]),
  app("org.localsend.localsend_app", "LocalSend", "File Sharing"),
  app("signal", "Signal", "Messenger")
]
let launches = { "firefox": 12 }
const windows = [
  { address: "0xa1", cls: "firefox", title: "Mozilla Firefox", workspace: "2", focus: 0 },          // the one you're in: never listed
  { address: "0xb1", cls: "brave-browser", title: "Netflix - Brave", workspace: "1", focus: 1 },
  { address: "0xb2", cls: "brave-browser", title: "GitHub - Brave", workspace: "3", focus: 3 },
  { address: "0xc1", cls: "org.gnome.Nautilus", title: "Images", workspace: "5", focus: 2 },
  { address: "0xd1", cls: "com.mitchellh.ghostty", title: "~/Code", workspace: "special:scratch", focus: 4 },
  { address: "$(rm -rf ~)", cls: "evil", title: "Evil window", workspace: "1", focus: 5 }
]
let requested = 0
let openWindows = []   // the app tests run with nothing open; the window tests switch these on
function q(query) { return Engine.run(query, config, { rates, zones, now, ratesStatus: "", emojis, processes, apps, windows: openWindows, launches, requestProcesses: () => requested++ }) }
function expect(query, want) {
  const rows = q(query)
  const top = rows[0] ? rows[0].title : "(none)"
  const ok = want === null ? rows.length === 0 : (want instanceof RegExp ? want.test(top) : top === want)
  if (!ok) fails++
  console.log((ok ? "ok  " : "FAIL") + "  " + JSON.stringify(query).padEnd(30) + " → " + top + (rows[0] ? "  | " + rows[0].subtitle : "") + (ok ? "" : "   (want " + want + ")"))
}
expect("2+3*4", "14"); expect("2^10", "1,024"); expect("15% of 200", "30"); expect("200+10%", "220"); expect("200 - 15%", "170")
expect("sqrt(16)", "4"); expect("2pi", "6.283185307"); expect("3(4+1)", "15"); expect("3x4", "12"); expect("10 % 3", "1"); expect("10 mod 4", "2")
expect("0.1+0.2", "0.3"); expect("1,000 * 3", "3,000"); expect("max(1,5,3)", "5"); expect("-2^2", "-4"); expect("5!", "120"); expect("1/0", "∞"); expect("2e3+1", "2,001")
expect("hello", null); expect("42", null); expect("(1+2", null); expect("", null)
expect("100 usd to lkr", "30,050 LKR"); expect("100usd in eur", "90 EUR"); expect("$50", "15,025 LKR"); expect("€20 to inr", /^1,848\.89 INR$/)
expect("50 eur", /LKR$/); expect("usd lkr", "300.5 LKR"); expect("usd to lkr", "300.5 LKR"); expect("12*50 usd", "180,300 LKR"); expect("1 lkr", /USD$/); expect("usd", null)
expect("time", /Colombo/); expect("time in tokyo", /Tokyo/); expect("tokyo time", /Tokyo/); expect("3pm lkt to pst", "02:30 Los Angeles"); expect("15:30 in london", "11:00 London")
expect("9am to tokyo", "12:30 Tokyo"); expect("11pm to tokyo", "02:30 Tokyo (+1 day)")
expect("days until dec 25", /^93 days/); expect("today + 45 days", "Sat, 7 Nov 2026"); expect("2026-01-01 to 2026-09-23", /^265 days/); expect("next friday", "Fri, 25 Sep 2026")
expect("days since jan 1", /^265 days/); expect("in 2 weeks", "Wed, 7 Oct 2026"); expect("until christmas", /^93 days/); expect("dec 25", "Fri, 25 Dec 2026")
expect("g foo bar", "Search Google: foo bar"); expect("g", "Search Google…"); expect("lock", "Lock screen"); expect("lo", "Lock screen")
// emoji
expect(":fire", /fire/); expect("emoji thumbs up", /thumbs up/); expect(":", "Type a word after the colon"); expect(":zzqx", null)
{ const r = q(":fire")[0]; const ok = r.icon === "🔥" && r.copy === "🔥" && r.run.target === "omarchy-menu-emoji-insert '🔥'; printf %s '🔥' | wl-copy"
  console.log((ok ? "ok  " : "FAIL") + "  :fire row → " + r.icon + " " + r.run.target); if (!ok) fails++ }
{ const r = Engine.run(":fire", { providers: ["emoji"], emoji: { onEnter: "copy" } }, { emojis })[0]; const ok = !r.run && r.copy === "🔥"
  console.log((ok ? "ok  " : "FAIL") + "  emoji onEnter=copy → no run, copies " + r.copy); if (!ok) fails++ }
// processes
expect("kill", "Quit node"); expect("kill chrome", "Quit all 2 \"chrome\" processes"); expect("kill web", "Quit Web Content"); expect("kill zzz", /^No process/)
expect("kill -9 node", "Force quit node"); expect("killer", null)
{ const rows = q("kill chrome"); const ok = rows[0].run.target === "kill -TERM 101 102" && rows[1].run.target === "kill -TERM 101" && q("kill -9 node")[0].run.target === "kill -KILL 104" && requested > 0
  console.log((ok ? "ok  " : "FAIL") + "  kill targets → " + rows[0].run.target + " | " + q("kill -9 node")[0].run.target + " | requested " + requested); if (!ok) fails++ }
{ const r = Engine.run("kill x", { providers: ["processes"] }, { requestProcesses: () => {} })[0]; const ok = r.title === "Reading your processes…" && !r.run
  console.log((ok ? "ok  " : "FAIL") + "  kill before snapshot → " + r.title); if (!ok) fails++ }
// Every kill target must be exactly "kill -SIG <digits…>" — nothing from args/names reaches the shell.
{ const all = ["kill", "kill chrome", "kill web", "kill -9 chrome"].flatMap(x => q(x)).filter(r => r.run)
  const ok = all.every(r => /^kill -(TERM|KILL)( \d+)+$/.test(r.run.target))
  console.log((ok ? "ok  " : "FAIL") + "  " + all.length + " kill targets are pid-only"); if (!ok) fails++ }

// apps
expect("brave", "Brave"); expect("firefox", "Firefox"); expect("fire", "Firefox"); expect("files", "Files"); expect("nautilus", "Files")
expect("term", "Alacritty"); expect("vsc", "Visual Studio Code"); expect("studio code", "Visual Studio Code"); expect("local", "LocalSend")
expect("brave new window", "New Window"); expect("firefox priv", "New Private Window"); expect("zzzq", null)
{ const rows = q("brave"); const ok = rows[0].run.kind === "app" && rows[0].run.target === "brave-browser" && rows[0].run.action === undefined
    && rows[1].title === "New Window" && rows[1].run.action === 0 && rows[2].title === "New Private Window" && rows[0].image === "brave-browser"
  console.log((ok ? "ok  " : "FAIL") + "  \"brave\" → app, then its window actions → " + rows.slice(0, 3).map(r => r.title).join(" | ")); if (!ok) fails++ }
// The point of the launcher: an app query never offers to change a default.
{ const all = ["brave", "browser", "default", "firefox", "term"].flatMap(x => q(x))
  const ok = all.every(r => !/default/i.test(r.title + " " + (r.run ? r.run.target : "")))
  console.log((ok ? "ok  " : "FAIL") + "  no default-changing rows among " + all.length + " app results"); if (!ok) fails++ }
{ const f = q("f").map(r => r.title); const ok = f[0] === "Firefox" && f.includes("Files")
  console.log((ok ? "ok  " : "FAIL") + "  launch history orders equal matches → " + f.slice(0, 3).join(" | ")); if (!ok) fails++ }
{ const ok = q("web browser").map(r => r.title).slice(0, 2).sort().join() === "Brave,Firefox" && q("2+2").length === 1 && q("100 usd to lkr")[0].title === "30,050 LKR"
  console.log((ok ? "ok  " : "FAIL") + "  generic-name search, and apps stay out of answers"); if (!ok) fails++ }

// units
expect("5 km to mi", "3.1069 mi"); expect("5km in miles", "3.1069 mi"); expect("180 lb to kg", "81.6466 kg"); expect("72f", "22.2222 °C"); expect("100 c to f", "212 °F")
expect("0 k to c", "-273.15 °C"); expect("5 ft 11 in to cm", "180.34 cm"); expect("5 in to cm", "12.7 cm"); expect("2 cups in ml", "473.1765 mL"); expect("90 min to hours", "1.5 h")
expect("10 gb to mb", "10,000 MB"); expect("1 gib in mb", "1,073.7418 MB"); expect("60 mph", "96.5606 km/h"); expect("1,500 m to km", "1.5 km"); expect("1 acre to m2", "4,046.8564 m²")
expect("5 min", null); expect("5 kg to km", null); expect("convert units", "Convert units")
{ const r = q("5 km"); const ok = r[0].title === "3.1069 mi" && r[0].copy === "3.1069" && /5 km → mi · Length/.test(r[0].subtitle)
  console.log((ok ? "ok  " : "FAIL") + "  \"5 km\" → counterpart, copies the bare number"); if (!ok) fails++ }
{ const ok = q("in 2 weeks")[0].title === "Wed, 7 Oct 2026" && q("3pm lkt to pst")[0].title === "02:30 Los Angeles" && q("2026-01-01 to 2026-09-23")[0].provider === "time" && q("2+2")[0].title === "4"
  console.log((ok ? "ok  " : "FAIL") + "  units leave dates, times and maths alone"); if (!ok) fails++ }

// windows
openWindows = windows
{ const r = q("brave"); const t = r.slice(0, 4).map(x => x.title + "/" + (x.run ? x.run.kind + ":" + (x.run.label || "") : ""))
  const ok = r[0].run.kind === "window" && r[0].run.target === "0xb1" && r[1].run.target === "0xb2" && r[2].run.kind === "app" && r[2].run.label === "open new" && r[0].image === "brave-browser"
  console.log((ok ? "ok  " : "FAIL") + "  \"brave\" → its windows by recency, then open new → " + t.join(" | ")); if (!ok) fails++ }
expect("netflix", "Netflix - Brave"); expect("images", "Images"); expect("nautilus", "Images"); expect("ghostty", "~/Code")
{ const r = q("w "); const ok = r.map(x => x.run && x.run.target).join() === "0xb1,0xc1,0xb2,0xd1" && r[3].subtitle === "Ghostty · scratchpad"
  console.log((ok ? "ok  " : "FAIL") + "  \"w \" → every other window, most recent first → " + r.map(x => x.title).join(" | ")); if (!ok) fails++ }
expect("w git", "GitHub - Brave"); expect("w zzz", /^No window/)
{ const ok = q("firefox")[0].run.kind === "app" && q("firefox")[0].run.label === "open new" && !q("mozilla").some(r => r.run && r.run.kind === "window")
  console.log((ok ? "ok  " : "FAIL") + "  the window you're in isn't offered; its app says open new"); if (!ok) fails++ }
{ const all = ["w ", "evil", "w evil", "brave"].flatMap(x => q(x)).filter(r => r.run && r.run.kind === "window")
  const ok = all.every(r => /^0x[0-9a-f]+$/.test(r.run.target))
  console.log((ok ? "ok  " : "FAIL") + "  " + all.length + " window targets are hex addresses only"); if (!ok) fails++ }
{ const ok = q("signal")[0].run.label === "open" && q("w")[0] && q("w").every(r => !r.run || r.run.kind !== "window")
  console.log((ok ? "ok  " : "FAIL") + "  apps without windows say open; bare \"w\" is a normal search"); if (!ok) fails++ }

openWindows = []

// Commands are found from the normal search box.
expect("emo", "Search emoji"); expect("curr", "Convert currency"); expect("goo", "Search Google"); expect("kil", "Kill a process")
expect("date", "Date calculator"); expect("help", "Show everything"); expect("exchange", "Convert currency")
{ const rows = q("clock"); const ok = /Colombo/.test(rows[0].title) && rows.some(r => r.title === "World clock" && r.complete === "time")
  console.log((ok ? "ok  " : "FAIL") + "  \"clock\" → real answer first, World Clock command below"); if (!ok) fails++ }
{ const c = q("curr")[0]; const ok = c.complete === "100 usd to lkr" && c.select === true && !c.copy && !c.run
  console.log((ok ? "ok  " : "FAIL") + "  command row completes \"" + c.complete + "\" selected"); if (!ok) fails++ }
{ const ok = q("lock").filter(r => r.title === "Lock screen").length === 1 && q("kill").every(r => r.title !== "Kill Process")
  console.log((ok ? "ok  " : "FAIL") + "  no duplicate command rows for exact keyword / current mode"); if (!ok) fails++ }
{ const ok = q("2+2")[0].title === "4" && q("2+2").length === 1
  console.log((ok ? "ok  " : "FAIL") + "  maths queries don't pull in commands"); if (!ok) fails++ }

// Layout data: grouped sections, hero answers, the mode chip, plain subtitles.
{ openWindows = windows
  const b = q("brave"), sums = q("2+2"), fx = q("50 eur"), lo = q("lo")
  openWindows = []
  const ok = b[0].section === "Windows" && !b[1].section && b[2].section === "Apps" && !b[0].hero
    && sums[0].hero && !sums[0].section
    && fx[0].hero && fx[1].section === "Currency"
    && lo[0].section === "Commands" && lo.some(r => r.section === "Apps") && q("lock")[0].subtitle === "Runs omarchy-system-lock"
  console.log((ok ? "ok  " : "FAIL") + "  sections " + b.map(r => r.section || "·").join(",") + " | hero on answers only | " + q("lock")[0].subtitle); if (!ok) fails++ }
{ const m = x => (Engine.mode(x, config) || {}).label || ""
  const ok = m(":fire") === "Emoji" && m("kill ") === "Processes" && m("w git") === "Windows" && m("g cats") === "Search Google" && m("lock") === "" && m("2+2") === "" && m("w") === ""
  console.log((ok ? "ok  " : "FAIL") + "  mode chip → " + [":fire", "kill ", "w git", "g cats"].map(m).join(" | ")); if (!ok) fails++ }
expect("g foo bar", "Search Google: foo bar")
{ const ok = q("g foo bar")[0].subtitle === "Opens google.com" && q("yt x")[0].subtitle === "Opens youtube.com"
  console.log((ok ? "ok  " : "FAIL") + "  keyword rows say where they go → " + q("g foo bar")[0].subtitle); if (!ok) fails++ }

// Shipped defaults are neutral: USD home currency, system time zone.
{ const svc = { rates, zones, now, localZone: "Europe/London", emojis, processes }
  const eur = Engine.run("50 eur", defaults, svc).map(r => r.title)
  const t = Engine.run("time", defaults, svc)[0].title
  const cmd = Engine.run("curr", defaults, svc)[0].complete
  const ok = /USD$/.test(eur[0]) && /GBP$/.test(eur[1]) && /London/.test(t) && cmd === "100 eur to usd" && !JSON.stringify(defaults).includes("LKR")
  console.log((ok ? "ok  " : "FAIL") + "  neutral defaults → " + eur.join(", ") + " | " + t + " | " + cmd); if (!ok) fails++ }
{ const inr = Engine.run("100 rupees", defaults, { rates })[0].title
  const lkr = q("100 rupees")[0].subtitle, rs = q("rs 500 to usd")[0].subtitle
  const ok = /INR → USD/.test(Engine.run("100 rupees", defaults, { rates })[0].subtitle) && /^100 LKR/.test(lkr) && /^500 LKR → USD/.test(rs)
  console.log((ok ? "ok  " : "FAIL") + "  rupee follows home currency → " + inr + " | " + lkr + " | " + rs); if (!ok) fails++ }

// The exchange-rate API is requested only by real currency queries.
{ const asked = []
  const svc = query => ({ rates, zones, now, emojis, processes, requestProcesses: () => {}, requestRates: () => asked.push(query) })
  const yes = ["100 usd to eur", "$50", "50 eur", "usd lkr", "12*50 usd"], no = ["2+2", "time", "hello", "?", ":fire", "curr", "kill", "g usd", "days until dec 25", ""]
  for (const x of yes.concat(no)) Engine.run(x, config, svc(x))
  const ok = yes.every(x => asked.includes(x)) && no.every(x => !asked.includes(x))
  console.log((ok ? "ok  " : "FAIL") + "  rates requested only for currency queries → " + asked.join(" | ")); if (!ok) fails++ }

// Hotkey: which Lua gets sent to `hyprctl eval`.
{ const H = load(P + "lib/Hotkey.js"), cmd = "omarchy-shell shell toggle hypha.commandbar"
  const other = { modmask: 64, key: "K", description: "Keybindings", dispatcher: "__lua" }
  const mine = { modmask: 64, key: "PERIOD", description: "Command bar", dispatcher: "__lua" }
  const j = a => JSON.stringify(a)
  const checks = [
    ["parse", JSON.stringify(H.parseCombo("super + alt + c")) === '{"mask":72,"key":"C"}' && H.parseCombo("") === null && H.parseCombo("SUPER +") !== null && H.parseCombo("C + SUPER") === null],
    ["binds when free", (r => r.bound && r.lua.length === 2 && r.lua[0] === 'hl.bind("SUPER + PERIOD", hl.dsp.exec_cmd("' + cmd + '"), { description = "Command bar" })')(H.plan(j([other]), "SUPER + PERIOD", cmd))],
    ["already bound → nothing", (r => r.bound && r.lua.length === 0)(H.plan(j([other, mine]), "SUPER + PERIOD", cmd))],
    ["key changed → unbind old, bind new", (r => r.bound && r.lua[0] === 'hl.unbind("SUPER + PERIOD")' && /^hl\.bind\("SUPER \+ ALT \+ C"/.test(r.lua[1]))(H.plan(j([mine]), "SUPER + ALT + C", cmd))],
    ["taken by another → no bind, conflict", (r => !r.bound && r.conflict === "Keybindings" && r.lua.length === 0)(H.plan(j([other]), "SUPER + K", cmd))],
    ["hotkey \"\" → unbind ours only", (r => !r.bound && r.lua.join() === 'hl.unbind("SUPER + PERIOD")')(H.plan(j([other, mine]), "", cmd))],
    ["lua strings escaped", H.luaString('a"b\\c') === '"a\\"b\\\\c"'],
    ["bad json → still binds", H.plan("not json", "SUPER + PERIOD", cmd).bound]
  ]
  for (const [name, ok] of checks) { console.log((ok ? "ok  " : "FAIL") + "  hotkey: " + name); if (!ok) fails++ } }

// help: topics, a topic's examples with live answers, search, and quiet previews
{ const top = q("?"), titles = top.map(r => r.title).join("|")
  const ok = titles === "Open an app|Switch window|Inbox note|Clipboard history|Find files|Find everywhere|Search inside files|Packages|Keybindings|Open a web address|Bangs|Bible|Colours|Calculator|Units|Currency|Time zones|Dates|Emoji|Kill a process|Ask your agent|Extensions|Keywords"
    && top.every(r => r.help && !r.run && !r.copy && r.actionLabel === "Open") && top[13].complete === "?calc" && !top[0].section
  console.log((ok ? "ok  " : "FAIL") + "  \"?\" → " + titles); if (!ok) fails++ }
{ const u = q("?units"), sub = u.map(r => r.title + " " + r.subtitle)
  const ok = u[0].section === "Units" && u[0].title === "5 km to mi" && u[0].subtitle === "→ 3.1069 mi" && u[0].complete === "5 km to mi" && u[0].select
    && u.every(r => r.actionLabel === "Try it" && r.helpTopic === "units")
  console.log((ok ? "ok  " : "FAIL") + "  \"?units\" → " + sub.slice(0, 2).join(" | ")); if (!ok) fails++ }
{ const k = q("?kill"), e = q("?emoji"), c = q("?currency"), kw = q("?keywords")
  const ok = k[0].subtitle === "Your processes, busiest first" && !k[0].select && k[0].complete === "kill "
    && /^→ 🔥 fire/.test(e[1].subtitle) && /^→ .*EUR$/.test(c[0].subtitle)
    && kw[0].title === "g" && kw[0].subtitle === "Search Google. Opens google.com" && kw[4].subtitle === "Lock screen. Runs omarchy-system-lock"
  console.log((ok ? "ok  " : "FAIL") + "  notes for prefixes, live answers otherwise → " + [k[0].subtitle, e[1].subtitle, c[0].subtitle, kw[0].subtitle].join(" | ")); if (!ok) fails++ }
{ const before = requested, asked = []
  const svc = { rates, zones, now, emojis, processes, apps, windows: [], launches, requestProcesses: () => requested++, requestRates: () => asked.push(1) }
  for (const x of ["?", "?kill", "?currency", "?units", "?time", "?money"]) Engine.run(x, config, svc)
  const ok = requested === before && asked.length === 0
  console.log((ok ? "ok  " : "FAIL") + "  browsing help never lists processes or fetches rates"); if (!ok) fails++ }
{ const m = q("?in"), none = q("?zzqx")
  const ok = m.some(r => r.helpTopic === "time") && m.some(r => r.helpTopic === "units") && none.length === 1 && /^No help matches/.test(none[0].title)
  console.log((ok ? "ok  " : "FAIL") + "  help search spans topics; misses say so"); if (!ok) fails++ }
{ const m = x => (Engine.mode(x, config) || {}).label
  const ok = m("?") === "Help" && m("?units") === "Help · Units" && m("?mon") === "Help"
  console.log((ok ? "ok  " : "FAIL") + "  help chip → " + [m("?"), m("?units")].join(" | ")); if (!ok) fails++ }
expect(" ? ", "Open an app")
const r = q("g foo & bar")[0].run; console.log("      url:", r.target)
// Shell quoting, run for real. A broken quote only ever creates a marker file
// in a fresh temporary folder: never put anything destructive in a payload.
{ const fs = require("fs"), os = require("os"), { execFileSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-quote-")
  const mark = n => "touch " + dir + "/" + n
  const payloads = [
    "it's; " + mark("semi"),
    "$(" + mark("subst") + ")",
    "`" + mark("tick") + "`",
    "$'\"; " + mark("after") + "; #",          // $' in a replacement string inserts the template after {q}
    "$`; " + mark("before") + "; #",           // $` the template before it
    "$&"                                        // $& the matched {q}
  ]
  const results = []
  for (const text of payloads) {
    const row = Engine.run("x " + text, { providers: ["commands"], commands: [{ keyword: "x", run: "printf %s {q} \"it's\"" }] }, {})[0]
    const out = execFileSync("bash", ["-c", row.run.target, "commandbar", row.run.arg]).toString()
    results.push(out === text + "it's")
  }
  const ran = fs.readdirSync(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  const ok = results.every(Boolean) && ran.length === 0
  console.log((ok ? "ok  " : "FAIL") + "  shell quoting holds for " + payloads.length + " payloads" + (ran.length ? "; ran: " + ran.join(",") : "")); if (!ok) fails++ }
// Templates that evaluate a value or hide quoting from a naive scanner. Each
// either refuses or runs with the payload left as text.
{ const fs = require("fs"), os = require("os"), { execFileSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-tmpl-")
  // No backtick here: bash rejects an arithmetic expression containing one
  // before it evaluates the subscript, which would hide the danger.
  const payload = "a[$(touch " + dir + "/sub)]"
  const templates = [
    "cat <<EOF\n{q}\nEOF",                    // heredoc bodies expand $( ) and backticks
    "echo $(( {q} ))",                          // arithmetic evaluates a[$(cmd)]
    "echo ${a[{q}]}",
    "(( {q} )) && echo",
    "[[ {q} -gt 0 ]] && echo",
    "let n={q}",
    "# \"\necho \"{q}\"",                       // a quote in a comment
    "printf %s \"pre-{q}-post\"",
    "echo {q} # trailing {q}"
  ]
  const verdicts = []
  for (const tmpl of templates) {
    const row = Engine.run("x " + payload, { providers: ["commands"], commands: [{ keyword: "x", run: tmpl }] }, {})[0]
    if (!row.run) { verdicts.push("refused"); continue }
    try { execFileSync("bash", ["-c", row.run.target, "commandbar", row.run.arg], { stdio: "pipe" }) } catch (e) {}
    verdicts.push("ran")
  }
  const marks = fs.readdirSync(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  const want = "ran|refused|refused|refused|refused|refused|ran|ran|ran"
  const ok = marks.length === 0 && verdicts.join("|") === want
  console.log((ok ? "ok  " : "FAIL") + "  templates that evaluate are refused, the rest run the text as text" + (ok ? "" : " → " + verdicts.join("|") + " marks:" + marks)); if (!ok) fails++ }
{ const row = Engine.run("x a b", { providers: ["commands"], commands: [{ keyword: "x", run: "printf '[%s]' {q} \"<{q}>\"" }] }, {})[0]
  const out = require("child_process").execFileSync("bash", ["-c", row.run.target, "commandbar", row.run.arg]).toString()
  console.log((out === "[a b][<a b>]" ? "ok  " : "FAIL") + "  {q} is one word bare and inside double quotes → " + out); if (out !== "[a b][<a b>]") fails++ }
{ const dq = Engine.run("say hi", { providers: ["commands"], commands: [{ keyword: "say", run: "notify-send \"{q}\"" }] }, {})
  const sq = Engine.run("s1 hi", { providers: ["commands"], commands: [{ keyword: "s1", run: "echo '{q}'" }] }, {})
  const ok = dq.length === 1 && dq[0].run && dq[0].run.target === "notify-send \"${1}\"" && sq.length === 1 && !sq[0].run && /switched off/.test(sq[0].title)
  console.log((ok ? "ok  " : "FAIL") + "  {q} in double quotes runs as $1; in single quotes it's refused"); if (!ok) fails++ }
// An emoji with quotes and shell syntax reaches the insert script and wl-copy
// unchanged, and nothing in it runs. Both tools are stubs that record what they got.
{ const fs = require("fs"), os = require("os"), { execFileSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-emoji-")
  const evil = "x'; touch \"" + dir + "/pwned\"; echo '$(touch " + dir + "/pwned2)`touch " + dir + "/pwned3`"
  fs.writeFileSync(dir + "/omarchy-menu-emoji-insert", "#!/bin/bash\nprintf %s \"$1\" > \"$STUBS/typed\"\n", { mode: 0o755 })
  fs.writeFileSync(dir + "/wl-copy", "#!/bin/bash\ncat > \"$STUBS/copied\"\n", { mode: 0o755 })
  const row = Engine.run(":evil", { providers: ["emoji"], emoji: { onEnter: "paste" } }, { emojis: [{ e: evil, k: "evil" }] })[0]
  execFileSync("bash", ["-c", row.run.target], { env: Object.assign({}, process.env, { PATH: dir + ":" + process.env.PATH, STUBS: dir }) })
  const typed = fs.readFileSync(dir + "/typed", "utf8"), copied = fs.readFileSync(dir + "/copied", "utf8")
  const ran = ["pwned", "pwned2", "pwned3"].filter(f => fs.existsSync(dir + "/" + f))
  const ok = typed === evil && copied === evil && ran.length === 0
  fs.rmSync(dir, { recursive: true, force: true })
  console.log((ok ? "ok  " : "FAIL") + "  emoji is typed and copied as data" + (ran.length ? " (ran: " + ran.join(", ") + ")" : "")); if (!ok) fails++ }

// ai: the prompt goes to Omarchy's own launcher as one argument.
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const check = (name, ok, extra) => { console.log((ok ? "ok  " : "FAIL") + "  ai: " + name + (extra ? " → " + extra : "")); if (!ok) fails++ }
  const ai = (query, agent, settings) => Engine.run(query, Engine.deepMerge(config, { ai: settings || {} }), { agent: agent })
  const fb = { fallback: true }

  check("on by default", q("ai hi").some(r => r.provider === "ai") && Engine.mode("ai foo", config).label === "Agent")
  check("fallback is off by default", !ai("how do i rebase", "claude").some(r => r.provider === "ai"))
  { const own = Engine.deepMerge(config, { commands: config.commands.concat({ keyword: "ai", title: "My AI", open: "https://example.com/?q={q}" }) })
    const rows = Engine.run("ai hi", own, { agent: "claude" })
    check("a keyword command with the same word wins", rows[0].title === "My AI: hi" && !rows.some(r => r.provider === "ai" && r.run) && Engine.mode("ai hi", own).label === "My AI", rows[0].title) }

  check("keyword with a prompt", ai("ai why is wifi slow", "claude")[0].title === "Ask Claude Code: why is wifi slow")
  check("hands the prompt to the agent helper", (r => r.kind === "agent" && r.target === "hi there")(ai("ai hi there", "claude")[0].run))
  check("says it runs without asking", /without asking/.test(ai("ai hi", "codex")[0].subtitle), ai("ai hi", "codex")[0].subtitle)
  check("keyword alone asks for a prompt and runs nothing", ai("ai", "codex")[0].title === "Ask Codex…" && !ai("ai", "codex")[0].run)
  check("no default agent opens Omarchy's picker", ai("ai hello", "")[0].run.target === "omarchy-agent --pick")
  check("an unknown agent shows its id", ai("ai hi", "newagent")[0].title === "Ask newagent: hi")
  check("a damaged agent name counts as no agent", ["<b>x</b>", "claude code", "a".repeat(40), "-x", "$(id)"].every(a => ai("ai hi", a)[0].run.target === "omarchy-agent --pick"))
  check("a word starting with the keyword is not the keyword", !ai("aim high", "claude").some(r => r.provider === "ai" && r.run && r.score > 5))
  check("findable by name", ai("ask cla", "claude").some(r => r.title === "Ask Claude Code"))
  check("a custom keyword", ai("ask hi", "claude", { keyword: "ask" })[0].title === "Ask Claude Code: hi")
  check("fallback can be turned off", !ai("how do i rebase", "claude", { fallback: false }).some(r => r.provider === "ai" && r.run))
  check("one word gets no fallback", !ai("rebase", "claude", fb).some(r => r.provider === "ai" && r.run))
  { const rows = ai("how do i rebase", "claude", fb)
    check("fallback offers the agent first, then the chat sites", rows.map(r => r.title.split(":")[0]).join("|") === "Ask Claude Code|Ask ChatGPT|Ask Claude" && rows[1].section === "Chat websites", rows.map(r => r.title.split(":")[0]).join("|")) }
  check("fallback hides when anything else answers", (r => r[0].title === "4" && !r.some(x => x.provider === "ai"))(ai("2 + 2", "claude", fb)))
  check("mode chip", (Engine.mode("ai foo", config) || {}).label === "Agent" && !Engine.mode("aim foo", config))
  check("help topic", Engine.run("?ai", config, { agent: "claude" }).length === 2)
  { const rows = ai("ai what's 5 & 6?", "claude").filter(r => r.provider === "ai")
    check("chat sites follow the agent, in order", rows.map(r => r.title.split(":")[0]).join("|") === "Ask Claude Code|Ask ChatGPT|Ask Claude", rows.map(r => r.title.split(":")[0]).join("|"))
    check("chat prompt is URL-encoded", rows[1].run.kind === "open" && rows[1].run.target === "https://chatgpt.com/?q=what's%205%20%26%206%3F", rows[1].run.target) }
  check("chat sites get their own section", (r => r[0].section === "Agent" && r[1].section === "Chat websites" && !r[2].section && r[1].actionLabel === "Open website")(ai("ai hi", "claude")))
  check("chat sites show without a default agent", (r => r[0].title === "Choose a default agent…" && r[1].title === "Ask ChatGPT: hi")(ai("ai hi", "")))
  check("keyword alone lists no chat sites", ai("ai", "claude").filter(r => r.provider === "ai").length === 1)
  check("fallback needs a default agent", ai("how do i rebase", "", fb).length === 0)
  check("chats can be emptied", ai("ai hi", "claude", { chats: [] }).filter(r => r.provider === "ai").length === 1)

  // Run bin/commandbar-agent with stub Omarchy commands and record what reached them.
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-ai-")
  const stub = (name, body) => fs.writeFileSync(dir + "/" + name, "#!/bin/bash\n" + body + "\n", { mode: 0o755 })
  stub("omarchy-default-agent", "cat \"$STUBS/agent\" 2>/dev/null")
  stub("omarchy-cmd-missing", "[[ $1 != installed ]]")
  stub("omarchy-agent-prompt", "printf '%s\\n' \"$#\" \"$@\" > \"$STUBS/launched\"")
  stub("omarchy-agent", "printf '%s\\n' \"$@\" > \"$STUBS/picked\"")
  stub("notify-send", "printf '%s\\n' \"$@\" > \"$STUBS/notified\"")
  const helper = (agent, prompt) => {
    for (const f of ["launched", "picked", "notified"]) fs.rmSync(dir + "/" + f, { force: true })
    if (agent === null) fs.rmSync(dir + "/agent", { force: true }); else fs.writeFileSync(dir + "/agent", agent + "\n")
    const r = spawnSync(P + "bin/commandbar-agent", [prompt], { env: Object.assign({}, process.env, { PATH: dir + ":" + process.env.PATH, STUBS: dir }) })
    const read = f => fs.existsSync(dir + "/" + f) ? fs.readFileSync(dir + "/" + f, "utf8").replace(/\n$/, "").split("\n") : null
    return { status: r.status, launched: read("launched"), picked: read("picked"), notified: read("notified") }
  }
  const evil = "it's $(touch " + dir + "/pwned); `touch " + dir + "/pwned2` && rm -rf ~"
  { const got = helper("installed", ai("ai " + evil, "claude")[0].run.target).launched || []
    check("prompt arrives as one unchanged argument", got[0] === "1" && got[1] === evil, got.slice(1).join(" "))
    check("nothing in the prompt ran", !fs.existsSync(dir + "/pwned") && !fs.existsSync(dir + "/pwned2")) }
  { const r = helper("missing", "hi")
    check("an uninstalled agent says so in a notification", r.status === 1 && !r.launched && r.notified && r.notified.includes("missing isn't installed"), (r.notified || []).join(" | ")) }
  { const r = helper(null, "hi")
    check("no default agent opens the picker", !r.launched && !r.notified && r.picked && r.picked[0] === "--pick") }
  { const r = helper("<b>x</b>", "hi")
    check("a damaged agent name opens the picker, not a notification", !r.launched && !r.notified && r.picked && r.picked[0] === "--pick") }
  fs.rmSync(dir, { recursive: true, force: true }) }

// bin/commandbar-cache, run against a throwaway HOME.
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const home = fs.mkdtempSync(os.tmpdir() + "/commandbar-home-"), dir = home + "/.cache/omarchy-commandbar"
  const cache = (args, input) => spawnSync("python3", [P + "bin/commandbar-cache"].concat(args), { input: input || "", env: Object.assign({}, process.env, { HOME: home }) })
  const check = (name, ok) => { console.log((ok ? "ok  " : "FAIL") + "  cache: " + name); if (!ok) fails++ }
  const read = name => { const r = cache(["read", name]); return r.status === 0 ? r.stdout.toString() : null }

  check("a missing file reads as empty", read("last-query") === "")
  check("write then read", cache(["write", "last-query"], "brave").status === 0 && read("last-query") === "brave")
  check("the directory is private and the file is 0600", (fs.statSync(dir).mode & 0o777) === 0o700 && (fs.statSync(dir + "/last-query").mode & 0o777) === 0o600)
  check("JSON is written", cache(["write", "launches.json"], '{"firefox":3}').status === 0 && read("launches.json") === '{"firefox":3}')
  check("invalid JSON is refused and the old file kept", cache(["write", "launches.json"], "{nope").status === 1 && read("launches.json") === '{"firefox":3}')
  check("a write over the cap is refused", cache(["write", "last-query"], "x".repeat(4097)).status === 1 && read("last-query") === "brave")
  check("a rates download over 256 KiB is refused", cache(["write", "rates.json"], '"' + "x".repeat(256 * 1024) + '"').status === 1)
  check("unknown files are refused", cache(["read", "../../.bashrc"]).status === 2 && cache(["write", "other.json"], "{}").status === 2)

  fs.writeFileSync(dir + "/launches.json", "{" + " ".repeat(64 * 1024) + "}")
  check("an oversized file is refused without being read", read("launches.json") === null)

  const target = home + "/target"
  fs.writeFileSync(target, "precious")
  fs.rmSync(dir + "/last-query"); fs.symlinkSync(target, dir + "/last-query")
  check("a symlink is neither read nor written through", read("last-query") === null && cache(["write", "last-query"], "evil").status === 1 && fs.readFileSync(target, "utf8") === "precious")
  fs.rmSync(dir + "/last-query"); fs.linkSync(target, dir + "/last-query")
  check("a hard link is neither read nor written through", read("last-query") === null && cache(["write", "last-query"], "evil").status === 1 && fs.readFileSync(target, "utf8") === "precious")
  fs.rmSync(dir + "/last-query")

  fs.chmodSync(dir, 0o777)
  check("a directory others can write to is refused", read("last-query") === null)
  fs.chmodSync(dir, 0o700)
  fs.rmSync(dir, { recursive: true }); fs.symlinkSync(home, dir)
  check("a symlinked directory is refused", read("last-query") === null)
  check("no temporary files are left behind", fs.readdirSync(home).every(f => !f.endsWith(".tmp")))
  fs.rmSync(home, { recursive: true, force: true }) }


// ---------------------------------------------------------------- hypha additions
function check(name, ok, detail) { console.log((ok ? "ok  " : "FAIL") + "  " + name + (detail && !ok ? " → " + detail : "")); if (!ok) fails++ }
// The bar's shared background work, faked: text already loaded under a
// provider's key, and a search that has landed.
const loadedText = (id, key, text, onRequest) => ({ cached: k => k === id + "\n" + key ? text : null, requestLoad: (k, a, o) => onRequest && onRequest(k, a, o) })
const landed = (id, key, text, more) => Object.assign({ search: { key: id + "\n" + key, text, chunks: [text], timedOut: false, done: true }, requestSearch: () => {} }, more || {})
const run = (query, providers, extra) => Engine.run(query, Object.assign({}, config, { providers }), Object.assign({ now, apps, windows: [], launches: {} }, extra || {}))

{ const history = [
    { type: "text", text: "first entry", addedAt: 1 },
    { type: "text", text: "secret pinned\nline two", pinned: true, addedAt: 2 },
    { type: "image", path: "/s/a.png", mime: "image/png", capturedAt: "10:00" },
    { type: "text", text: "$(touch /tmp/x) 'quoted'" }
  ]
  let asked = 0
  const hist = (h, onRequest) => loadedText("clipboard", "history", JSON.stringify(h), onRequest)
  const rows = run("cb ", ["clipboard"], Object.assign({ home: "/h" }, hist(history, (k, a) => { asked++; check("clipboard: reads only the history file, capped", a[0] === "head" && a[a.length - 1] === "/h/.local/state/omarchy/clipboard-history.json") })))
  check("clipboard: pinned first, then newest", rows.map(r => r.title).join("|") === "secret pinned line two|first entry|Image from 10:00|$(touch /tmp/x) 'quoted'", rows.map(r => r.title).join("|"))
  check("clipboard: asks for the history only in cb mode", asked === 1 && run("first", ["clipboard"], hist(history, () => asked++)).length === 0 && asked === 1)
  check("clipboard: Enter pastes the exact text, Shift+Enter copies it", rows[0].run.kind === "paste" && rows[0].run.target === "secret pinned\nline two" && rows[0].alt.kind === "copy" && rows[0].alt.target === rows[0].run.target)
  check("clipboard: an image pastes through Omarchy's file script as argv", rows[2].run.kind === "argv" && /omarchy-clipboard-paste-file$/.test(rows[2].run.target[0]) && rows[2].run.target.slice(1).join(" ") === "image/png /s/a.png" && rows[2].image === "/s/a.png")
  check("clipboard: search filters", run("cb quoted", ["clipboard"], hist(history)).length === 1)
  check("clipboard: a relative image path is skipped", run("cb ", ["clipboard"], hist([{ type: "image", path: "a.png" }]))[0].run === null)
  const CB = load(P + "extensions/clipboard/provider.js")
  CB.provider.forget()
  check("clipboard: forget drops the parsed history", CB.memo.text === null && CB.memo.list.length === 0)
  check("clipboard: mode chip", (Engine.mode("cb x", config) || {}).label === "Clipboard") }

{ const F = load(P + "extensions/files/provider.js")
  let req = null
  const first = run("~-rf notes", ["files"], { home: "/h", requestSearch: (k, a) => { req = { k, a } } })
  const lit = req.a[0], fuzzy = req.a[1]
  check("files: a literal walk, then a fuzzy one, words never read as options",
    req.a.length === 2 && lit[0] === "fd" && fuzzy[0] === "fd"
    && lit.slice(lit.indexOf("--") + 1).join() === "[^/]*notes[^/]*/?$" && lit.includes("--and=\\-rf")
    && fuzzy.slice(fuzzy.indexOf("--") + 1).length === 1 && fuzzy.includes("--and=\\-[^/]*r[^/]*f") && first[0].title === "Searching…", JSON.stringify(req && req.a))
  const out = "/h/Documents/notes.md\0/h/notes/\0/h/x/n-o-t-e-s.txt\0/h/other.md\0/h/Documents/no"
  const entries = F.parse(out, "/h")
  check("files: NUL output parsed, unterminated tail dropped", entries.length === 4 && entries[1].dir && entries[1].rel === "notes", JSON.stringify(entries))
  const rows = run("~notes", ["files"], Object.assign({ home: "/h" }, landed("files", F.key("notes", {}), out)))
  check("files: rows rank a name that starts with the word first", rows[0].title === "notes" && rows[0].subtitle === "~ · Folder" && rows.length === 3, rows.map(r => r.title).join("|"))
  check("files: Enter opens with xdg-open, Shift+Enter a terminal in the folder",
    rows[1].run.target.join(" ") === "xdg-open /h/Documents/notes.md" && rows[1].alt.target.join(" ") === "uwsm-app -- xdg-terminal-exec --dir=/h/Documents", JSON.stringify(rows[1]))
  const tie = run("~notes", ["files"], Object.assign({ home: "/h" }, landed("files", F.key("notes", {}), "/h/a/notes_tests.rs\0/h/a/notes.rs\0")))
  // Two walks: the first stopped mid-path. Its tail must not join the second's first path.
  const two = run("~notes", ["files"], { home: "/h", search: { key: "files\n" + F.key("notes", {}), text: "", chunks: ["/h/a/notes.md\0/h/a/no", "tes.rs\0/h/b/notes.txt\0"], done: true }, requestSearch: () => {} })
  check("files: each walk parsed on its own", two.map(r => r.title).sort().join("|") === "notes.md|notes.txt", two.map(r => r.title).join("|"))
  check("files: the shorter of two equally good names first", tie.map(r => r.title).join("|") === "notes.rs|notes_tests.rs", tie.map(r => r.title).join("|"))
  check("files: one letter asks nothing", run("~n", ["files"], { home: "/h", requestSearch: () => { throw "asked" } })[0].title === "Type a file or folder name") }

{ const text = [
    "SUPER + F                           → Full screen\tlua\thl.dsp.window.fullscreen({ mode = \"fullscreen\" })",
    "SUPER SHIFT + RETURN                → Browser\texec\tomarchy-launch-browser",
    "SUPER SHIFT + B                     → Browser\texec\tomarchy-launch-browser",
    "SUPER + W                           → Close window\t\t",
    "SUPER + PRINT                       → Screenshot\texec\tomarchy-capture-screenshot"
  ].join("\n")
  const rows = run("full screen", ["hotkeys"], Object.assign({ omarchyPath: "/o" }, loadedText("hotkeys", "binds", text)))
  check("hotkeys: found by what they do, keys shown", rows.length === 1 && rows[0].title === "Full screen" && rows[0].subtitle === "Super + F", JSON.stringify(rows[0]))
  check("hotkeys: found by their keys", run("super f", ["hotkeys"], loadedText("hotkeys", "binds", text))[0].title === "Full screen")
  const all = run("keys ", ["hotkeys"], loadedText("hotkeys", "binds", text))
  check("hotkeys: keys lists every bind once, two combos on one row",
    all.length === 4 && all[1].subtitle === "Super + Shift + ↵  ·  Super + Shift + B" && all[2].run === null && /keyboard/.test(all[2].subtitle), all.map(r => r.subtitle).join("|"))
  check("hotkeys: a keyboard-only bind isn't mixed into ordinary results", run("close window", ["hotkeys"], loadedText("hotkeys", "binds", text)).length === 0)
  // Run the dispatch for real against a stub script: the argument reaches
  // dispatch_binding as one literal, and nothing in it executes.
  const fs = require("fs"), os = require("os"), { execFileSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-hotkey-")
  fs.mkdirSync(dir + "/bin")
  fs.writeFileSync(dir + "/bin/omarchy-menu-keybindings", "dispatch_binding() { printf '%s|%s' \"$1\" \"$2\" > \"" + dir + "/got\"; }\n")
  const evil = "x\"; touch " + dir + "/pwned; echo \"$(touch " + dir + "/pwned2)"
  const r = run("keys ", ["hotkeys"], Object.assign({ omarchyPath: dir }, loadedText("hotkeys", "binds", "SUPER + Q → Evil\texec\t" + evil)))[0]
  execFileSync(r.run.target[0], r.run.target.slice(1))
  const got = fs.readFileSync(dir + "/got", "utf8"), ran = fs.readdirSync(dir).filter(f => /pwned/.test(f))
  fs.rmSync(dir, { recursive: true, force: true })
  check("hotkeys: dispatch passes the bind's argument as one literal", got === "exec|" + evil && ran.length === 0, got + " ran:" + ran) }

{ const u = x => (run(x, ["url"])[0] || {}).run
  check("url: a domain opens over https", u("example.com/a?b=1").target === "https://example.com/a?b=1")
  check("url: localhost and IPs default to http", u("localhost:3000").target === "http://localhost:3000" && u("192.168.1.1:8080").target === "http://192.168.1.1:8080")
  check("url: file names and numbers stay themselves", !u("readme.md") && !u("1.5") && !u("notes.txt") && !u("hello world")) }

{ const c = x => run(x, ["colors"])
  const rows = c("#ff6644")
  check("colors: hex shows HEX, RGB and HSL with a swatch", rows.map(r => r.title).join("|") === "#FF6644|rgb(255, 102, 68)|hsl(11, 100%, 63%)" && rows[0].swatch === "#ff6644" && rows[0].hero, rows.map(r => r.title).join("|"))
  check("colors: rgb() and bare hex with a digit", c("rgb(255, 0, 0)")[0].title === "#FF0000" && c("ff6644").length === 3)
  check("colors: hex-letter words stay words", c("decade").length === 0 && c("facade").length === 0 && c("add").length === 0) }

{ const pinnedRows = Engine.run("", Object.assign({}, config, { providers: ["apps"] }), { apps, pinnedApps: ["firefox", "gone.app"], launches: {} })
  check("pins: an empty bar lists pinned apps, skipping uninstalled ones", pinnedRows.length === 1 && pinnedRows[0].title === "Firefox" && pinnedRows[0].appId === "firefox" && pinnedRows[0].section === "Pinned", JSON.stringify(pinnedRows))
  check("pins: an empty bar with no pins lists nothing", Engine.run("", config, { apps, launches: {} }).length === 0)
  const hit = run("fire", ["apps"], { pinnedApps: ["firefox"] })[0]
  check("pins: a pinned app says so in search, and can be unpinned", hit.title === "Firefox" && /^Pinned · /.test(hit.subtitle) && hit.pinned && hit.appId === "firefox") }


{ const N = x => run(x, ["notes"], { home: "/h", now })
  check("notes: unset inbox says how to set it", /Set your inbox/.test(N("n hi")[0].title) && !N("n hi")[0].run)
  const r = Engine.run("n call the $& dentist", Object.assign({}, config, { providers: ["notes"], notes: { inbox: "~/Vault/Inbox.md" } }), { home: "/h", now })[0]
  check("notes: the line is formatted, ~ expanded, $& kept literal",
    r.run.kind === "note" && r.run.path === "/h/Vault/Inbox.md" && r.run.target === "- 2026-09-23 14:00 call the $& dentist" && r.subtitle === "→ ~/Vault/Inbox.md", JSON.stringify(r.run))
  const rel = Engine.run("n x", Object.assign({}, config, { providers: ["notes"], notes: { inbox: "Vault/Inbox.md" } }), { home: "/h", now })[0]
  check("notes: a relative inbox path counts as unset", !rel.run)
  check("notes: mode chip", (Engine.mode("n x", config) || {}).label === "Note") }

// bin/commandbar-note, run for real in a temporary folder.
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-note-")
  const note = (path, input) => spawnSync("python3", ["-I", P + "bin/commandbar-note", path], { input })
  const inbox = dir + "/Inbox.md"
  fs.writeFileSync(inbox, "# Inbox\n- old")                 // no trailing newline
  const a = note(inbox, "- first\u0007 $(touch " + dir + "/pwned)\n")
  const b = note(inbox, "- second")
  const text = fs.readFileSync(inbox, "utf8")
  check("note helper: appends on a new line, drops control characters, runs nothing",
    a.status === 0 && b.status === 0 && text === "# Inbox\n- old\n- first $(touch " + dir + "/pwned)\n- second\n" && !fs.existsSync(dir + "/pwned"), JSON.stringify(text))
  fs.writeFileSync(dir + "/target.md", "")
  fs.symlinkSync(dir + "/target.md", dir + "/link.md")
  const l = note(dir + "/link.md", "- x")
  check("note helper: refuses a symlink", l.status !== 0 && fs.readFileSync(dir + "/target.md", "utf8") === "")
  const m = note(dir + "/missing/Inbox.md", "- x")
  check("note helper: never creates a folder", m.status !== 0 && !fs.existsSync(dir + "/missing"))
  const n = note(dir + "/New.md", "- x")
  check("note helper: a new note is private", n.status === 0 && (fs.statSync(dir + "/New.md").mode & 0o777) === 0o600)
  check("note helper: empty input writes nothing", note(dir + "/Empty.md", " \n").status !== 0 && !fs.existsSync(dir + "/Empty.md"))
  fs.rmSync(dir, { recursive: true, force: true }) }


{ const G = load(P + "lib/Geometry.js")
  const base = G.defaults({}, 48)
  check("geometry: defaults centre the card near the top", base.cx === 0.5 && base.top === 0.22 && base.width === 640 && base.listHeight === 336)
  const m = G.merge({ cx: 0.3, width: "wide", junk: 1 }, base)
  check("geometry: saved fields win, bad ones fall back", m.cx === 0.3 && m.width === 640 && m.top === 0.22 && !("junk" in m))
  const c = G.clamp({ cx: 0.99, top: -1, width: 5000, listHeight: 50 }, 1920, 1080, 10, 0)
  check("geometry: kept on screen and above the minimums", c.width === 1900 && c.cx === 0.5 && c.top > 0 && c.listHeight === G.MIN_LIST, JSON.stringify(c))
  const mv = G.moved(base, 100, 200, 1920, 1080)
  check("geometry: a drag moves the card's corner", G.x(mv, 1920) === 100 && G.y(mv, 1080) === 200 && mv.width === 640)
  const rs = G.resized(base, 200, 100, 1920)
  check("geometry: resizing keeps the left edge", G.x(rs, 1920) === G.x(base, 1920) && rs.width === 840 && rs.listHeight === 436)
  check("geometry: can't resize below the minimum", G.resized(base, -1000, -1000, 1920).width === G.MIN_WIDTH)
  const gl = G.glass(0.5, 0.78)
  check("glass: only the card is above the blur line", gl.scrim < gl.ignoreAlpha && gl.ignoreAlpha < gl.card, JSON.stringify(gl))
  const dense = G.glass(0.9, 0.78)
  check("glass: a theme with a heavy scrim gets it lightened under the line", dense.scrim < dense.ignoreAlpha && dense.ignoreAlpha < dense.card, JSON.stringify(dense))
  const off = G.glass(0.5, 1)
  check("glass: opacity 1 means a solid card", off.card === 1 && off.scrim === 0.5) }

// bible: references without a keyword, NASB first, and words after "bible"
{ const top = (query) => { const r = run(query, ["bible"]); return r[0] ? r[0].title : "(none)" }
  const url = (query) => { const r = run(query, ["bible"]); return r[0] && r[0].run ? r[0].run.target : "" }
  check("bible: john 3:16 → NASB first", top("john 3:16") === "John 3:16 (NASB)", top("john 3:16"))
  check("bible: one row per translation, in order", run("john 3:16", ["bible"]).map(r => r.title.replace(/.*\(/, "")).join(" ") === "NASB) NASB1995) ESV) KJV)")
  check("bible: 1 jn 1:9 is the letter", top("1 jn 1:9") === "1 John 1:9 (NASB)", top("1 jn 1:9"))
  check("bible: 1john 1:9-10 and i john", top("1john 1:9-10") === "1 John 1:9-10 (NASB)" && top("i john 1") === "1 John 1 (NASB)", top("1john 1:9-10") + " / " + top("i john 1"))
  check("bible: is 53:5 is Isaiah, not part i of a book s", top("is 53:5") === "Isaiah 53:5 (NASB)" && top("bible is 53") === "Isaiah 53 (NASB)", top("is 53:5"))
  check("bible: psalm 23 and bible ps 23 read Psalm 23", top("psalm 23") === "Psalm 23 (NASB)" && top("bible ps 23") === "Psalm 23 (NASB)", top("psalm 23"))
  check("bible: song of songs 2:4", top("song of songs 2:4") === "Song of Solomon 2:4 (NASB)", top("song of songs 2:4"))
  check("bible: a dot is a verse only after bible", top("rom 8.28") === "(none)" && top("bible rom 8.28") === "Romans 8:28 (NASB)", top("rom 8.28"))
  // Across every provider: launcher queries that look like abbreviations stay theirs.
  const whole = (query) => { const r = Engine.run(query, config, { now, apps, windows: [], launches: {} }); return r[0] ? r[0].provider : "(none)" }
  check("bible: mar 3 is still the date", whole("mar 3") === "time", whole("mar 3"))
  check("bible: am 5, ex 1, pm 2:30, am 5.30, ps5 give no scripture", ["am 5", "ex 1", "pm 2:30", "am 5.30", "ps5", "is 3"].every(x => !Engine.run(x, config, { now, apps, windows: [] }).some(r => r.provider === "bible")))
  check("bible: a chapter alone scores under the time and app answers", run("mark 2", ["bible"])[0].score < 70 && run("john 3:16", ["bible"])[0].score > 90)
  check("bible: no 4 John, no 3 Samuel", top("4 john 1") === "(none)" && top("3 sam 1") === "(none)")
  check("bible: a book alone stays an app search", top("job") === "(none)" && top("mark") === "(none)" && top("john") === "(none)")
  check("bible: ordinary words are not scripture", top("hello 3") === "(none)" && top("5 km") === "(none)" && top("3pm") === "(none)")
  check("bible: the link is Bible Gateway quicksearch in NASB", url("john 3:16") === "https://www.biblegateway.com/quicksearch/?quicksearch=John%203%3A16&version=NASB", url("john 3:16"))
  check("bible: bible and words is a word search", top("bible love one another") === "Search the Bible: love one another (NASB)" && /quicksearch=love%20one%20another&version=NASB$/.test(url("bible love one another")))
  check("bible: bible and a reference is the passage", top("bible jn 3:16") === "John 3:16 (NASB)")
  const own = Engine.run("john 3:16", Object.assign({}, config, { providers: ["bible"], bible: { versions: ["ESV", "bad version!", "NKJV"] } }), { now })
  check("bible: your versions, odd names dropped", own.map(r => r.title).join("|") === "John 3:16 (ESV)|John 3:16 (NKJV)", own.map(r => r.title).join("|"))
  check("bible: mode chip absent, help topic present", q("?bible").length > 0) }

// bangs: listed bangs go straight to the site, unlisted ones to DuckDuckGo
{ const b = (query, cfg) => Engine.run(query, Object.assign({}, config, { providers: ["bangs"] }, cfg || {}), { now })
  const r = b("!nasb john 3:16")
  check("bangs: !nasb opens Bible Gateway NASB", r[0].title === "Bible (NASB): john 3:16" && r[0].run.target === "https://www.biblegateway.com/quicksearch/?quicksearch=john%203%3A16&version=NASB", JSON.stringify(r[0] && r[0].run))
  check("bangs: a trailing bang works too", b("john 3:16 !nasb")[0].run.target === r[0].run.target)
  check("bangs: !bible is NASB", /version=NASB$/.test(b("!bible love")[0].run.target))
  const un = b("!imdb dune")
  check("bangs: an unlisted bang goes to DuckDuckGo whole", un[0].run.target === "https://duckduckgo.com/?q=!imdb%20dune", un[0] && un[0].run.target)
  check("bangs: fallback \"\" keeps unlisted bangs here", b("!imdb dune", { bangs: Object.assign({}, config.bangs, { fallback: "" }) }).length === 0)
  check("bangs: \"!\" lists them, \"!na\" narrows", b("!").length >= 10 && b("!na").map(x => x.complete.trim()).join(" ") === "!nasb !nasb95")
  check("bangs: a bang with no search asks for one", b("!nasb")[0].title === "Bible (NASB)…" || b("!nasb ")[0].title === "Bible (NASB)…")
  check("bangs: $& and quotes stay literal and encoded", b("!g $& 'x'")[0].run.target === "https://www.google.com/search?q=%24%26%20'x'", b("!g $& 'x'")[0].run.target)
  const merged = Engine.deepMerge(defaults, { bangs: { engines: { g: null, ex: { title: "Example", open: "https://example.com/?s={q}" }, bad: { title: "Bad", open: "javascript:alert({q})" } } } })
  const m = (query) => Engine.run(query, Object.assign({}, merged, { providers: ["bangs"] }), { now })
  check("bangs: yours merge over the defaults by name", m("!ex hi")[0].run.target === "https://example.com/?s=hi" && /biblegateway/.test(m("!nasb x")[0].run.target))
  check("bangs: null drops a default (then DuckDuckGo takes it)", /^https:\/\/duckduckgo\.com\/\?q=!g%20hi$/.test(m("!g hi")[0].run.target), m("!g hi")[0].run.target)
  check("bangs: a non-http address is never opened", /duckduckgo/.test(m("!bad hi")[0].run.target))
  check("bangs: 5! is still factorial, not a bang", q("5!")[0].title === "120")
  check("bangs: mode chip", (Engine.mode("!nasb x", config) || {}).label === "Bang") }

// packages: one read per open, official repos, install through pacman's own prompt
{ const Pk = load(P + "extensions/packages/provider.js")
  const text = "Q\tkfind\t26.07.0-1\nQ\tbash\t5.3-1\nS\textra\tkfind\t26.08.0-1\tx86_64\tFind Files/Folders\nS\tcore\tbash\t5.3-1\tx86_64\tThe GNU Bourne Again shell\n" +
               "S\textra\tkfind-extras\t1-1\tany\tMore\nS\textra\t$(touch x)\t1\tany\tevil name\nS\textra\tplocate\t1.1.25-1\tx86_64\tAlternative to locate, faster\n"
  const data = Pk.parse(text)
  let asked = 0
  const pk = (query, t) => run(query, ["packages"], loadedText("packages", "list", t === undefined ? text : t, () => asked++))
  check("packages: a bad name never makes the list", data.list.length === 4 && !data.list.some(x => /\$/.test(x.name)))
  const r = pk("pkg kfind")
  check("packages: exact name first", r[0].title === "kfind" && r[1].title === "kfind-extras", r.map(x => x.title).join(","))
  check("packages: installed rows show details, and the installed version when it differs", r[0].run.label === "details" && /installed 26\.07\.0-1/.test(r[0].subtitle), r[0].subtitle)
  check("packages: the name is $1, never in the script", r[0].run.target.slice(-2).join(" ") === "commandbar-pkg kfind" && !/kfind/.test(r[0].run.target[r[0].run.target.length - 3]))
  const inst = pk("pkg kfind-extras")[0]
  check("packages: Enter on a missing package runs pacman -S in a terminal (pacman asks)", inst.run.label === "install" && /sudo pacman -S -- "\$1"/.test(inst.run.target.join(" ")) && !/--noconfirm/.test(inst.run.target.join(" ")))
  check("packages: install names the repo, so a name in two repos installs the chosen one", inst.run.target.slice(-1)[0] === "extra/kfind-extras")
  const two = pk("pkg ghostty", "S\tomarchy\tghostty\t1-1\tx86_64\tterminal\nS\textra\tghostty\t1-1\tx86_64\tterminal\n")
  check("packages: a repo that isn't Arch's shows pacman -Si, not a dead archlinux.org link", two.length === 2 && two.some(r => r.alt.kind === "argv" && r.alt.target.slice(-1)[0] === "omarchy/ghostty") && two.some(r => r.alt.kind === "open" && /packages\/extra\//.test(r.alt.target)))
  check("packages: an empty list says expac may be missing", /expac/.test(pk("pkg x", "")[0].subtitle))
  check("packages: Shift+Enter opens archlinux.org with its arch", inst.alt.target === "https://archlinux.org/packages/extra/any/kfind-extras/", inst.alt.target)
  check("packages: description words find it", pk("pkg locate faster")[0].title === "plocate")
  check("packages: asks for the list only in pkg mode", asked > 0 && (asked = 0, pk("kfind").length === 0) && asked === 0)
  check("packages: waits for the list", pk("pkg kfind", null)[0].title === "Reading the package list…")
  check("packages: mode chip", (Engine.mode("pkg x", config) || {}).label === "Packages") }

// inside files: ripgrep with the words as one argument
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const C = load(P + "extensions/contents/provider.js")
  const p = C.plan("invoice 2024", null)
  check("contents: words are $1, fixed strings, hidden off by default", p.argv[2] === C.SCRIPT && p.argv[4] === "invoice 2024" && p.argv.length === 5 && /--fixed-strings/.test(C.SCRIPT))
  check("contents: hidden on adds the flag", C.plan("invoice", { hidden: true }).argv[5] === "1")
  check("contents: two letters is not enough", C.plan("ab", null) === null)
  const hits = C.parse("/home/u/a.md\u000012:  the   invoice\n/home/u/b.txt\u00003:x\nnot a hit\n")
  check("contents: parse keeps path, line and text", hits.length === 2 && hits[0].line === 12 && hits[0].text === "the invoice")
  const rows = run("rg invoice", ["contents"], Object.assign({ home: "/home/u" }, landed("contents", C.plan("invoice", config.contents).key, "/home/u/a.md\u000012:the invoice\n")))
  check("contents: Enter edits at the line, Shift+Enter opens", rows[0].run.kind === "edit" && rows[0].run.target === "/home/u/a.md" && rows[0].run.line === 12 && rows[0].alt.target.join(" ") === "xdg-open /home/u/a.md" && rows[0].subtitle === "~/a.md:12")
  check("contents: mode chip", (Engine.mode("rg x", config) || {}).label === "In files")
  // For real, in a scratch home: finds the line, and a $(…) query runs nothing.
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-rg-")
  fs.writeFileSync(dir + "/note.md", "first\nthe zebra invoice\n")
  const env = Object.assign({}, process.env, { HOME: dir })
  const found = C.parse(spawnSync("bash", C.plan("zebra invoice", null).argv.slice(1), { encoding: "utf8", env }).stdout)
  check("contents: a real search finds the line", found.length === 1 && found[0].line === 2 && found[0].path === dir + "/note.md", JSON.stringify(found))
  spawnSync("bash", C.plan("$(touch " + dir + "/pwned)", null).argv.slice(1), { encoding: "utf8", env })
  check("contents: a $(…) query runs nothing", !fs.existsSync(dir + "/pwned"))
  fs.rmSync(dir, { recursive: true }) }

// help previews start nothing: a search there would loop for ever
{ let calls = 0
  const count = () => { calls++ }
  for (const query of ["?locate", "?contents", "?packages", "? find", "?clipboard", "?files"])
    Engine.run(query, config, { now, apps, windows: [], requestSearch: count, requestHomeIndex: count, requestPackages: count, requestFiles: count, requestClipboard: count, requestHotkeys: count, requestRates: count, requestProcesses: count })
  check("help: browsing topics calls no request hook", calls === 0, calls + " calls")
  let live = 0
  Engine.run("/hosts", config, { now, apps, windows: [], requestSearch: () => live++, requestHomeIndex: () => {} })
  check("help: (calibration) a real / query does call it", live === 1) }

// a trailing !word inside a mode belongs to the mode
{ const top = (query) => { const r = Engine.run(query, config, { now, apps, windows: [], requestSearch: () => {}, requestHomeIndex: () => {}, requestPackages: () => {} }); return r[0] ? r[0].provider : "(none)" }
  check("bangs: /hosts !backup stays a file search", top("/hosts !backup") === "everywhere" && top("/x !w") === "everywhere", top("/hosts !backup"))
  check("bangs: rg and pkg keep their trailing !words", top("rg TODO !x") === "contents" && top("pkg foo !bar") === "packages")
  check("bangs: outside a mode a trailing bang still works", top("john 3:16 !nasb") === "bangs")
  const t = Date.now(); Engine.run("a ".repeat(20000) + "!x", config, { now, apps, windows: [] })
  check("bangs and bible: a pasted blob is quick", Date.now() - t < 200, (Date.now() - t) + "ms") }

// syncthing: a keyword that opens the local web UI
{ const r = q("syncthing")
  check("syncthing: opens the local web UI", r[0].title === "Syncthing" && r[0].run && r[0].run.target === "http://127.0.0.1:8384/", JSON.stringify(r[0] && r[0].run)) }

// ---------------------------------------------------------------- extensions
{ const good = { schema: 1, id: "demo", name: "Demo", type: "js", entry: "provider.js", defaults: { a: 1, b: { c: 2 } }, order: 5 }
  const v = (m, dir) => Ext.validate(m, dir || "/x/demo")
  check("ext: a good manifest validates, defaults kept", !v(good).error && v(good).entry === "provider.js" && v(good).defaults.b.c === 2)
  check("ext: wrong schema, bad id, bad entry are refused",
    /schema/.test(v(Object.assign({}, good, { schema: 2 })).error) && /id/.test(v(Object.assign({}, good, { id: "Bad Id" })).error)
    && /entry/.test(v(Object.assign({}, good, { entry: "../x.js" })).error) && /entry/.test(v(Object.assign({}, good, { entry: "a/b.js" })).error))
  check("ext: invalid JSON text says so", /JSON/.test(v("{nope").error))
  const sc = { schema: 1, id: "sc", type: "script", command: ["./run", "--x"], mode: { pattern: "^\\s*sc\\s" } }
  check("ext: a script's ./command resolves inside its folder", v(sc, "/e/sc").command.join(" ") === "/e/sc/run --x")
  check("ext: a script needs a mode", /mode/.test(v(Object.assign({}, sc, { mode: undefined })).error))
  check("ext: ../ and shell strings are refused as commands",
    /command/.test(v(Object.assign({}, sc, { command: ["./../evil"] })).error) && /command/.test(v(Object.assign({}, sc, { command: "rm -rf ~" })).error)
    && /command/.test(v(Object.assign({}, sc, { command: ["sh -c x"] })).error) && /command/.test(v(Object.assign({}, sc, { command: ["./a", 3] })).error))
  check("ext: a bad mode pattern is refused", /pattern/.test(v(Object.assign({}, good, { mode: { pattern: "(" } })).error))
  const both = Ext.collect([{ dir: "/b/demo", manifest: good }, { dir: "/u/demo", manifest: Object.assign({}, good, { name: "Mine" }), user: true }, { dir: "/b/bad", manifest: "{" }])
  check("ext: yours replaces a bundled one with the same id; errors are listed", both.list.length === 1 && both.list[0].name === "Mine" && both.list[0].user && both.errors.length === 1 && both.errors[0].dir === "/b/bad")
  const m = v(good)
  check("ext: on by default; extensions switches win; providers list decides alone",
    Ext.isOn(m, {}) && !Ext.isOn(m, { extensions: { demo: false } }) && !Ext.isOn(m, { extensions: { demo: { enabled: false } } })
    && !Ext.isOn(v(Object.assign({}, good, { enabled: false })), {}) && Ext.isOn(v(Object.assign({}, good, { enabled: false })), { extensions: { demo: true } })
    && !Ext.isOn(m, { providers: ["other"] }) && Ext.isOn(m, { providers: ["demo"], extensions: { demo: false } }))
  check("ext: a missing required command keeps it off", !Ext.isOn(Object.assign({}, m, { missing: ["fd"] }), { extensions: { demo: true } }))
  const cfg = Ext.effectiveConfig({ hotkey: "X" }, [m], { demo: { b: { d: 3 } }, hotkey: "Y" })
  check("ext: settings merge your section over the manifest's defaults", cfg.hotkey === "Y" && cfg.demo.a === 1 && cfg.demo.b.c === 2 && cfg.demo.b.d === 3)
  check("ext: null removes a default key", !("a" in Ext.effectiveConfig({}, [m], { demo: { a: null } }).demo))
  check("ext: every bundled manifest loaded, none refused", loaded.errors.length === 0 && loaded.manifests.length === 21, loaded.manifests.length + " " + JSON.stringify(loaded.errors))
  check("ext: config.default.json holds only the bar's own settings", Object.keys(Engine.parseJsonc(require("fs").readFileSync(P + "config.default.json", "utf8"))).sort().join() === "extensions,glass,hotkey,window") }

// script extensions: rows from JSON, only the bar's own actions
{ const out = Ext.parseOutput(JSON.stringify({ items: [
    { title: "ok", run: { kind: "open", target: "https://example.com" }, alt: { kind: "copy", target: "x" } },
    { title: "js url", run: { kind: "open", target: "javascript:alert(1)" } },
    { title: "shell", run: { kind: "shell", target: "rm -rf ~" } },
    { title: "argv", run: { kind: "argv", target: ["notify-send", 3] } },
    { title: "edit", run: { kind: "edit", target: "/a/b", line: 12 } },
    { nope: true }
  ], message: "hi" }))
  check("script: rows parsed; unknown kinds, javascript: and non-string argv dropped",
    out.items.length === 5 && out.items[0].run.kind === "open" && out.items[0].alt.kind === "copy" && out.items[1].run === null
    && out.items[2].run === null && out.items[3].run === null && out.items[4].run.line === 12 && out.message === "hi", JSON.stringify(out.items.map(i => i.run)))
  check("script: not JSON, or no items, says so", /JSON/.test(Ext.parseOutput("oops").error) && /items/.test(Ext.parseOutput("{}").error))
  const m = Ext.validate({ schema: 1, id: "wx", name: "Weather", type: "script", command: ["./wx"], mode: { pattern: "^\\s*wx\\s" }, minQuery: 2, placeholder: "Type a city" }, "/e/wx")
  const sp = Ext.scriptProvider(m)
  let asked = null
  const ctx = (extra) => Object.assign({ settings: { unit: "c" }, home: "/h", requestSearch: (k, a, o) => { asked = { k, a, o } } }, extra || {})
  check("script: only in its mode; a placeholder below minQuery", sp.match("hello", ctx()).length === 0 && sp.match("wx a", ctx())[0].title === "Type a city")
  const first = sp.match("wx paris", ctx())
  const req = asked && JSON.parse(asked.o.stdin)
  check("script: asks with the command and a JSON request on stdin", first[0].title === "Searching…" && asked.k === "paris" && asked.a[0].join(" ") === "/e/wx/wx"
    && req.protocol === 1 && req.text === "paris" && req.query === "wx paris" && req.settings.unit === "c" && req.home === "/h")
  const rows = sp.match("wx paris", ctx({ search: { key: "paris", text: '{"items":[{"title":"12°"}]}' } }))
  check("script: the landed output becomes rows", rows.length === 1 && rows[0].title === "12°")
  check("script: bad output is an error row; nothing found uses its message; a timeout says so",
    /isn't JSON/.test(sp.match("wx paris", ctx({ search: { key: "paris", text: "x" } }))[0].title)
    && sp.match("wx paris", ctx({ search: { key: "paris", text: '{"items":[],"message":"No such city"}' } }))[0].title === "No such city"
    && sp.match("wx paris", ctx({ search: { key: "paris", text: "", timedOut: true } }))[0].title === "Stopped after 3 s") }

// a real script extension, run the way the bar runs it
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const dir = fs.mkdtempSync(os.tmpdir() + "/commandbar-script-")
  fs.writeFileSync(dir + "/echo", "#!/usr/bin/env python3\nimport json,sys\nr=json.load(sys.stdin)\nprint(json.dumps({'items':[{'title':'you typed '+r['text'],'copy':r['text']}]}))\n", { mode: 0o755 })
  const m = Ext.validate({ schema: 1, id: "echo", type: "script", command: ["./echo"], mode: { pattern: "^\\s*echo\\s" } }, dir)
  const sp = Ext.scriptProvider(m)
  let req = null
  const hostile = "$(touch " + dir + "/pwned) `touch " + dir + "/pwned2`"
  sp.match("echo " + hostile, { requestSearch: (k, a, o) => { req = { k, a, o } } })
  const r = spawnSync(req.a[0][0], req.a[0].slice(1), { input: req.o.stdin, encoding: "utf8", cwd: dir })
  const rows = sp.match("echo " + hostile, { search: { key: req.k, text: r.stdout } })
  check("script: a real script gets the text as data and its rows come back", rows[0].title === "you typed " + hostile && rows[0].copy === hostile && !fs.existsSync(dir + "/pwned") && !fs.existsSync(dir + "/pwned2"), rows[0] && rows[0].title)
  fs.rmSync(dir, { recursive: true }) }

// the bar's background work, seen per extension
{ let seen = null
  const services = { search: { key: "files\nnotes", text: "T", chunks: ["T"], done: true }, requestSearch: (k) => { seen = k }, cached: k => k === "files\nlist" ? "L" : null, requestLoad: (k) => { seen = k } }
  const ctxFiles = Engine.contextFor({ id: "files" }, config, services), ctxOther = Engine.contextFor({ id: "other" }, config, services)
  check("work: a search is visible only to the extension that asked", ctxFiles.search.key === "notes" && ctxFiles.search.text === "T" && ctxOther.search === null)
  ctxOther.requestSearch("q", ["echo"])
  check("work: keys are prefixed with the extension's id", seen === "other\nq")
  check("work: loads read under the extension's own key", ctxFiles.load("list", ["x"]) === "L" && seen === "files\nlist" && ctxOther.load("list", ["x"]) === null) }

// ?extensions
{ const rows = q("?extensions")
  check("ext: ?extensions lists every extension with its state and what it touches", rows.length === 21 && rows.some(r => r.title === "Everywhere" && /^On/.test(r.subtitle) && /script/.test(r.subtitle) && /runs plocate/.test(r.subtitle)), rows.length + " " + (rows[0] && rows[0].subtitle))
  const off = Engine.run("?extensions", Object.assign({}, config, { extensions: { bible: false } }), { now })
  check("ext: a switched-off extension says how to turn it on", off.some(r => r.title === "Bible" && /^Off: "extensions": \{ "bible": true \}/.test(r.subtitle)))
  check("ext: switched off, it stops answering", !Engine.run("john 3:16", Object.assign({}, config, { extensions: { bible: false } }), { now, apps }).some(r => r.provider === "bible")) }

// 2+2 is arithmetic, not an app
{ const pinta = app("com.github.PintaProject.Pinta", "Pinta", "Image Editor", [], ["draw", "paint", "graphics", "2d"])
  const rows = Engine.run("2+2", config, { now, apps: [pinta], windows: [], launches: {} })
  check("apps: 2+2 answers 4 and doesn't offer Pinta", rows[0].title === "4" && !rows.some(r => r.title === "Pinta"), rows.map(r => r.title).join("|")) }

// bin/commandbar-extensions: finds manifests, refuses what others could have planted
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const root = fs.mkdtempSync(os.tmpdir() + "/commandbar-exts-"), user = root + "/user"
  fs.mkdirSync(user + "/ok", { recursive: true, mode: 0o700 }); fs.chmodSync(user, 0o700)
  fs.writeFileSync(user + "/ok/extension.json", JSON.stringify({ schema: 1, id: "ok", requires: ["sh", "no-such-command-zz"] }))
  fs.mkdirSync(user + "/linked", { mode: 0o700 }); fs.symlinkSync("/etc/hostname", user + "/linked/extension.json")
  const list = () => JSON.parse(spawnSync("python3", [P + "bin/commandbar-extensions", P + "extensions", user], { encoding: "utf8" }).stdout)
  const got = list().filter(e => e.user)
  const ok = got.find(e => /\/ok$/.test(e.dir)), linked = got.find(e => /\/linked$/.test(e.dir))
  check("ext helper: reads yours and reports missing commands", ok && JSON.parse(ok.manifest).id === "ok" && ok.missing.join() === "no-such-command-zz", JSON.stringify(ok))
  check("ext helper: a symlinked extension.json is refused", linked && linked.error && !linked.manifest, JSON.stringify(linked))
  fs.chmodSync(user, 0o777)
  const open = list().filter(e => e.user)
  check("ext helper: a user folder others can write to is refused whole", open.length === 1 && /writable by others/.test(open[0].error), JSON.stringify(open))
  check("ext helper: the bundled ones are all found", list().filter(e => !e.user).length === 21)
  fs.chmodSync(user, 0o700); fs.rmSync(root, { recursive: true }) }

// everywhere: the command itself
{ const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const EW = P + "extensions/everywhere/everywhere"
  const rank = (q, paths, home) => spawnSync(EW, ["--rank", "--", q], { input: paths.join("\0"), encoding: "utf8", env: Object.assign({}, process.env, { HOME: home || "/home/u" }) }).stdout.trim().split("\n")
  const order = rank("dwnlds", ["/usr/share/icons/x/stat_sys_download_done.xml", "/home/u/Downloads", "/home/u/.rustup/downloads", "/etc/hosts"])
  check("everywhere: ~/Downloads first for dwnlds, hidden after", order[0] === "/home/u/Downloads" && order.indexOf("/home/u/.rustup/downloads") > 0, order.join(","))
  check("everywhere: an exact name beats the home lift; a hidden home file loses to a visible system one",
    rank("hosts", ["/home/u/.config/gh/hosts.yml", "/etc/hosts"])[0] === "/etc/hosts" && rank("hosts", ["/home/u/.config/pinta/x/hosts", "/etc/hosts"])[0] === "/etc/hosts")
  // For real, with a scratch home and its own index: the home index, globs escaped, ^start, and no shell anywhere.
  const home = fs.mkdtempSync(os.tmpdir() + "/everywhere-home-")
  fs.mkdirSync(home + "/Docs"); fs.writeFileSync(home + "/Docs/file[1].txt", ""); fs.writeFileSync(home + "/Docs/what?.md", ""); fs.writeFileSync(home + "/Docs/downbeat.txt", "")
  const env = Object.assign({}, process.env, { HOME: home, XDG_CACHE_HOME: home + "/.cache" })
  const ew = (...a) => spawnSync(EW, a, { env, encoding: "utf8", timeout: 20000 })
  check("everywhere: --index builds a private index", ew("--index").status === 0 && (fs.statSync(home + "/.cache/everywhere/home.db").mode & 0o777) === 0o600 && (fs.statSync(home + "/.cache/everywhere").mode & 0o777) === 0o700)
  check("everywhere: * ? [ ] in a name are found literally (exact terms skip the fuzzy pass)", ew("'file[1]").stdout.split("\n")[0] === home + "/Docs/file[1].txt" && ew("'what?").stdout.split("\n")[0] === home + "/Docs/what?.md")
  check("everywhere: ^name matches a name's start", ew("^downbeat").stdout.split("\n")[0] === home + "/Docs/downbeat.txt")
  ew("$(touch " + home + "/pwned)"); ew("--", "`touch " + home + "/pwned2`")
  check("everywhere: a $(…) query runs nothing", !fs.existsSync(home + "/pwned") && !fs.existsSync(home + "/pwned2"))
  const cb = spawnSync(EW, ["--commandbar"], { env, input: JSON.stringify({ text: "downbeat", settings: { exclude: [] } }), encoding: "utf8" })
  const items = JSON.parse(cb.stdout).items
  check("everywhere: --commandbar returns rows the bar accepts", items[0].title === "downbeat.txt" && Ext.parseOutput(cb.stdout).items[0].run.kind === "open" && Ext.parseOutput(cb.stdout).items[0].alt.kind === "argv", cb.stdout.slice(0, 200))
  check("everywhere: exclusions from the bar's settings apply", JSON.parse(spawnSync(EW, ["--commandbar"], { env, input: JSON.stringify({ text: "downbeat", settings: { exclude: ["/Docs/"] } }), encoding: "utf8" }).stdout).items.every(i => !/Docs/.test(i.subtitle)))
  check("everywhere: --index --max-age skips a fresh index", (() => { const t = fs.statSync(home + "/.cache/everywhere/home.db").mtimeMs; ew("--index", "--max-age", "60"); return fs.statSync(home + "/.cache/everywhere/home.db").mtimeMs === t })())
  fs.rmSync(home, { recursive: true }) }

console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0)
