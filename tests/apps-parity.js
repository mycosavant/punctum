// node tests/apps-parity.js [punctumd] — the JS apps provider and the Rust one
// in punctumd, given the same apps, launch counts, pins and windows, must
// give the same rows in the same order. Rust may add rows after them: apps
// found by their letters in order (apps.rs), each an app row ranked below
// every row the JS gave. The empty bar's pinned list must match too.
// SHOW=1 lists what Rust adds.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Apps = load(P + "extensions/apps/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

const NAMES = [
  ["firefox", "Firefox", "Web Browser", ["New Window", "New Private Window"], ["internet", "web"]],
  ["brave-browser", "Brave", "Web Browser", ["New Window", "New Incognito Window"], []],
  ["chromium", "Chromium", "Web Browser", ["New Window", "New Incognito Window"], []],
  ["org.gnome.Nautilus", "Files", "File Manager", [], ["folder", "explorer"]],
  ["Alacritty", "Alacritty", "Terminal", [], ["shell", "prompt", "command"]],
  ["com.mitchellh.ghostty", "Ghostty", "Terminal", ["New Window"], ["shell", "tty"]],
  ["code", "Visual Studio Code", "Text Editor", ["New Empty Window"], ["vscode", "ide"]],
  ["codium", "VSCodium", "Text Editor", ["New Empty Window"], []],
  ["nvim", "Neovim", "Text Editor", [], ["vim", "editor"]],
  ["org.localsend.localsend_app", "LocalSend", "File Sharing", [], []],
  ["signal", "Signal", "Messenger", [], ["chat"]],
  ["spotify", "Spotify", "Music Player", [], ["music", "audio"]],
  ["obsidian", "Obsidian", "", [], ["notes", "markdown"]],
  ["1password", "1Password", "Password Manager", ["Quick Access"], []],
  ["org.gnome.Calculator", "Calculator", "", [], ["math", "sum"]],
  ["libreoffice-writer", "LibreOffice Writer", "Word Processor", ["New Document"], ["docx", "text"]],
  ["libreoffice-calc", "LibreOffice Calc", "Spreadsheet", ["New Spreadsheet"], ["xlsx", "excel"]],
  ["gimp", "GNU Image Manipulation Program", "Image Editor", [], ["photo", "paint"]],
  ["org.inkscape.Inkscape", "Inkscape", "Vector Graphics Editor", [], ["svg", "draw"]],
  ["vlc", "VLC media player", "Media Player", ["Play an Audio CD", "Open a Disc"], ["video", "movie"]],
  ["mpv", "mpv Media Player", "Multimedia player", [], ["video"]],
  ["org.pipewire.Helvum", "Helvum", "Patchbay", [], ["pipewire", "audio"]],
  ["pavucontrol", "Volume Control", "", [], ["pulseaudio", "sound", "mixer"]],
  ["btop", "btop++", "System Monitor", [], ["top", "cpu"]],
  ["org.gnome.Settings", "Settings", "", [], ["preferences", "control"]],
  ["typora", "Typora", "Markdown Editor", [], []],
  ["zoom", "Zoom", "Video Conference", [], ["meeting"]],
  ["discord", "Discord", "Internet Messenger", [], ["chat", "voice"]],
  ["slack", "Slack", "", [], ["chat", "work"]],
  ["thunderbird", "Thunderbird", "Mail Client", ["Compose New Message", "Contacts"], ["email"]],
  ["org.kde.kdenlive", "Kdenlive", "Video Editor", [], ["edit", "film"]],
  ["obs", "OBS Studio", "Streaming Software", [], ["record", "screencast"]],
  ["steam", "Steam", "", ["Store", "Library", "Friends"], ["games"]],
  ["xournalpp", "Xournal++", "Notetaking", [], ["pdf", "annotate"]],
  ["org.pwmt.zathura", "Zathura", "Document Viewer", [], ["pdf"]],
  ["imv", "imv", "Image Viewer", [], ["picture"]],
  ["dev.zed.Zed", "Zed", "Text Editor", ["New Workspace"], []],
  ["org.gnome.Boxes", "Boxes", "Virtual Machines", [], ["vm", "qemu"]],
  ["virt-manager", "Virtual Machine Manager", "", [], ["vm", "kvm"]],
  ["postman", "Postman", "API Client", [], ["http", "rest"]],
  ["dbeaver", "DBeaver", "Database Tool", [], ["sql"]],
  ["blender", "Blender", "3D modeler", [], ["3d", "render"]],
  ["krita", "Krita", "Digital Painting", [], ["draw"]],
  ["audacity", "Audacity", "Sound Editor", [], ["audio", "record"]],
  ["kitty", "kitty", "Terminal emulator", [], []],
  ["foot", "Foot", "Terminal", ["Foot Server"], []],
  ["wezterm", "WezTerm", "Terminal Emulator", [], []],
  ["org.gnome.TextEditor", "Text Editor", "", ["New Window"], ["notepad", "txt"]],
  ["io.github.celluloid_player.Celluloid", "Celluloid", "Video Player", [], []],
  ["chrome", "Google Chrome", "Web Browser", ["New Window", "New Incognito Window"], []],
  ["teams", "Microsoft Teams", "", [], ["meeting"]],
  ["telegram", "Telegram Desktop", "Messenger", [], ["chat"]],
  ["éditeur", "Éditeur", "", [], []],
  ["cafe", "Café Menu", "", [], []],
]

const apps = NAMES.map(([id, name, generic, actions, keywords]) => ({ id, name, generic, comment: generic ? "" : name + " app", keywords, icon: id,
  wmclass: id === "code" ? "Code" : "", actions: actions.map((n, i) => ({ index: i, name: n })) }))
const launches = { firefox: 12, "com.mitchellh.ghostty": 30, obsidian: 3, code: 1, spotify: 7 }
const pinned = ["obsidian", "firefox", "gone", "spotify"]
const windows = [{ cls: "brave-browser" }, { cls: "Code" }, { cls: "Ghostty" }]

function corpus() {
  const out = ["", " ", "2+2", "15%", "w brave", "W firefox", "  firefox  ", "x", "zz", "xyz", "frfx", "spfy", "chrm", "obsdn", "ghsty", "lbrwrtr", "rfx", "vsc",
    "lo", "lw", "gimp", "image", "pdf", "chat", "terminal", "term", "web browser", "web", "brave new window", "brave new incog", "firefox new private",
    "ghostty new", "code new empty", "libreoffice writer new", "steam lib", "thunderbird compose", "visual studio", "studio code", "vs code", "1pass", "1password",
    "éditeur", "editeur", "café", "cafe", "media", "mpv media", "files", "file", "settings", "set", "zed", "z", "f", "s", "t", "te", "tex", "text e"]
  for (const a of apps) {
    const n = a.name.toLowerCase()
    for (let i = 1; i <= Math.min(n.length, 8); i++) out.push(n.slice(0, i))
    out.push(a.id, a.id.toUpperCase(), n.split(/\s+/).map(w => w[0]).join(""), n.replace(/[aeiou]/g, ""))
    for (const k of a.keywords) out.push(k)
    for (const ac of a.actions) out.push(n.split(" ")[0] + " " + ac.name.toLowerCase().split(" ")[0])
  }
  return [...new Set(out)]
}

const ctx = { apps, launches, pinnedApps: pinned, windows }
const queries = corpus()
const lines = [["apps", apps], ["launches", launches], ["pinned", pinned], ["windows", windows]].map(([key, value]) => JSON.stringify({ id: "d", op: "data", key, value }))
const input = lines.concat(queries.map((query, id) => JSON.stringify({ id, ext: "apps", query }))).join("\n") + "\n"
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l)).slice(lines.length)
const action = a => a ? { kind: a.kind, target: a.target, action: a.action, label: a.label } : null
const fields = r => ({ title: r.title, subtitle: r.subtitle, image: r.image || "", group: r.group || "", appId: r.appId || "", pinned: !!r.pinned, score: r.score || 0, copy: r.copy || "", run: action(r.run) })
let diffs = 0, extra = 0, answered = 0
queries.forEach((q, id) => {
  const js = (q === "" ? Apps.provider.empty(ctx) : Apps.provider.match(q, ctx)).map(fields)
  const rs = (replies[id].rows || []).map(fields)
  if (rs.length) answered++
  const head = JSON.stringify(rs.slice(0, js.length)) === JSON.stringify(js)
  const tail = rs.slice(js.length)
  const lowest = Math.min(...js.filter(r => r.appId).map(r => r.score))
  const ok = head && tail.every(r => r.run && r.run.kind === "app" && r.appId && (!js.length || r.score < lowest))
  if (ok) { if (tail.length) { extra++; if (process.env.SHOW) console.log("  + " + JSON.stringify(q) + " → " + tail.map(r => r.title).join(" | ")) } return }
  if (diffs++ < 10) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js.map(r => r.title + "@" + r.score)) + "\n  rust: " + JSON.stringify(rs.map(r => r.title + "@" + r.score)))
})
console.log((diffs ? "FAIL" : "ok  ") + "  apps: JS and Rust agree on " + (queries.length - diffs) + " of " + queries.length + " queries over " + apps.length + " apps ("
  + answered + " with answers; in " + extra + " Rust adds apps found by their letters in order, below the rest)")
process.exit(diffs ? 1 : 0)
