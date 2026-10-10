import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "lib/Engine.js" as Engine
import "lib/tzcities.js" as Tz
import "lib/Hotkey.js" as Hotkey
import "lib/Geometry.js" as Geometry
import "lib/Extensions.js" as Ext

// Spotlight-style command bar. The UI and the data it needs (config, exchange
// rates, zone offsets) live here; what a query *means* is decided by the
// extensions in extensions/ (and yours), run through lib/Engine.js.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property int selectedIndex: 0
  property var results: []

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginDir: String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")
  readonly property string userConfigPath: home + "/.config/omarchy/extensions/punctum.json"
  readonly property string ratesUrl: "https://open.er-api.com/v6/latest/USD"
  readonly property int ratesMaxBytes: 256 * 1024

  property var defaultConfig: ({})
  property var userConfig: ({})
  property var manifests: []        // the extensions found, validated (lib/Extensions.js)
  // The bar's settings and your file, each extension's section built from its
  // manifest's defaults and yours.
  property var extensionSwitches: ({})   // flipped in ?extensions, kept in the cache
  readonly property var config: Ext.effectiveConfig(defaultConfig, manifests, Ext.withSwitches(userConfig, extensionSwitches))

  property var rates: null          // { rates, updated, next, stale }
  property string ratesStatus: ""
  property real ratesAttemptAt: 0

  property var zones: ({})          // { "Asia/Tokyo": { offset: 540, abbr: "JST" } }
  property real zonesFetchedAt: 0
  property string localZone: ""     // the system's IANA zone, e.g. "Europe/Berlin"

  property var emojis: []           // Omarchy's emojis.json: [{ e, k }]
  property var processes: null      // [{ pid, rss, cpu, name, args }], fetched on demand
  property real processesFetchedAt: 0
  property var apps: []             // [{ id, name, generic, comment, keywords, icon, actions }]
  property var appEntries: ({})     // id -> DesktopEntry, for launching actions
  property var hiddenApps: ({})     // ids Omarchy hides from its own launcher
  property var launches: ({})       // id -> times launched from the bar
  property var windows: []          // [{ address, cls, title, workspace, focus }], taken on open
  property string agent: ""         // Omarchy's default agent: claude, codex, …; "" until one is picked

  // Menu surface tokens, so themes that style the Omarchy menu style this too.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  readonly property int inputFont: Style.font.heading
  property int inputHeight: Math.max(Style.space(38), inputFont + Style.spacing.controlPaddingY * 2)
  property int rowHeight: Math.max(Style.space(48), Style.font.subtitle + Style.font.bodySmall + Style.spacing.md * 2)
  property int heroHeight: Math.max(Style.space(76), Style.font.displayLarge + Style.font.bodySmall + Style.spacing.md * 3)
  property int sectionHeight: Math.max(Style.space(26), Style.font.caption + Style.spacing.md * 2)
  property int footerHeight: Math.max(Style.space(32), Style.font.caption + Style.spacing.md * 2)
  readonly property int tileSize: Math.max(Style.space(30), Style.font.iconLarge + Style.space(12))
  readonly property int tileRadius: root.cornerRadius > 0 ? Style.space(7) : 0
  // Alt+1 … Alt+9 run the first nine results; the ? list doesn't have them.
  readonly property int quickKeys: root.showingHelp ? 0 : 9
  readonly property bool showingHelp: root.rows.length > 0 && !!root.rows[0].help
  readonly property var selectedRow: root.rows[root.selectedIndex] || null
  readonly property bool noResults: root.rows.length === 0 && input.text.trim() !== ""
  property var mode: null           // { label, icon } while a prefix like ":" or "w " is typed
  // Last pointer position in window coordinates. Rows only take the selection
  // on hover when this changes, so a list that grows or scrolls under a
  // resting pointer (the tall ? list) doesn't move the selection.
  property point lastPointer: Qt.point(-1, -1)
  function rowSize(row) {
    return (row.hero ? root.heroHeight : root.rowHeight) + (row.section ? root.sectionHeight : 0)
  }
  readonly property real listHeight: {
    var total = 0
    for (var i = 0; i < root.rows.length; i++) total += root.rowSize(root.rows[i])
    // The ? list may grow to fit; results stop at the height you sized the card to.
    return Math.min(total, root.showingHelp ? Math.max(panel.height * 0.6, root.geometry.listHeight) : root.geometry.listHeight)
  }
  readonly property int cardWidth: Math.round(root.geometry.width)

  // ---------------------------------------------------------------- position and size

  // Drag the card by its edges, footer or the space around the search field;
  // resize it from the grip in its bottom-right corner. Where you leave it is
  // saved (cache geometry.json) and used from then on; "Reset command bar
  // position" goes back to the "window" section of the config.
  property var savedGeometry: null
  property var liveGeometry: null     // while a drag or resize is under way
  readonly property var geometry: Geometry.clamp(
    root.liveGeometry || Geometry.merge(root.savedGeometry, Geometry.defaults(root.config.window, root.rowHeight)),
    Math.max(1, panel.width), Math.max(1, panel.height), Style.gapsOut, 0)

  function loadGeometry(text) {
    try { var g = JSON.parse(text); if (g && typeof g === "object") root.savedGeometry = g } catch (e) {}
  }

  function saveGeometry() {
    if (!root.liveGeometry) return
    var g = root.geometry
    root.savedGeometry = { cx: g.cx, top: g.top, width: Math.round(g.width), listHeight: Math.round(g.listHeight) }
    root.liveGeometry = null
    root.cacheWrite("geometry.json", JSON.stringify(root.savedGeometry))
  }

  function resetGeometry() {
    root.savedGeometry = null
    root.liveGeometry = null
    root.cacheWrite("geometry.json", "{}")
  }

  // ---------------------------------------------------------------- frosted glass

  // The card is drawn in the theme's own menu colour at "glass.opacity" and
  // Hyprland blurs what's behind it (a layer rule set at runtime, like the
  // hotkey). Blur needs decoration.blur.enabled in your Hyprland config.
  readonly property bool glassOn: !root.config.glass || root.config.glass.enabled !== false
  readonly property var glassLevels: Geometry.glass(Color.menu.scrim.a,
    root.glassOn ? Number((root.config.glass && root.config.glass.opacity) || 0.78) : 1)

  function applyLayerRule() {
    Quickshell.execDetached(["hyprctl", "eval",
      'hl.layer_rule({ name = "punctum-glass", match = { namespace = "^punctum$" }, blur = '
      + (root.glassOn ? "true" : "false") + ", ignore_alpha = " + root.glassLevels.ignoreAlpha + " })"])
  }

  onGlassLevelsChanged: layerRuleDebounce.restart()
  onGlassOnChanged: layerRuleDebounce.restart()
  Timer { id: layerRuleDebounce; interval: 300; onTriggered: root.applyLayerRule() }

  // Nothing is listed until there's a query, so an empty bar is just the input.
  readonly property var rows: results

  // ---------------------------------------------------------------- lifecycle

  // payloadJson may carry a starting query, so a keybind or script can open
  // the bar in a mode: '{"query": ":"}' for emoji, '{"query": "kill "}'.
  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") || {} } catch (e) {}
    if (typeof payload.query === "string") {
      input.text = payload.query
      input.cursorPosition = payload.query.length
    }
    root.opened = true
    root.selectedIndex = 0
    root.lastPointer = Qt.point(-1, -1)
    root.refreshZones()
    root.refreshWindows()
    root.refreshAgent()   // picked up when it changes, even after the shell started
    root.startNative()    // one installed since the bar last looked
    root.recompute()   // the kept query may be time-sensitive ("time", "3pm to tokyo")
    // Like Spotlight: the last query comes back selected, so typing replaces it
    // and an arrow key keeps it.
    var given = typeof payload.query === "string"
    Qt.callLater(function() { input.forceActiveFocus(); if (!given) input.selectAll() })
  }

  function close() {
    root.opened = false
    root.saveLastQuery()
    root.forget()
  }

  // What was read while the bar was open (clipboard history, file listings,
  // the rows built from them) goes when it closes.
  function forget() {
    root.search = null
    // A process's StdioCollector keeps the last output it read (file lines,
    // the clipboard history) until the next run, so each runner is given a
    // run of `true`, whose empty output replaces it. A search key of ""
    // files its output nowhere.
    root.searchWantKey = ""
    root.searchOpts = ({})
    root.searchQueue = [["true"]]
    if (searchProc.running) searchProc.signal(15)
    else root.startSearch()
    // Loads read for this open go, queued ones too; ones kept on a timer
    // (keybindings) stay.
    var kept = {}
    for (var k in root.loadCache) {
      if (root.loadCache[k].keep) kept[k] = root.loadCache[k]
      else if (root.loadCache[k].native) root.pushNativeLoad(k, null)
    }
    root.loadCache = kept
    // punctumd's answers too: they hold clipboard texts and package lists.
    root.dropNativeSearches()
    root.nativeCache = ({})
    root.nativePending = ({})
    root.loadQueue = root.loadQueue.filter(function(j) { return j.keep })
    var still = {}
    for (var q = 0; q < root.loadQueue.length; q++) still[root.loadQueue[q].key] = true
    if (root.loadCurrent && root.loadCurrent.keep) still[root.loadCurrent.key] = true
    root.loading = still
    root.loadQueue.push({ key: "", argv: ["true"], keep: false, flush: true, generation: -1 })
    if (!loadProc.running) root.loadNext()
    root.loadGeneration++
    Engine.forget()
    // Rows hold clipboard texts and file paths; a kept query is recomputed
    // from scratch on the next open.
    root.results = []
  }

  function dismiss() {
    root.opened = false
    root.saveLastQuery()
    root.forget()
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide(root.pluginId)
  }

  // After an action (open, run, copy) the bar starts empty next time; only a
  // plain close (Esc, clicking outside) keeps the query for later.
  function finish() {
    input.text = ""
    root.selectedIndex = 0
    root.dismiss()
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  // ---------------------------------------------------------------- queries

  function recompute() {
    root.results = Engine.run(input.text, root.config, {
      rates: root.rates,
      ratesStatus: root.ratesStatus,
      zones: root.zones,
      localZone: root.localZone,
      emojis: root.emojis,
      processes: root.processes,
      apps: root.apps,
      windows: root.windows,
      launches: root.launches,
      agent: root.agent,
      search: root.search,
      sandboxHelper: root.pluginDir + "/bin/punctum-sandbox",
      pinnedApps: root.pinnedApps,
      home: root.home,
      omarchyPath: root.omarchyPath,
      requestProcesses: root.requestProcesses,
      requestRates: root.refreshRates,
      requestSearch: root.requestSearch,
      cached: root.cached,
      requestLoad: root.requestLoad,
      requestJob: root.requestJob,
      native: root.native,
      nativeSearch: root.pushNativeSearch
    })
    root.mode = Engine.mode(input.text, root.config)
    if (root.selectedIndex >= root.rows.length) root.selectedIndex = Math.max(0, root.rows.length - 1)
    if (root.rows.length > 0) list.positionViewAtIndex(root.selectedIndex, ListView.Contain)
  }

  function move(delta) {
    var n = root.rows.length
    if (n === 0) return
    root.selectedIndex = (root.selectedIndex + delta + n) % n
    list.positionViewAtIndex(root.selectedIndex, ListView.Contain)
  }

  function complete(row) {
    var text = row.complete
    if (!text) return false
    input.text = text
    // Example-style commands ("12*8 + 15%") come in selected, so the answer
    // shows right away and typing replaces it; mode prefixes (":", "kill ")
    // leave the cursor at the end.
    if (row.select) input.selectAll()
    else input.cursorPosition = text.length
    root.selectedIndex = 0
    return true
  }

  function activate(index) {
    var row = root.rows[index]
    if (!row) return
    // Switching an extension keeps the bar open on the list.
    if (row.run && row.run.kind === "toggle-extension") { root.perform(row.run); return }
    if (row.run) {
      root.finish()
      root.perform(row.run)
      return
    }
    if (row.complete && !row.copy) { root.complete(row); return }
    if (!row.copy) return
    root.finish()
    root.copyText(row.copy)
  }

  // Shift+Enter: the row's second action (copy instead of paste, a terminal
  // in a file's folder). Rows without one do what Enter does.
  function activateAlt(index) {
    var row = root.rows[index]
    if (!row) return
    if (!row.alt) { root.activate(index); return }
    root.finish()
    root.perform(row.alt)
  }

  // "shell" (your keyword commands: typed text as $1) and "run" (fixed
  // strings built by providers, such as the emoji insert) reach bash; every
  // other kind is an argument list or stdin. An unknown kind does nothing.
  function perform(run) {
    if (run.kind === "app") root.launchApp(run.target, run.action)
    else if (run.kind === "window") root.focusWindow(run.target)
    else if (run.kind === "open") Quickshell.execDetached([root.pluginDir + "/bin/punctum-open", String(run.target)])
    else if (run.kind === "agent") Quickshell.execDetached([root.pluginDir + "/bin/punctum-agent", run.target])
    else if (run.kind === "argv" && Array.isArray(run.target) && run.target.length > 0 && typeof run.input === "string") root.runWithInput(run.target.map(String), run.input)
    else if (run.kind === "argv" && Array.isArray(run.target) && run.target.length > 0) Quickshell.execDetached(run.target.map(String))
    else if (run.kind === "copy") root.copyText(run.target)
    else if (run.kind === "paste") root.copyText(run.target, true)
    else if (run.kind === "note") root.addNote(run.path, run.target)
    else if (run.kind === "edit") Quickshell.execDetached([root.pluginDir + "/bin/punctum-edit", String(run.line), String(run.target)])
    else if (run.kind === "reset-geometry") root.resetGeometry()
    else if (run.kind === "toggle-extension") root.switchExtension(String(run.target), !!run.on)
    else if (run.kind === "reset-switches") root.saveSwitches({})
    else if (run.kind === "open-settings") Quickshell.execDetached([root.pluginDir + "/bin/punctum-edit", "1", root.userConfigPath])
    else if (run.kind === "shell") Quickshell.execDetached(["bash", "-c", run.target, "punctum", String(run.arg)])
    else if (run.kind === "run") Quickshell.execDetached(["bash", "-c", run.target])
    else console.warn("punctum: unknown action kind " + run.kind)
  }

  // Alt+P on an app row pins or unpins it. The list starts as "apps.pinned"
  // from the config and, once changed here, lives in the cache.
  function togglePin(index) {
    var row = root.rows[index]
    if (!row || !row.appId) return
    var next = root.pinnedApps.slice()
    var at = next.indexOf(row.appId)
    if (at >= 0) next.splice(at, 1)
    else next.push(row.appId)
    root.pinnedOverride = next
    root.cacheWrite("pinned-apps.json", JSON.stringify(next))
    root.recompute()
  }

  // The text goes to wl-copy on stdin, never on a command line, where any
  // process could read it from /proc and a long one would hit ARG_MAX.
  property var copyQueue: []

  // paste: once wl-copy holds the text, Shift+Insert types it into the window
  // that had focus before the bar, as Omarchy's own clipboard paste does.
  function copyText(text, paste) {
    root.copyQueue.push({ text: String(text), paste: !!paste })
    if (!copyProc.running) root.copyNext()
  }

  // The item leaves the queue as its wl-copy starts, so one that never
  // starts can't sit at the head and put every later copy one behind.
  property var copyCurrent: null

  function copyNext() {
    if (root.copyQueue.length === 0) return
    root.copyCurrent = root.copyQueue.shift()
    copyProc.stdinEnabled = true
    copyProc.running = true
  }

  property bool copyPaste: false

  Process {
    id: copyProc
    command: ["wl-copy"]
    onStarted: {
      var next = root.copyCurrent
      root.copyCurrent = null
      if (!next) { copyProc.stdinEnabled = false; return }
      root.copyPaste = next.paste
      copyProc.write(next.text)
      copyProc.stdinEnabled = false
    }
    onExited: function(exitCode) {
      if (exitCode === 0 && root.copyPaste)
        Quickshell.execDetached(["bash", "-c", "sleep 0.15; wtype -M shift -k Insert -m shift"])
      root.copyPaste = false
      root.copyNext()
    }
  }

  // An argv action with "input": the text goes to the command's stdin, never
  // its arguments (a reminder's message, for one). One at a time.
  property var inputQueue: []
  property var inputCurrent: null

  function runWithInput(argv, input) {
    root.inputQueue.push({ argv: argv, input: String(input) })
    if (!inputProc.running) root.inputNext()
  }

  function inputNext() {
    if (root.inputQueue.length === 0) return
    root.inputCurrent = root.inputQueue.shift()
    inputProc.command = root.inputCurrent.argv
    inputProc.stdinEnabled = true
    inputProc.didStart = false
    inputProc.running = true
  }

  Process {
    id: inputProc
    property bool didStart: false
    onRunningChanged: if (!running && !didStart) Qt.callLater(function() {
      if (inputProc.running || inputProc.didStart || !root.inputCurrent) return
      Quickshell.execDetached(["notify-send", "-a", "Punctum", "Couldn't run " + String(root.inputCurrent.argv[0]).split("/").pop()])
      root.inputCurrent = null
      root.inputNext()
    })
    onStarted: {
      inputProc.didStart = true
      var job = root.inputCurrent
      if (job) inputProc.write(job.input)
      inputProc.stdinEnabled = false
    }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") console.warn("punctum: " + text.trim().slice(0, 300))
    }
    onExited: { root.inputCurrent = null; root.inputNext() }
  }

  // ---------------------------------------------------------------- inbox note

  // bin/punctum-note appends the line, which it reads from stdin. One at a
  // time; a note added while one is being written waits its turn.
  property var noteQueue: []
  property var noteCurrent: null

  function addNote(path, line) {
    root.noteQueue.push({ path: String(path), line: String(line) })
    if (!noteProc.running) root.noteNext()
  }

  function noteNext() {
    if (root.noteQueue.length === 0) return
    root.noteCurrent = root.noteQueue.shift()
    noteProc.command = ["python3", "-I", root.pluginDir + "/bin/punctum-note", root.noteCurrent.path]
    noteProc.stdinEnabled = true
    noteProc.running = true
  }

  Process {
    id: noteProc
    onStarted: {
      noteProc.write(root.noteCurrent ? root.noteCurrent.line : "")
      noteProc.stdinEnabled = false
    }
    stderr: StdioCollector { id: noteErr; waitForEnd: true }
    onExited: function(exitCode) {
      var done = root.noteCurrent
      root.noteCurrent = null
      var name = done ? done.path.split("/").pop() : "the inbox"
      if (exitCode === 0)
        Quickshell.execDetached(["omarchy-notification-send", "-g", "󰎞", "-t", "2500", "Noted", "Added to " + name])
      else
        Quickshell.execDetached(["omarchy-notification-send", "-g", "󰎞", "-u", "critical", "Note not saved",
          (String(noteErr.text || "").trim() || "punctum-note failed").slice(0, 200)])
      root.noteNext()
    }
  }

  // ---------------------------------------------------------------- pinned apps

  property var pinnedOverride: null   // the cached list, once you've pinned from the bar
  readonly property var pinnedApps: {
    if (Array.isArray(root.pinnedOverride)) return root.pinnedOverride
    var fromConfig = root.config.apps && root.config.apps.pinned
    return Array.isArray(fromConfig) ? fromConfig.filter(function(x) { return typeof x === "string" }) : []
  }

  function loadPinned(text) {
    if (!text) return
    try {
      var data = JSON.parse(text)
      if (Array.isArray(data)) root.pinnedOverride = data.filter(function(x) { return typeof x === "string" }).slice(0, 50)
    } catch (e) {}
  }

  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy"   // the shell sets this too

  // ---------------------------------------------------------------- background work

  // Extensions never start processes themselves; they ask for these (through
  // ctx, with keys prefixed by their id, see lib/Engine.js), and the bar runs
  // them as argument lists.

  // Searches: one at a time, shared by every extension (only one mode is on
  // screen). A search is a list of argument lists run in turn, each landing
  // as its own chunk; a newer key stops the one running, and when that has
  // exited the newest wanted search starts, so old output is never filed
  // under a new key. Each command is stopped after its timeout (3 s), and
  // what it wrote by then is used, marked as cut short.
  property var search: null           // { key, chunks, text, timedOut, done }
  property string searchWantKey: ""
  property var searchQueue: []
  property var searchOpts: ({})
  property bool searchStreamDone: true
  property bool searchExited: true

  function requestSearch(key, argvs, opts) {
    if (root.searchWantKey === key) return
    root.searchWantKey = key
    root.searchQueue = (argvs || []).filter(function(a) { return Array.isArray(a) && a.length > 0 })
    root.searchOpts = opts || {}
    if (searchProc.running) searchProc.signal(15)
    else root.startSearch()
  }

  function startSearch() {
    if (root.searchQueue.length === 0 || !root.searchStreamDone || !root.searchExited) return
    root.searchStreamDone = false
    root.searchExited = false
    searchProc.forKey = root.searchWantKey
    searchProc.timedOut = false
    searchProc.input = typeof root.searchOpts.stdin === "string" ? root.searchOpts.stdin : null
    searchProc.command = root.searchQueue[0].map(String)
    root.searchQueue = root.searchQueue.slice(1)
    searchProc.stdinEnabled = searchProc.input !== null
    searchProc.didStart = false
    searchProc.running = true
    searchWatchdog.interval = Math.max(500, Math.min(30000, Number(root.searchOpts.timeout) || 3000))
    searchWatchdog.restart()
  }

  Process {
    id: searchProc
    property string forKey: ""
    property bool timedOut: false
    property var input: null
    property bool didStart: false
    // A command that can't start (not executable, not installed) gets no
    // exited or streamFinished from Quickshell, only running going false.
    // Without this, every later search would wait for it for ever.
    onRunningChanged: if (!running && !didStart) Qt.callLater(root.searchFailedToStart)
    onStarted: {
      searchProc.didStart = true
      if (searchProc.input === null) return
      searchProc.write(searchProc.input)
      searchProc.input = null
      searchProc.stdinEnabled = false   // closing stdin lets the command see the end
    }
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.searchStreamDone = true
        if (root.opened && searchProc.forKey !== "" && searchProc.forKey === root.searchWantKey) {
          var prev = root.search && root.search.key === searchProc.forKey ? root.search : null
          var chunks = (prev ? prev.chunks : []).concat([String(text || "")])
          root.search = { key: searchProc.forKey, chunks: chunks, text: chunks.join(""),
                          timedOut: (prev && prev.timedOut) || searchProc.timedOut, done: root.searchQueue.length === 0 }
          root.recompute()
        }
        root.startSearch()
      }
    }
    stderr: StdioCollector { id: searchErr; waitForEnd: true }
    onExited: function(exitCode) {
      searchWatchdog.stop()
      root.searchExited = true
      // A command that ran but failed (a sandboxed script whose interpreter
      // isn't inside the sandbox, a refused sandbox path) prints nothing and
      // exits non-zero: say so, with its first error line, rather than
      // "Nothing found".
      var s = root.search
      if (exitCode !== 0 && !searchProc.timedOut && s && s.key === searchProc.forKey && s.key === root.searchWantKey && !String(s.text || "").trim()) {
        var line = String(searchErr.text || "").split("\n").filter(function(l) { return l.trim() })[0] || ("exit " + exitCode)
        root.search = Object.assign({}, s, { failed: true, error: line.slice(0, 200) })
        if (root.opened) root.recompute()
      }
      root.startSearch()
    }
  }

  function searchFailedToStart() {
    if (searchProc.running || searchProc.didStart || root.searchExited) return
    searchWatchdog.stop()
    root.searchExited = true
    root.searchStreamDone = true
    if (root.opened && searchProc.forKey !== "" && searchProc.forKey === root.searchWantKey) {
      console.warn("punctum: couldn't start " + JSON.stringify(searchProc.command))
      root.search = { key: searchProc.forKey, chunks: [""], text: "", timedOut: false, failed: true, done: true }
      root.searchQueue = []
      root.recompute()
    }
    root.startSearch()
  }

  Timer { id: searchWatchdog; interval: 3000; onTriggered: if (searchProc.running) { searchProc.timedOut = true; searchProc.signal(15) } }

  // Loads: text read once per open (the package list, clipboard history), or
  // kept and re-read every ttl ms (keybindings). One at a time. A load that
  // lands after the bar closed is dropped unless it is kept, so what was read
  // for one open isn't held until the next.
  property var loadCache: ({})        // key -> { text, at, keep }
  property var loadQueue: []
  property var loading: ({})
  property int loadGeneration: 0

  function cached(key) {
    var e = root.loadCache[key]
    return e ? e.text : null
  }

  function requestLoad(key, argv, opts) {
    if (!Array.isArray(argv) || argv.length === 0 || root.loading[key]) return
    var ttl = Number(opts && opts.ttl) || 0
    var native = !!(opts && opts.native)
    var e = root.loadCache[key]
    if (e && (ttl <= 0 || Date.now() - e.at < ttl)) {
      // Read for an extension's JS fallback (before punctumd said hello),
      // and now wanted by its native self: punctumd hasn't seen it yet.
      if (native && !e.native) {
        var next = Object.assign({}, root.loadCache)
        next[key] = Object.assign({}, e, { native: true })
        root.loadCache = next
        root.pushNativeLoad(key, e.text)
      }
      return
    }
    root.loading[key] = true
    var keep = ttl > 0 && !(opts && opts.keep === false)
    root.loadQueue.push({ key: key, argv: argv.map(String), keep: keep, native: native, generation: root.loadGeneration })
    if (!loadProc.running) root.loadNext()
  }

  property var loadCurrent: null

  function loadNext() {
    if (root.loadQueue.length === 0) return
    root.loadCurrent = root.loadQueue.shift()
    loadProc.command = root.loadCurrent.argv
    loadProc.didStart = false
    loadProc.running = true
    loadWatchdog.restart()
  }

  Process {
    id: loadProc
    property bool didStart: false
    onStarted: loadProc.didStart = true
    onRunningChanged: if (!running && !didStart) Qt.callLater(root.loadFailedToStart)
    stdout: StdioCollector {
      id: loadOut
      waitForEnd: true
    }
    onExited: {
      loadWatchdog.stop()
      var job = root.loadCurrent
      root.loadCurrent = null
      if (job && job.flush) job = null
      if (job && !job.keep && job.generation !== root.loadGeneration) {
        // Read for an earlier open: dropped, and the current open asks again.
        delete root.loading[job.key]
        job = null
        if (root.opened) root.recompute()
      }
      if (job) {
        delete root.loading[job.key]
        var text = String(loadOut.text || "")
        var old = root.loadCache[job.key]
        // A failed re-read of something kept (empty output) keeps the old text.
        if (job.keep || job.generation === root.loadGeneration) {
          var next = Object.assign({}, root.loadCache)
          var kept = (!text.trim() && old && job.keep) ? old.text : text
          next[job.key] = { text: kept, at: Date.now(), keep: job.keep, native: job.native }
          root.loadCache = next
          // A native extension's load goes to punctumd, unless a re-read
          // found the same text.
          if (job.native && !(old && old.text === kept)) root.pushNativeLoad(job.key, kept)
          if (root.opened) root.recompute()
        }
      }
      root.loadNext()
    }
  }

  function loadFailedToStart() {
    if (loadProc.running || loadProc.didStart || !root.loadCurrent) return
    loadWatchdog.stop()
    var job = root.loadCurrent
    root.loadCurrent = null
    if (!job.flush) {
      console.warn("punctum: couldn't start " + JSON.stringify(job.argv))
      delete root.loading[job.key]
      var next = Object.assign({}, root.loadCache)
      next[job.key] = { text: "", at: Date.now(), keep: job.keep, native: job.native, failed: true }
      root.loadCache = next
      if (job.native) root.pushNativeLoad(job.key, "")
      if (root.opened) root.recompute()
    }
    root.loadNext()
  }

  Timer { id: loadWatchdog; interval: 5000; onTriggered: if (loadProc.running) loadProc.signal(15) }

  // Jobs: background work an extension needs now and then (Everywhere's index
  // of your home folder), at most every `every` seconds, one at a time. With
  // rerun, the extension's search runs again when the job finishes.
  property var jobAt: ({})
  property var jobQueue: []
  property var jobCurrent: null

  function requestJob(key, argv, opts, prefix) {
    if (!Array.isArray(argv) || argv.length === 0) return
    var every = Math.max(5, Number(opts && opts.every) || 60) * 1000
    if (Date.now() - (root.jobAt[key] || 0) < every) return
    root.jobAt[key] = Date.now()
    root.jobQueue.push({ key: key, argv: argv.map(String), rerun: !!(opts && opts.rerun), prefix: String(prefix || "") })
    if (!jobProc.running) root.jobNext()
  }

  function jobNext() {
    if (root.jobQueue.length === 0) return
    root.jobCurrent = root.jobQueue.shift()
    jobProc.command = root.jobCurrent.argv
    jobProc.didStart = false
    jobProc.running = true
  }

  Process {
    id: jobProc
    property bool didStart: false
    onStarted: jobProc.didStart = true
    onRunningChanged: if (!running && !didStart) Qt.callLater(function() {
      if (jobProc.running || jobProc.didStart || !root.jobCurrent) return
      console.warn("punctum: couldn't start job " + JSON.stringify(root.jobCurrent.argv))
      root.jobCurrent = null
      root.jobNext()
    })
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") console.warn("punctum: job: " + text.trim().slice(0, 300))
    }
    onExited: {
      var job = root.jobCurrent
      root.jobCurrent = null
      if (job) {
        root.jobAt[job.key] = Date.now()   // a slow job doesn't start again straight away
        // The search usually landed first; dropping it makes the same query
        // ask again, against what the job produced.
        if (job.rerun && root.opened && job.prefix && root.searchWantKey.indexOf(job.prefix) === 0) {
          root.searchWantKey = ""
          root.search = null
          root.recompute()
        }
      }
      root.jobNext()
    }
  }

  // ---------------------------------------------------------------- extension switches

  // Enter on an extension in ?extensions switches it. The switch lives in the
  // bar's cache (extension-switches.json), never in your config file, and is
  // laid over it; "Reset extension switches" drops them all.
  function switchExtension(id, on) {
    // Turning on a WebAssembly extension approves the module and manifest
    // you see in ?extensions: their SHA-256s are kept, and a change to
    // either turns it off again until you look.
    var m = root.manifests.filter(function(x) { return x.id === id })[0]
    if (on && m && m.type === "wasm") {
      var trust = Object.assign({}, root.wasmTrust)
      trust[id] = { module: m.sha256, manifest: m.manifestSha256 }
      root.wasmTrust = trust
      Ext.setWasmTrust(trust)
      root.cacheWrite("wasm-trust.json", JSON.stringify(trust))
    }
    var next = Object.assign({}, root.extensionSwitches)
    next[id] = on
    root.saveSwitches(next)
  }

  property bool switchesTouched: false

  function saveSwitches(next) {
    root.switchesTouched = true
    root.extensionSwitches = next
    Engine.setExtensionSwitches(next)
    root.cacheWrite("extension-switches.json", JSON.stringify(next))
    root.syncWasm()
    if (root.opened) root.recompute()
  }

  property var wasmTrust: ({})
  property bool wasmTrustRead: false

  function loadWasmTrust(text) {
    var data = {}
    try { data = JSON.parse(text || "{}") || {} } catch (e) {}
    var next = {}
    if (data && typeof data === "object" && !Array.isArray(data))
      for (var id in data) {
        var t = data[id]
        if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) && t && /^[0-9a-f]{64}$/.test(String(t.module)) && /^([0-9a-f]{64})?$/.test(String(t.manifest)))
          next[id] = { module: t.module, manifest: t.manifest }
      }
    // An approval given before this read returned wins.
    for (var k in root.wasmTrust) next[k] = root.wasmTrust[k]
    root.wasmTrust = next
    root.wasmTrustRead = true
    Ext.setWasmTrust(next)
    root.syncWasm()
    if (root.opened) root.recompute()
  }

  function loadSwitches(text) {
    // A switch flipped before the startup read returned wins over the file.
    if (root.switchesTouched) return
    var data = {}
    try { data = JSON.parse(text || "{}") || {} } catch (e) {}
    var next = {}
    if (data && typeof data === "object" && !Array.isArray(data))
      for (var id in data) if (typeof data[id] === "boolean" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) next[id] = data[id]
    root.extensionSwitches = next
    Engine.setExtensionSwitches(next)
  }

  // ---------------------------------------------------------------- extensions

  // Found by bin/punctum-extensions (bundled ones, then yours from
  // ~/.config/omarchy/punctum/extensions/), validated by lib/Extensions.js,
  // and loaded: a js extension's provider file through a small QML object
  // made at run time (QML can't import a path chosen at run time any other
  // way), a script extension wrapped by Ext.scriptProvider, a native one by
  // Ext.nativeProvider when punctumd serves it and from its JS fallback when
  // it doesn't. Found again at startup, whenever your config changes, and
  // when punctumd starts or stops.
  readonly property string userExtensionsDir: root.home + "/.config/omarchy/punctum/extensions"
  property var extensionObjects: []

  function discoverExtensions() {
    if (!extensionsProc.running) extensionsProc.running = true
  }

  function fileUrl(path) {
    return "file://" + String(path).split("/").map(encodeURIComponent).join("/")
  }

  property string extensionsText: ""   // bin/punctum-extensions' last answer

  function installExtensions(text) {
    root.extensionsText = text
    var found = []
    try { found = JSON.parse(text) } catch (e) { console.warn("punctum: couldn't list extensions: " + e) }
    var refused = []
    found = (Array.isArray(found) ? found : []).filter(function(f) {
      if (f && f.error) { refused.push({ dir: String(f.dir || ""), error: String(f.error) }); return false }
      return f && typeof f.manifest === "string"
    })
    var got = Ext.collect(found)
    for (var o = 0; o < root.extensionObjects.length; o++) root.extensionObjects[o].destroy()
    var objects = [], entries = [], errors = refused.concat(got.errors)
    for (var i = 0; i < got.list.length; i++) {
      var m = got.list[i]
      if (m.type === "script") { entries.push({ provider: Ext.scriptProvider(m), manifest: m }); continue }
      if (m.type === "wasm") { entries.push({ provider: Ext.nativeProvider(m), manifest: m }); continue }
      if (m.type === "native") {
        m.runtime = root.nativeServed[m.id] ? "punctumd" : "js"
        if (m.runtime === "punctumd") { entries.push({ provider: Ext.nativeProvider(m), manifest: m }); continue }
        if (!m.entry) { errors.push({ dir: m.dir, error: "needs punctumd, which isn't running" }); continue }
      }
      try {
        // m.entry is checked to be a plain file name ending in .js.
        var obj = Qt.createQmlObject('import QtQuick\nimport "' + m.entry + '" as Impl\nQtObject { readonly property var provider: Impl.provider }',
                                     root, root.fileUrl(m.dir + "/Extension.qml"))
        objects.push(obj)
        if (!obj.provider || obj.provider.id !== m.id) { errors.push({ dir: m.dir, error: "its provider's id isn't \"" + m.id + "\"" }); continue }
        entries.push({ provider: obj.provider, manifest: m })
      } catch (e) {
        errors.push({ dir: m.dir, error: "didn't load: " + String(e && e.qmlErrors ? e.qmlErrors.map(function(q) { return q.message }).join("; ") : e) })
      }
    }
    for (var j = 0; j < errors.length; j++) console.warn("punctum: extension " + errors[j].dir + ": " + errors[j].error)
    root.extensionObjects = objects
    Engine.setProviders(entries)
    Engine.setExtensionErrors(errors)
    root.manifests = got.list
    root.syncWasm()
    if (root.opened) root.recompute()
  }

  Process {
    id: extensionsProc
    command: ["python3", root.pluginDir + "/bin/punctum-extensions", root.pluginDir + "/extensions", root.userExtensionsDir]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.installExtensions(String(text || ""))
    }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") console.warn("punctum: extensions: " + text.trim().slice(0, 300))
    }
  }

  onUserConfigChanged: root.discoverExtensions()

  // ---------------------------------------------------------------- punctumd

  // The native extensions (docs/native.md) live in punctumd, a Rust daemon the
  // bar keeps running beside it and talks to over stdin and stdout, one JSON
  // object per line. It's found as bin/punctumd in the plugin folder, then a
  // cargo build's target/release/punctumd, then punctumd on PATH. When it
  // isn't there or stops, native extensions fall back to their JS providers.
  // It's started again when it stops, so a rebuilt one is picked up by
  // `pkill -x punctumd`, without restarting the shell.
  property var nativeServed: ({})     // id -> true, from its hello
  property var nativeCache: ({})      // id + "\n" + query -> { rows, needs, until, stale }
  property var nativePending: ({})    // id + "\n" + query -> the id of the request asking it now
  property int nativeSeq: 0
  property bool nativeHelloed: false
  property int nativeCached: 0
  property int nativeFailures: 0      // starts in a row without a hello
  property string nativeVersion: ""

  // Started at startup, when it stops (see onExited), and on each open while
  // it isn't running, so one built or installed since is picked up. With none
  // installed that's one bash that finds nothing, per open.
  function startNative() {
    if (nativeProc.running || nativeRestart.running) return
    root.nativeFailures = 0
    nativeProc.running = true
  }

  // What ?extensions says about punctumd, and what it offers: built here,
  // downloaded and checked, or removed, each in a terminal through
  // bin/punctum-native, which shows what it does and asks first.
  function refreshNativeStatus() {
    if (!nativeStatusProc.running) nativeStatusProc.running = true
  }

  function nativeTerminal(cmd) {
    return ["uwsm-app", "--", "xdg-terminal-exec", "--app-id=org.omarchy.terminal", "--title=Punctum native extensions",
            "-e", root.pluginDir + "/bin/punctum-native", cmd]
  }

  function publishNativeStatus(text) {
    var s = {}
    try { s = JSON.parse(String(text || "").trim() || "{}") || {} } catch (e) { s = {} }
    Engine.setNativeStatus({
      running: Object.keys(root.nativeServed).length > 0,
      version: root.nativeVersion,
      cargo: s.cargo === true,
      release: s.release === true,
      installed: s.installed === true,
      packaged: typeof s.package === "string" && s.package !== "" && s.package.indexOf(root.pluginDir + "/") !== 0 ? s.package : "",
      build: root.nativeTerminal("build"),
      fetch: root.nativeTerminal("fetch"),
      remove: root.nativeTerminal("remove")
    })
    if (root.opened) root.recompute()
  }

  Process {
    id: nativeStatusProc
    command: [root.pluginDir + "/bin/punctum-native", "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.publishNativeStatus(text)
    }
  }

  // ctx.native: punctumd's answer to this query, { rows, needs }, or null
  // while it works out the first. An answer that has gone stale (a clock, or
  // state or a load sent since) is shown while the fresh one comes, so the
  // list doesn't blank between them.
  //
  // Each request has its own id ("<n>\n<ext>\n<query>"), and only a reply to
  // the latest request for a query counts. The same query asked before and
  // after a load (cb, then the history arrives) would otherwise take the
  // first, stale, reply as the answer to the second, and drop the real one.
  function native(id, query, settings) {
    if (!root.nativeServed[id] || !nativeProc.running) return null
    var key = id + "\n" + query
    var have = root.nativeCache.hasOwnProperty(key) ? root.nativeCache[key] : null
    if (have && !have.stale && (!have.until || have.until > Date.now())) return have
    if (!root.nativePending[key]) {
      var req = (++root.nativeSeq) + "\n" + key
      root.nativePending[key] = req
      nativeProc.write(JSON.stringify({ id: req, ext: id, query: query, settings: settings === undefined ? {} : settings }) + "\n")
    }
    return have
  }

  // Every answer (or one extension's, by its "<ext>\n" prefix) is out of
  // date: kept to show until the fresh one lands, and requests on their way
  // are forgotten, so their replies are dropped.
  function staleNative(prefix) {
    var cache = {}
    for (var c in root.nativeCache) {
      var e = root.nativeCache[c]
      cache[c] = prefix && c.indexOf(prefix) !== 0 ? e : Object.assign({}, e, { stale: true })
    }
    root.nativeCache = cache
    if (!prefix) root.nativePending = ({})
    else for (var p in root.nativePending) if (p.indexOf(prefix) === 0) delete root.nativePending[p]
  }

  // The shell's state a native extension needs (apps, launches, pins,
  // windows), sent when it changes and after each hello. Answers given
  // before, cached or still coming, used the old state: they go stale and
  // the query is asked again, or a reply dropped on its way (opening the bar
  // refreshes the windows) would leave the bar empty until the next key.
  function pushNative(key, value) {
    if (!nativeProc.running || !Object.keys(root.nativeServed).length) return
    root.staleNative("")
    nativeProc.write(JSON.stringify({ id: "data", op: "data", key: key, value: value }) + "\n")
    if (root.opened) Qt.callLater(root.recompute)
  }

  function pushAllNative() {
    root.pushNative("apps", root.apps)
    root.pushNative("launches", root.launches)
    root.pushNative("pinned", root.pinnedApps)
    root.pushNative("windows", root.windows)
    for (var k in root.loadCache) if (root.loadCache[k].native) root.pushNativeLoad(k, root.loadCache[k].text)
  }

  // A load a native extension asked for (its manifest's command, run by
  // the bar), or null when the bar drops it. key is "<ext>\n<load key>".
  // Only that extension's answers are dropped and asked again.
  function pushNativeLoad(key, text) {
    if (!nativeProc.running || !Object.keys(root.nativeServed).length) return
    var at = String(key).indexOf("\n")
    if (at < 0) return
    var ext = key.slice(0, at)
    root.staleNative(ext + "\n")
    nativeProc.write(JSON.stringify({ id: "load", op: "load", ext: ext, key: key.slice(at + 1), text: text }) + "\n")
    if (root.opened) Qt.callLater(root.recompute)
  }

  // WebAssembly extensions (docs/wasm.md) run in punctumd: each one that's on
  // and approved is sent there, once per build and again after punctumd
  // restarts; one switched off or removed is dropped. punctumd answers with
  // the module's SHA-256 when it's running, or why it can't take it.
  property var wasmSent: ({})       // id -> sha256 sent, or "" while it's on its way
  property var wasmErrors: ({})

  function syncWasm() {
    if (!nativeProc.running || !root.nativeHelloed || !root.wasmTrustRead) return
    var want = {}
    Engine.enabledProviders(root.config).forEach(function(p) { want[p.id] = true })
    var sent = Object.assign({}, root.wasmSent), served = Object.assign({}, root.nativeServed)
    root.manifests.forEach(function(m) {
      if (m.type !== "wasm") return
      if (want[m.id] && sent[m.id] !== m.sha256) {
        sent[m.id] = m.sha256
        delete served[m.id]
        nativeProc.write(JSON.stringify({ id: "wasm\n" + m.id, op: "wasm", ext: m.id, module: m.wasmModule, sha256: m.sha256 }) + "\n")
      } else if (!want[m.id] && sent[m.id] !== undefined) {
        delete sent[m.id]
        delete served[m.id]
        nativeProc.write(JSON.stringify({ id: "wasm\n" + m.id, op: "wasm", ext: m.id, module: null }) + "\n")
      }
    })
    for (var id in sent) if (!root.manifests.some(function(m) { return m.id === id && m.type === "wasm" })) {
      delete sent[id]
      delete served[id]
      nativeProc.write(JSON.stringify({ id: "wasm\n" + id, op: "wasm", ext: id, module: null }) + "\n")
    }
    root.wasmSent = sent
    root.nativeServed = served
  }

  function wasmLanded(r) {
    var id = r.id.slice(5)
    var errors = Object.assign({}, root.wasmErrors)
    if (r.ok && r.sha256 && root.wasmSent[id] === r.sha256) {
      delete errors[id]
      var served = Object.assign({}, root.nativeServed)
      served[id] = true
      root.nativeServed = served
      root.staleNative(id + "\n")
    } else if (r.error) {
      errors[id] = String(r.error).slice(0, 200)
      console.warn("punctum: extension " + id + ": " + errors[id])
    }
    root.wasmErrors = errors
    Engine.setWasmErrors(errors)
    if (root.opened) Qt.callLater(root.recompute)
  }

  // A search a native extension asked for (its manifest's "searches", run by
  // the bar's search runner) goes to punctumd as it lands: once per chunk,
  // and when it's done. Only that extension's answers go stale. Dropped when
  // the bar closes, like the search itself.
  property var nativeSearchSent: ({})   // ext -> "<key>\n<chunks>\n<done>"

  function pushNativeSearch(ext, found) {
    if (!nativeProc.running || !root.nativeServed[ext] || !found) return
    var mark = found.key + "\n" + (found.chunks || []).length + "\n" + !!found.done + "\n" + !!found.failed
    if (root.nativeSearchSent[ext] === mark) return
    var sent = Object.assign({}, root.nativeSearchSent)
    sent[ext] = mark
    root.nativeSearchSent = sent
    nativeProc.write(JSON.stringify({ id: "search", op: "search", ext: ext, key: found.key, chunks: found.chunks || [found.text || ""],
                                      done: found.done !== false, timedOut: !!found.timedOut, failed: !!found.failed }) + "\n")
    root.staleNative(ext + "\n")
    if (root.opened) Qt.callLater(root.recompute)
  }

  function dropNativeSearches() {
    for (var ext in root.nativeSearchSent)
      if (nativeProc.running) nativeProc.write(JSON.stringify({ id: "search", op: "search", ext: ext, key: null }) + "\n")
    root.nativeSearchSent = ({})
  }

  onAppsChanged: root.pushNative("apps", root.apps)
  onLaunchesChanged: root.pushNative("launches", root.launches)
  onPinnedAppsChanged: root.pushNative("pinned", root.pinnedApps)
  onWindowsChanged: root.pushNative("windows", root.windows)

  function nativeLanded(line) {
    var r
    try { r = JSON.parse(line) } catch (e) { console.warn("punctum: punctumd: unreadable reply"); return }
    if (!r || typeof r !== "object") return
    if (r.id === "hello") {
      var served = {}
      if (r.protocol === 1 && Array.isArray(r.extensions)) r.extensions.forEach(function(id) { if (typeof id === "string") served[id] = true })
      else console.warn("punctum: punctumd speaks protocol " + r.protocol + ", the bar 1; using JS fallbacks")
      root.nativeFailures = 0
      root.nativeVersion = typeof r.version === "string" ? r.version.slice(0, 32) : ""
      root.nativeServed = served
      root.nativeHelloed = true
      root.wasmSent = ({})
      root.pushAllNative()
      root.syncWasm()
      root.refreshNativeStatus()
      if (root.extensionsText) root.installExtensions(root.extensionsText)
      return
    }
    if (typeof r.id !== "string") return
    if (r.id.indexOf("wasm\n") === 0) { root.wasmLanded(r); return }
    var key = r.id.slice(r.id.indexOf("\n") + 1)
    if (root.nativePending[key] !== r.id) return
    delete root.nativePending[key]
    if (r.error) console.warn("punctum: punctumd: " + String(r.error).slice(0, 300))
    // Answers are kept until the config changes, or for the "ttl" ms an
    // answer that reads the clock gives; a long session's worth is dropped
    // all at once.
    if (++root.nativeCached > 2000) { root.nativeCache = ({}); root.nativeCached = 1 }
    root.nativeCache[key] = Ext.nativeAnswer(r, Date.now())
    if (root.opened) Qt.callLater(root.recompute)
  }

  Process {
    id: nativeProc
    command: ["bash", "-c",
      'for p in "$1/bin/punctumd" "$1/target/release/punctumd"; do [ -x "$p" ] && exec "$p"; done; command -v punctumd >/dev/null || exit 127; exec punctumd',
      "punctumd", root.pluginDir]
    stdinEnabled: true
    onStarted: nativeProc.write(JSON.stringify({ id: "hello", op: "hello" }) + "\n")
    onExited: function(exitCode) {
      var had = Object.keys(root.nativeServed).length > 0
      root.nativeServed = ({})
      root.nativeHelloed = false
      root.wasmSent = ({})
      root.nativeSearchSent = ({})
      root.nativePending = ({})
      root.nativeVersion = ""
      root.refreshNativeStatus()
      if (had && root.extensionsText) root.installExtensions(root.extensionsText)
      // 127: not installed. Anything else is a crash or a kill, so start it
      // again, backing off, and give up after five failures in a row.
      if (exitCode === 127) { if (!had) console.info("punctum: no punctumd; native extensions use their JS fallbacks"); return }
      if (++root.nativeFailures > 5) { console.warn("punctum: punctumd keeps stopping (" + exitCode + "); using JS fallbacks"); return }
      nativeRestart.interval = 500 * Math.pow(2, root.nativeFailures - 1)
      nativeRestart.restart()
    }
    stdout: SplitParser { onRead: function(line) { root.nativeLanded(line) } }
    stderr: SplitParser { onRead: function(line) { console.warn("punctum: punctumd: " + String(line).slice(0, 300)) } }
  }

  Timer {
    id: nativeRestart
    onTriggered: nativeProc.running = true
  }

  // What Enter does to a row, for the footer: "Open", "Switch", "Copy"…
  function actionLabel(row) {
    if (!row) return ""
    if (row.actionLabel) return row.actionLabel
    var label = ""
    if (row.run) label = row.run.label || (row.run.kind === "open" ? "open" : "run")
    else if (row.complete && !row.copy) label = "try it"
    else if (row.copy) label = "copy"
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : ""
  }

  // Tab fills the query in when that's something other than what Enter does.
  function canComplete(row) {
    return !!row && !!row.complete && !!(row.run || row.copy)
  }

  // Inside a help topic ("?units") or a help search, Esc and Backspace go
  // back to the list of topics instead of editing the text.
  readonly property bool inHelpTopic: /^\s*\?\s*\S/.test(input.text)
  function helpBack() {
    input.text = "?"
    input.cursorPosition = 1
    root.selectedIndex = 0
  }

  onConfigChanged: {
    root.nativeCache = ({})   // an extension's settings may have changed
    if (root.opened) root.recompute()
    root.zonesFetchedAt = 0   // the zone list may have changed
    root.ensureHotkey()
  }

  // ---------------------------------------------------------------- hotkey

  // The bar binds its own hotkey in the running Hyprland (hyprctl eval), so
  // installing the plugin is enough: no config file is edited. Hyprland drops
  // runtime binds when its config reloads, so this re-runs after every
  // reload, after config changes, and at startup. lib/Hotkey.js decides what
  // to bind or unbind; a key that something else already uses is left alone.
  // The id comes from the manifest, so a renamed clone binds its own; it goes
  // into a shell command, so anything Omarchy's own plugin tools wouldn't
  // accept (omarchy-plugin-validate's pattern, no "..") falls back.
  readonly property string pluginId: {
    var id = root.manifest && root.manifest.id
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && id.indexOf("..") < 0 ? id : "io.github.mycosavant.punctum"
  }
  readonly property string toggleCommand: "omarchy-shell shell toggle " + root.pluginId
  property bool configsLoaded: false
  property bool hotkeyQueued: false
  property string boundHotkey: ""     // what we bound, so unloading can unbind it
  property string warnedConflict: ""  // notify once per key, not on every reload

  function ensureHotkey() {
    if (!root.configsLoaded) return
    // Wait for the previous bind to land too: reading the binds before it has
    // would see the key as free and bind it a second time.
    if (bindsProc.running || hotkeyEvalProc.running) { root.hotkeyQueued = true; return }
    bindsProc.running = true
  }

  function reconcileHotkey(bindsJson) {
    var hotkey = String(root.config.hotkey || "").trim()
    var p = Hotkey.plan(bindsJson, hotkey, root.toggleCommand)
    if (p.lua.length > 0) { hotkeyEvalProc.command = ["hyprctl", "eval", p.lua.join("\n")]; hotkeyEvalProc.running = true }
    root.boundHotkey = p.bound ? hotkey : ""
    if (p.conflict && root.warnedConflict !== hotkey) {
      root.warnedConflict = hotkey
      console.warn("punctum: " + hotkey + " is already used by \"" + p.conflict + "\"; not binding it")
      Quickshell.execDetached(["notify-send", "-a", "Punctum", "Punctum has no hotkey",
        hotkey + " already opens \"" + p.conflict + "\". Set a different \"hotkey\" in ~/.config/omarchy/extensions/punctum.json."])
    }
    if (!hotkeyEvalProc.running) root.runQueuedHotkey()
  }

  function runQueuedHotkey() {
    if (root.hotkeyQueued) { root.hotkeyQueued = false; root.ensureHotkey() }
  }

  Process {
    id: hotkeyEvalProc
    onExited: root.runQueuedHotkey()
  }

  Process {
    id: bindsProc
    command: ["hyprctl", "binds", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.reconcileHotkey(String(text || ""))
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event && String(event.name) === "configreloaded") { root.ensureHotkey(); layerRuleDebounce.restart() }
    }
  }

  // Unloading (plugin disabled, removed or reloaded) takes the binding with it.
  // A reloaded plugin binds again after the startup delay below.
  Component.onDestruction: {
    var combo = Hotkey.parseCombo(root.boundHotkey)
    if (combo) Quickshell.execDetached(["hyprctl", "eval",
      "hl.unbind(" + Hotkey.luaString(Hotkey.comboString(combo.mask, combo.key)) + ")"])
  }

  // Both config files report in before the first bind, so a user's own
  // "hotkey" is used from the start. The short delay lets a previous
  // instance's unbind land first when the plugin is reloaded.
  property int configLoads: 0
  function configLoaded() {
    root.configLoads++
    if (root.configLoads >= 2 && !root.configsLoaded) { root.configsLoaded = true; hotkeyStartTimer.start() }
  }

  Timer {
    id: hotkeyStartTimer
    interval: 600
    onTriggered: root.ensureHotkey()
  }

  // ---------------------------------------------------------------- config

  FileView {
    path: root.pluginDir + "/config.default.json"
    watchChanges: true
    printErrors: false
    onLoaded: {
      try { root.defaultConfig = Engine.parseJsonc(text()) }
      catch (e) { console.warn("punctum: bad config.default.json: " + e) }
      root.configLoaded()
    }
    onFileChanged: reload()
  }

  FileView {
    path: root.userConfigPath
    watchChanges: true
    printErrors: false
    onLoaded: {
      try { root.userConfig = Engine.parseJsonc(text()) }
      catch (e) { console.warn("punctum: bad " + root.userConfigPath + ": " + e); root.userConfig = ({}) }
      root.configLoaded()
    }
    onLoadFailed: { root.userConfig = ({}); root.configLoaded() }
    onFileChanged: reload()
  }

  // ---------------------------------------------------------------- rates

  // Called by the currency provider (ctx.requestRates) only while a currency
  // query is on screen, so someone who never converts money never contacts
  // the API. open.er-api.com says when its next daily update is, and the
  // cache is refetched only after that. Failed attempts back off for ten
  // minutes; the last good file keeps working offline.
  function refreshRates() {
    if (ratesProc.running) return
    var now = Date.now()
    if (root.rates && root.rates.next && now < root.rates.next * 1000) return
    if (now - root.ratesAttemptAt < 10 * 60 * 1000) return
    root.ratesAttemptAt = now
    if (!root.rates) root.ratesStatus = "Fetching exchange rates…"
    ratesProc.running = true
  }

  function loadRates(raw) {
    try {
      var data = JSON.parse(raw)
      if (data.result !== "success" || !data.rates) throw "unexpected response"
      root.rates = {
        rates: data.rates,
        updated: data.time_last_update_unix,
        next: data.time_next_update_unix,
        stale: Date.now() > (data.time_next_update_unix + 86400) * 1000
      }
      root.ratesStatus = ""
    } catch (e) {
      if (raw) console.warn("punctum: bad rates cache: " + e)
    }
    if (root.opened) root.recompute()
  }

  // ---------------------------------------------------------------- last query

  // Kept in memory between opens (the plugin stays loaded) and written to the
  // cache on close so it also survives a shell restart. Long queries are cut
  // so they stay under the helper's 4 KiB cap.
  property bool lastQueryLoaded: false
  property string savedQuery: ""

  function saveLastQuery() {
    var text = input.text.slice(0, 1000)
    if (!root.lastQueryLoaded || root.savedQuery === text) return
    root.savedQuery = text
    root.cacheWrite("last-query", text)
  }

  function loadLastQuery(text) {
    root.savedQuery = text
    if (!root.lastQueryLoaded && !input.text) input.text = text.replace(/\n+$/, "")
    root.lastQueryLoaded = true
  }

  Process {
    id: ratesProc
    // Size-capped download: curl aborts past the limit and head cuts the stream
    // even without a Content-Length. Only a complete download reaches the
    // helper, which refuses anything over the cap or that isn't JSON, so the
    // last good rates.json stays in place.
    command: ["bash", "-c",
      "set -o pipefail; d=$(curl -fsS --max-time 8 --max-filesize \"$3\" \"$2\" | head -c \"$(($3 + 1))\") " +
      "&& printf '%s' \"$d\" | python3 \"$1\" write rates.json",
      "_", root.cacheHelper, root.ratesUrl, String(root.ratesMaxBytes)]
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.ratesStatus = root.rates ? "" : "Couldn't reach open.er-api.com"
        if (root.opened) root.recompute()
      } else {
        root.cacheRead("rates.json", root.loadRates)
      }
    }
  }

  // ---------------------------------------------------------------- cache files

  // The shell never opens the cache files itself: bin/punctum-cache does
  // every read and write, refusing symlinks, foreign or oversized files, and
  // replacing a file atomically through a private temporary file. Requests run
  // one at a time, in order.
  readonly property string cacheHelper: root.pluginDir + "/bin/punctum-cache"
  property var cacheQueue: []
  property var cacheDone: null

  property var cacheInput: null

  function cacheRead(name, done) {
    root.cacheQueue.push({ command: ["python3", root.cacheHelper, "read", name], input: null, done: done })
    if (!cacheProc.running) root.cacheNext()
  }

  // The content is piped straight to the helper's stdin, never put in its
  // arguments, so it can't be read from /proc/<pid>/cmdline.
  function cacheWrite(name, text) {
    root.cacheQueue.push({ command: ["python3", root.cacheHelper, "write", name], input: text, done: null })
    if (!cacheProc.running) root.cacheNext()
  }

  function cacheNext() {
    if (root.cacheQueue.length === 0) return
    var next = root.cacheQueue.shift()
    root.cacheDone = next.done
    root.cacheInput = next.input
    cacheProc.command = next.command
    cacheProc.stdinEnabled = next.input !== null
    cacheProc.running = true
  }

  Process {
    id: cacheProc
    onStarted: {
      var input = root.cacheInput
      root.cacheInput = null
      if (input === null) return
      cacheProc.write(input)
      // Closing stdin is what lets the helper see the end of the content.
      cacheProc.stdinEnabled = false
    }
    stdout: StdioCollector { id: cacheOut; waitForEnd: true }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") console.warn("punctum: " + text.trim())
    }
    onExited: function(exitCode) {
      var done = root.cacheDone
      root.cacheDone = null
      // A refused or failed read counts as an empty file.
      if (done) done(exitCode === 0 ? String(cacheOut.text || "") : "")
      root.cacheNext()
    }
  }

  // ---------------------------------------------------------------- zones

  function refreshZones() {
    if (root.nativeServed.time) return   // punctumd reads the zones itself
    if (zonesProc.running) return
    if (Date.now() - root.zonesFetchedAt < 60 * 60 * 1000) return
    var t = root.config.time || {}
    var extra = (t.zones || []).concat(t.home ? [t.home] : [])
    // First line reports the system zone ("@local Europe/Berlin"), then one
    // "zone +hhmm ABBR" line per zone, the system zone included.
    zonesProc.command = ["bash", "-c",
      "lz=$(timedatectl show -p Timezone --value 2>/dev/null); "
      + "[ -n \"$lz\" ] || lz=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||'); "
      + "echo \"@local $lz\"; "
      + "for z in \"$@\" $lz; do printf '%s ' \"$z\"; TZ=\"$z\" date +'%z %Z'; done", "_"]
      .concat(Tz.allZones(extra))
    zonesProc.running = true
  }

  Process {
    id: zonesProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var next = {}
        var lines = String(text || "").split("\n")
        for (var i = 0; i < lines.length; i++) {
          var local = lines[i].match(/^@local (\S+)$/)
          if (local) { root.localZone = local[1]; continue }
          var m = lines[i].match(/^(\S+) ([+-])(\d\d)(\d\d) (\S+)$/)
          if (!m) continue
          var minutes = parseInt(m[3], 10) * 60 + parseInt(m[4], 10)
          next[m[1]] = { offset: m[2] === "-" ? -minutes : minutes, abbr: m[5] }
        }
        root.zones = next
        root.zonesFetchedAt = Date.now()
        if (root.opened) root.recompute()
      }
    }
  }

  // ---------------------------------------------------------------- agent

  // Asked of `omarchy-default-agent`, the same answer Omarchy's launcher uses,
  // on every open. The shell never opens the file itself: at most 64 bytes of
  // the answer come back, and providers/ai.js accepts only an agent-like name.
  function refreshAgent() {
    if (!agentProc.running) agentProc.running = true
  }

  Process {
    id: agentProc
    command: ["bash", "-c", "timeout 2 omarchy-default-agent 2>/dev/null | head -c 64"]
    stdout: StdioCollector { id: agentOut; waitForEnd: true }
    onExited: {
      var next = (String(agentOut.text || "").split("\n")[0] || "").trim()
      if (next === root.agent) return
      root.agent = next
      if (root.opened) root.recompute()
    }
  }

  // ---------------------------------------------------------------- emoji

  FileView {
    path: Quickshell.env("OMARCHY_PATH") + "/shell/plugins/emojis/emojis.json"
    printErrors: false
    onLoaded: {
      try {
        var data = JSON.parse(text())
        root.emojis = Array.isArray(data) ? data : []
      } catch (e) {
        console.warn("punctum: bad emojis.json: " + e)
      }
    }
  }

  // ---------------------------------------------------------------- processes

  // Snapshot of the user's own processes, taken only while a "kill" query is
  // on screen and at most every 1.5 s. comm is padded to a fixed width so
  // names with spaces ("Web Content") parse cleanly.
  function requestProcesses() {
    if (processProc.running) return
    if (Date.now() - root.processesFetchedAt < 1500) return
    processProc.running = true
  }

  Process {
    id: processProc
    command: ["ps", "-u", Quickshell.env("USER"), "--no-headers", "-o", "pid=,rss=,pcpu=,comm:40=,args="]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = []
        var lines = String(text || "").split("\n")
        for (var i = 0; i < lines.length; i++) {
          var m = lines[i].match(/^\s*(\d+)\s+(\d+)\s+([\d.]+) (.{40}) (.*)$/)
          if (!m) continue
          var name = m[4].trim()
          if (name === "ps") continue
          out.push({ pid: parseInt(m[1], 10), rss: parseInt(m[2], 10), cpu: parseFloat(m[3]), name: name, args: m[5] })
        }
        root.processes = out
        root.processesFetchedAt = Date.now()
        if (root.opened) root.recompute()
      }
    }
  }

  // ---------------------------------------------------------------- apps

  // Desktop entries, filtered like Omarchy's own launcher: NoDisplay entries
  // and the ids in its launcher.hides are left out. Rebuilt whenever apps are
  // installed or removed.
  function rebuildApps() {
    var list = []
    var byId = {}
    var values = DesktopEntries.applications.values || []
    for (var i = 0; i < values.length; i++) {
      var e = values[i]
      var id = String(e.id || "")
      if (!id || e.noDisplay || root.hiddenApps[id]) continue
      var keywords = []
      try { for (var k = 0; k < e.keywords.length; k++) keywords.push(String(e.keywords[k])) } catch (err) {}
      var actions = []
      try { for (var a = 0; a < e.actions.length; a++) actions.push({ index: a, name: String(e.actions[a].name || "") }) } catch (err) {}
      byId[id] = e
      list.push({
        id: id,
        name: String(e.name || id),
        generic: String(e.genericName || ""),
        comment: String(e.comment || ""),
        keywords: keywords,
        icon: String(e.icon || ""),
        wmclass: String(e.startupClass || ""),
        actions: actions
      })
    }
    root.appEntries = byId
    root.apps = list
    if (root.opened) root.recompute()
  }

  // Started the way Omarchy's launcher starts apps: under uwsm, in their own
  // scope, with gtk-launch resolving the entry. Actions ("New Window") have no
  // gtk-launch form, so their parsed command runs under uwsm directly.
  function launchApp(id, actionIndex) {
    var entry = root.appEntries[id]
    if (actionIndex !== undefined && actionIndex !== null) {
      var action = entry && entry.actions ? entry.actions[actionIndex] : null
      var cmd = action ? Array.prototype.slice.call(action.command || []) : []
      if (cmd.length === 0) return
      Quickshell.execDetached(["uwsm-app", "--"].concat(cmd))
    } else {
      Quickshell.execDetached(["uwsm-app", "--", "gtk-launch", id + ".desktop"])
    }
    var next = Object.assign({}, root.launches)
    next[id] = (next[id] || 0) + 1
    root.launches = next
    root.cacheWrite("launches.json", JSON.stringify(next))
  }

  function appIconSource(icon) {
    var value = String(icon || "")
    if (value.charAt(0) === "/") return root.fileUrl(value)
    var themed = value ? Quickshell.iconPath(value, true) : ""
    return themed || Quickshell.iconPath("application-x-executable", true)
  }

  Timer {
    id: appsDebounce
    interval: 300
    onTriggered: root.rebuildApps()
  }

  Connections {
    target: DesktopEntries.applications
    function onValuesChanged() { appsDebounce.restart() }
  }

  Component.onCompleted: {
    root.discoverExtensions()
    nativeProc.running = true
    appsDebounce.restart()
    root.cacheRead("last-query", root.loadLastQuery)
    root.cacheRead("launches.json", root.loadLaunches)
    root.cacheRead("pinned-apps.json", root.loadPinned)
    root.cacheRead("geometry.json", root.loadGeometry)
    root.cacheRead("extension-switches.json", root.loadSwitches)
    root.cacheRead("wasm-trust.json", root.loadWasmTrust)
    layerRuleDebounce.restart()
    root.cacheRead("rates.json", root.loadRates)
    root.refreshAgent()
  }

  FileView {
    path: Quickshell.env("OMARCHY_PATH") + "/default/omarchy/launcher.hides"
    watchChanges: true
    printErrors: false
    onLoaded: {
      var next = {}
      var lines = text().split("\n")
      for (var i = 0; i < lines.length; i++) {
        var id = lines[i].trim().replace(/\.desktop$/, "")
        if (id) next[id] = true
      }
      root.hiddenApps = next
      appsDebounce.restart()
    }
    onFileChanged: reload()
  }

  // Only whole-number counts are kept, whatever the file holds.
  function loadLaunches(text) {
    var data = {}
    try { data = JSON.parse(text) || {} } catch (e) {}
    var next = {}
    if (data && typeof data === "object" && !Array.isArray(data))
      for (var id in data) if (Number.isInteger(data[id]) && data[id] > 0) next[id] = data[id]
    root.launches = next
  }

  // ---------------------------------------------------------------- windows

  // Hyprland's windows, taken each time the bar opens. focusHistoryID orders
  // them by recency (0 is the window you were just in).
  function refreshWindows() {
    if (!windowsProc.running) windowsProc.running = true
  }

  // The same dispatch Omarchy's launch-or-focus uses: the Lua form first,
  // then the classic one. The address is checked to be Hyprland's hex form.
  function focusWindow(address) {
    if (!/^0x[0-9a-fA-F]+$/.test(String(address))) return
    Quickshell.execDetached(["bash", "-c",
      "hyprctl dispatch \"hl.dsp.focus({ window = \\\"address:$1\\\" })\" >/dev/null 2>&1 || hyprctl dispatch focuswindow \"address:$1\"",
      "_", address])
  }

  Process {
    id: windowsProc
    command: ["hyprctl", "clients", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = []
        try {
          var list = JSON.parse(text)
          for (var i = 0; i < list.length; i++) {
            var c = list[i]
            if (!c.mapped || c.hidden) continue
            out.push({
              address: String(c.address || ""),
              cls: String(c["class"] || c.initialClass || ""),
              title: String(c.title || ""),
              workspace: String((c.workspace && c.workspace.name) || ""),
              focus: typeof c.focusHistoryID === "number" ? c.focusHistoryID : 99
            })
          }
        } catch (e) {
          console.warn("punctum: bad hyprctl clients output: " + e)
        }
        root.windows = out
        if (root.opened) root.recompute()
      }
    }
  }

  // ---------------------------------------------------------------- UI

  // A key drawn as a small keycap, for the footer hints.
  component Keycap: Rectangle {
    id: cap
    property string label: ""
    property color foreground: Color.foreground
    property string fontFamily: Style.font.family
    property bool rounded: true
    implicitWidth: Math.max(implicitHeight, capText.implicitWidth + Style.space(10))
    implicitHeight: capText.implicitHeight + Style.space(4)
    radius: rounded ? Style.space(4) : 0
    color: Util.alpha(cap.foreground, 0.08)
    border.width: 1
    border.color: Util.alpha(cap.foreground, 0.18)

    Text {
      id: capText
      anchors.centerIn: parent
      text: cap.label
      color: cap.foreground
      opacity: 0.8
      font.family: cap.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  // A row's icon: the app's own image, or a font glyph on a soft tile.
  component IconTile: Rectangle {
    id: tileRoot
    property string glyph: ""
    property url imageSource: ""
    property string swatch: ""          // a colour row's colour, drawn as the tile
    property bool selected: false
    property real size: Style.space(30)
    property color foreground: Color.foreground
    property color selectedText: Color.foreground
    property string fontFamily: Style.font.family
    readonly property bool hasImage: String(imageSource) !== ""
    width: size
    height: size
    color: swatch !== "" ? swatch : (hasImage ? "transparent" : Util.alpha(selected ? selectedText : foreground, selected ? 0.16 : 0.07))
    border.width: swatch !== "" ? 1 : 0
    border.color: Util.alpha(foreground, 0.25)

    Image {
      visible: tileRoot.hasImage
      anchors.fill: parent
      sourceSize.width: width * 2
      sourceSize.height: height * 2
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      smooth: true
      source: tileRoot.imageSource
    }

    Text {
      visible: !tileRoot.hasImage && tileRoot.swatch === ""
      anchors.centerIn: parent
      text: tileRoot.glyph
      color: tileRoot.selected ? tileRoot.selectedText : tileRoot.foreground
      opacity: tileRoot.selected ? 1 : 0.8
      font.family: tileRoot.fontFamily
      font.pixelSize: Math.round(tileRoot.size * 0.56)
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "punctum"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: Qt.rgba(root.scrim.r, root.scrim.g, root.scrim.b, root.glassLevels.scrim)
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: contentTopInset + contentBottomInset + layout.implicitHeight
      radius: root.cornerRadius
      x: Geometry.x(root.geometry, panel.width)
      // The top is kept where you put it unless the card would run off the
      // bottom, then it moves up just enough.
      y: Math.max(Style.gapsOut, Math.min(Geometry.y(root.geometry, panel.height), panel.height - height - Style.gapsOut))
      color: Qt.rgba(root.background.r, root.background.g, root.background.b, root.background.a * root.glassLevels.card)
      borderSpec: root.borderSpec
      padding: root.contentMargin
      Behavior on height { NumberAnimation { duration: 90; easing.type: Easing.OutCubic } }

      // Clicks on the card stay on it; a press and drag moves it.
      MouseArea {
        id: dragArea
        anchors.fill: parent
        cursorShape: pressed ? Qt.ClosedHandCursor : Qt.ArrowCursor
        property point start
        property var startGeometry
        onPressed: function(mouse) {
          start = mapToItem(null, mouse.x, mouse.y)
          startGeometry = root.geometry
          root.lastPointer = Qt.point(-1, -1)
        }
        onPositionChanged: function(mouse) {
          if (!pressed) return
          var p = mapToItem(null, mouse.x, mouse.y)
          var g = startGeometry
          root.liveGeometry = Geometry.moved(g, Geometry.x(g, panel.width) + p.x - start.x, Geometry.y(g, panel.height) + p.y - start.y, panel.width, panel.height)
        }
        onReleased: { root.saveGeometry(); input.forceActiveFocus() }
        onClicked: {}
      }

      Column {
        id: layout
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.leftMargin: card.contentLeftInset
        spacing: Style.spacing.md

        // ---------- search field ----------
        Item {
          width: parent.width
          height: root.inputHeight

          Text {
            id: promptGlyph
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            text: "󰍉"
            color: root.foreground
            opacity: 0.55
            font.family: root.fontFamily
            font.pixelSize: Math.round(root.inputFont * 1.05)
          }

          TextInput {
            id: input
            anchors.left: promptGlyph.right
            anchors.leftMargin: Style.spacing.md
            anchors.right: modeChip.visible ? modeChip.left : (helpHint.visible ? helpHint.left : parent.right)
            anchors.rightMargin: Style.spacing.md
            anchors.verticalCenter: parent.verticalCenter
            color: root.foreground
            selectionColor: root.selectedBackground
            selectedTextColor: root.selectedText
            font.family: root.fontFamily
            font.pixelSize: root.inputFont
            clip: true
            focus: true
            onTextChanged: {
              root.selectedIndex = 0
              root.recompute()
            }

            Text {
              anchors.fill: parent
              verticalAlignment: Text.AlignVCenter
              visible: !input.text
              text: "Apps, ~files, cb clipboard, keys, a sum…"
              color: root.foreground
              opacity: 0.4
              font: input.font
              elide: Text.ElideRight
            }

            Keys.priority: Keys.BeforeItem
            Keys.onPressed: function(event) {
              if (event.key === Qt.Key_Escape) {
                if (root.inHelpTopic) root.helpBack()
                else if (input.text) input.text = ""
                else root.dismiss()
                event.accepted = true
              } else if (event.key === Qt.Key_Down || (event.key === Qt.Key_N && event.modifiers & Qt.ControlModifier)) {
                root.move(1); event.accepted = true
              } else if (event.key === Qt.Key_Up || (event.key === Qt.Key_P && event.modifiers & Qt.ControlModifier)) {
                root.move(-1); event.accepted = true
              } else if (event.key === Qt.Key_Backspace && root.inHelpTopic && !input.selectedText
                         && /^\s*\?[a-z]+$/.test(input.text) && root.showingHelp && !!root.rows[0].helpTopic
                         && input.cursorPosition === input.text.length) {
                root.helpBack(); event.accepted = true
              } else if (event.key === Qt.Key_Tab) {
                var row = root.rows[root.selectedIndex]
                if (row) root.complete(row)
                event.accepted = true
              } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ShiftModifier)) {
                root.activateAlt(root.selectedIndex); event.accepted = true
              } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                root.activate(root.selectedIndex); event.accepted = true
              } else if (event.key === Qt.Key_P && (event.modifiers & Qt.AltModifier) && root.selectedRow && root.selectedRow.appId) {
                root.togglePin(root.selectedIndex); event.accepted = true
              } else if ((event.modifiers & Qt.AltModifier) && event.key >= Qt.Key_1 && event.key <= Qt.Key_9) {
                var quick = event.key - Qt.Key_1
                if (quick < Math.min(root.quickKeys, root.rows.length)) { root.selectedIndex = quick; root.activate(quick) }
                event.accepted = true
              }
            }
          }

          // The mode a prefix puts the bar in: Emoji, Windows, Search Google…
          Rectangle {
            id: modeChip
            visible: !!root.mode
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            implicitWidth: chipRow.implicitWidth + Style.space(16)
            implicitHeight: chipRow.implicitHeight + Style.space(8)
            width: implicitWidth
            height: implicitHeight
            radius: root.cornerRadius > 0 ? height / 2 : 0
            color: root.selectedBackground

            Row {
              id: chipRow
              anchors.centerIn: parent
              spacing: Style.space(6)

              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.mode ? (root.mode.icon || "") : ""
                visible: text !== ""
                color: root.selectedText
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }

              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.mode ? root.mode.label : ""
                color: root.selectedText
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
              }
            }
          }

          Row {
            id: helpHint
            visible: !root.mode && !input.text
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(6)

            Keycap { label: "?"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "for help"
              color: root.foreground
              opacity: 0.45
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }

        Rectangle {
          width: parent.width
          height: 1
          color: root.foreground
          opacity: 0.1
          visible: root.rows.length > 0 || root.noResults
        }

        // ---------- nothing matched ----------
        Column {
          width: parent.width
          visible: root.noResults
          spacing: Style.space(4)
          topPadding: Style.spacing.md
          bottomPadding: Style.spacing.md

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            textFormat: Text.PlainText
            text: "Nothing matches \"" + input.text.trim() + "\""
            color: root.foreground
            opacity: 0.8
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            elide: Text.ElideMiddle
          }

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: "Type ? to see what the bar understands"
            color: root.foreground
            opacity: 0.45
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }

        // ---------- results ----------
        ListView {
          id: list
          width: parent.width
          height: root.listHeight
          visible: root.rows.length > 0
          model: root.rows
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          currentIndex: root.selectedIndex

          delegate: Item {
            id: rowItem
            required property int index
            required property var modelData
            readonly property bool selected: index === root.selectedIndex
            readonly property bool hero: !!modelData.hero
            // The first row of each group carries its label (Windows, Apps…),
            // drawn above the row, outside the selectable area.
            readonly property string section: modelData.section || ""

            width: list.width
            height: root.rowSize(modelData)

            Text {
              visible: rowItem.section !== ""
              anchors.left: parent.left
              anchors.leftMargin: Style.spacing.md
              anchors.top: parent.top
              height: root.sectionHeight
              verticalAlignment: Text.AlignVCenter
              text: rowItem.section
              color: root.foreground
              opacity: 0.5
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 0.4
            }

            Rectangle {
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              height: rowItem.hero ? root.heroHeight : root.rowHeight
              radius: root.cornerRadius > 0 ? Style.space(8) : 0
              color: rowItem.selected ? root.selectedBackground : "transparent"
              Behavior on color { ColorAnimation { duration: 80 } }

              IconTile {
                id: tile
                anchors.left: parent.left
                anchors.leftMargin: Style.spacing.md
                anchors.verticalCenter: parent.verticalCenter
                glyph: rowItem.modelData.icon || ""
                imageSource: rowItem.modelData.image ? root.appIconSource(rowItem.modelData.image) : ""
                swatch: rowItem.modelData.swatch || ""
                selected: rowItem.selected
                size: rowItem.hero ? Math.round(root.tileSize * 1.4) : root.tileSize
                radius: root.tileRadius
                foreground: root.foreground
                selectedText: root.selectedText
                fontFamily: root.fontFamily
              }

              Column {
                anchors.left: tile.right
                anchors.leftMargin: Style.spacing.md
                anchors.right: quickKey.visible ? quickKey.left : parent.right
                anchors.rightMargin: Style.spacing.md
                anchors.verticalCenter: parent.verticalCenter
                spacing: rowItem.hero ? Style.space(4) : Style.space(2)

                Text {
                  width: parent.width
                  textFormat: Text.PlainText
                  text: rowItem.modelData.title
                  color: rowItem.selected ? root.selectedText : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: rowItem.hero ? Style.font.displayLarge : Style.font.subtitle
                  font.bold: rowItem.hero
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  visible: text !== ""
                  textFormat: Text.PlainText
                  text: rowItem.modelData.subtitle || ""
                  color: rowItem.selected ? root.selectedText : root.foreground
                  opacity: rowItem.selected ? 0.7 : 0.5
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              Keycap {
                id: quickKey
                visible: rowItem.index < root.quickKeys
                anchors.right: parent.right
                anchors.rightMargin: Style.spacing.md
                anchors.verticalCenter: parent.verticalCenter
                label: "Alt+" + (rowItem.index + 1)
                foreground: rowItem.selected ? root.selectedText : root.foreground
                fontFamily: root.fontFamily
                rounded: root.cornerRadius > 0
                opacity: rowItem.selected ? 0.9 : 0.6
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                // Only real pointer movement selects: rows that slide under a
                // resting cursor (the card growing, the list re-rendering)
                // report positions too, but the window position stays put.
                onPositionChanged: function(mouse) {
                  var p = mapToItem(null, mouse.x, mouse.y)
                  if (p.x === root.lastPointer.x && p.y === root.lastPointer.y) return
                  var first = root.lastPointer.x < 0
                  root.lastPointer = Qt.point(p.x, p.y)
                  if (!first) root.selectedIndex = rowItem.index
                }
                onClicked: {
                  root.selectedIndex = rowItem.index
                  root.activate(rowItem.index)
                  // An action closes the bar, and the shell may unload it
                  // before this runs; then there is no field to focus.
                  if (typeof input !== "undefined" && input && root.opened) input.forceActiveFocus()
                }
              }
            }
          }
        }

        // ---------- footer: what the selected row is, and what the keys do ----------
        Item {
          width: parent.width
          height: root.footerHeight
          visible: root.rows.length > 0

          Rectangle {
            anchors.top: parent.top
            width: parent.width
            height: 1
            color: root.foreground
            opacity: 0.1
          }

          Row {
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: 1
            spacing: Style.space(6)

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.selectedRow ? (root.selectedRow.help ? "Help" : (root.selectedRow.group || root.selectedRow.providerName || "")) : ""
              color: root.foreground
              opacity: 0.5
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Row {
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: 1
            spacing: Style.space(6)

            Text {
              visible: root.inHelpTopic
              anchors.verticalCenter: parent.verticalCenter
              text: "Back"
              color: root.foreground
              opacity: 0.55
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Keycap { visible: root.inHelpTopic; label: "Esc"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }
            Item { visible: root.inHelpTopic; width: Style.space(8); height: 1 }

            Text {
              visible: root.canComplete(root.selectedRow)
              anchors.verticalCenter: parent.verticalCenter
              text: "Fill in"
              color: root.foreground
              opacity: 0.55
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Keycap { visible: root.canComplete(root.selectedRow); label: "Tab"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }

            Item { visible: root.canComplete(root.selectedRow); width: Style.space(8); height: 1 }

            Text {
              visible: !!root.selectedRow && !!root.selectedRow.appId
              anchors.verticalCenter: parent.verticalCenter
              text: root.selectedRow && root.selectedRow.pinned ? "Unpin" : "Pin"
              color: root.foreground
              opacity: 0.55
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Keycap { visible: !!root.selectedRow && !!root.selectedRow.appId; label: "Alt+P"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }
            Item { visible: !!root.selectedRow && !!root.selectedRow.appId; width: Style.space(8); height: 1 }

            Text {
              visible: !!root.selectedRow && !!root.selectedRow.alt
              anchors.verticalCenter: parent.verticalCenter
              text: root.selectedRow && root.selectedRow.alt ? root.selectedRow.alt.label.charAt(0).toUpperCase() + root.selectedRow.alt.label.slice(1) : ""
              color: root.foreground
              opacity: 0.55
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Keycap { visible: !!root.selectedRow && !!root.selectedRow.alt; label: "Shift+↵"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }
            Item { visible: !!root.selectedRow && !!root.selectedRow.alt; width: Style.space(8); height: 1 }

            Text {
              id: primary
              visible: text !== ""
              anchors.verticalCenter: parent.verticalCenter
              text: root.actionLabel(root.selectedRow)
              color: root.foreground
              opacity: 0.85
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }
            Keycap { visible: primary.text !== ""; label: "↵"; anchors.verticalCenter: parent.verticalCenter; foreground: root.foreground; fontFamily: root.fontFamily; rounded: root.cornerRadius > 0 }
          }
        }
      }

      // The resize grip: drag the bottom-right corner. Width and the most
      // results shown before scrolling are both saved.
      Item {
        width: Style.space(18)
        height: Style.space(18)
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        z: 10

        Canvas {
          anchors.fill: parent
          anchors.margins: Style.space(4)
          opacity: gripArea.containsMouse || gripArea.pressed ? 0.7 : 0.3
          onPaint: {
            var c = getContext("2d")
            c.reset()
            c.strokeStyle = root.foreground
            c.lineWidth = 1
            for (var i = 1; i <= 3; i++) {
              c.beginPath()
              c.moveTo(width, height - width * i / 3)
              c.lineTo(width - width * i / 3, height)
              c.stroke()
            }
          }
        }

        MouseArea {
          id: gripArea
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.SizeFDiagCursor
          property point start
          property var startGeometry
          onPressed: function(mouse) {
            start = mapToItem(null, mouse.x, mouse.y)
            startGeometry = root.geometry
          }
          onPositionChanged: function(mouse) {
            if (!pressed) return
            var p = mapToItem(null, mouse.x, mouse.y)
            root.liveGeometry = Geometry.resized(startGeometry, p.x - start.x, p.y - start.y, panel.width)
          }
          onReleased: { root.saveGeometry(); input.forceActiveFocus() }
        }
      }
    }
  }
}
