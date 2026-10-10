# Proposal: extensions, Everywhere on its own, and a community release

Status, 2026-10-09: **steps 2 to 5 are built** (commits `fa78d96`, `12d1b02`);
step 1 is drafted in [`upstream/`](upstream/README.md) and step 6 is open.
The rest of this page is the proposal as written, against commit `b66fd1c`,
with what changed in the building noted under [As built](#as-built).

## What prompted it

The bar has grown from upstream's calculator-and-launcher into a dozen
features, several of them personal (NASB first, a Syncthing keyword). If it
were released, people would want to switch features on and off easily and add
their own without editing the plugin, the way this fork had to. And
Everywhere, the file search, would be useful well beyond this bar.

## What already works in our favour

- **Features are already units.** Each is one provider file with a uniform
  contract: query in, rows out, actions proposed from a fixed list. See
  [Writing a provider](writing-extensions.md) (now Writing extensions).
- **Toggling already exists**, crudely: `"providers": [...]` in the config.
- **Providers are pure**, so each has tests that run in Node with no shell.
- **One generic background-process service exists**: `requestSearch(key, argv)`,
  built for Everywhere and Inside files.

## What's in the way

From [Architecture](architecture.md#where-it-strains):

1. **The registry is static.** QML `.import` is resolved when the file loads,
   so every provider is compiled in through `providers/index.js`.
2. **Each kind of background data needs new code in the bar.** Clipboard,
   packages and the file walker each have their own process, properties and
   request hook in `CommandBar.qml`.
3. **Defaults live in one file.** A feature's settings, mode prefix, help order
   and mode chip are spread over `config.default.json` and `lib/Engine.js`,
   so a feature can't be added or removed as one folder.

## Proposal

### 1. One service for background work

Replace the per-feature plumbing with the general form of `requestSearch`:

```js
ctx.run(key, argv, { timeout: 3000, once: false }) → { key, text, timedOut } | null
```

- `once: true` for things read once per open (the package list, clipboard
  history through a small reader script); otherwise newest-key-wins, as now.
- The bar keeps a small pool (one live search plus once-per-open reads) instead
  of one process per feature.
- Removes the per-feature sections from `CommandBar.qml` (an estimate of
  100 to 150 lines, not counted). No user-visible change.

This is an internal refactor and worth doing whatever else happens.

### 2. Each feature becomes an extension folder

```
extensions/
  bible/
    extension.json
    provider.js
    README.md
    tests.js
```

`extension.json` carries everything that is spread around today:

```jsonc
{
  "id": "bible",
  "name": "Bible",
  "version": "1.0.0",
  "description": "Scripture references on Bible Gateway",
  "mode": { "prefix": "bible ", "label": "Bible", "icon": "󰂺" },  // optional
  "defaults": { "versions": ["NASB", "NASB1995", "ESV", "KJV"] },
  "enabled": false,                       // off unless the user turns it on
  "permissions": {
    "exec": [],                           // commands it runs
    "network": ["www.biblegateway.com (on Enter, in your browser)"],
    "reads": []
  }
}
```

- **Toggling**: `"extensions": { "bible": true, "packages": false }` in
  `commandbar.json`, and the bar lists every extension, on or off, with its
  permissions, under `?extensions`. Later, a settings panel.
- **Defaults travel with the extension**, so `config.default.json` shrinks to
  the bar's own settings.
- **Permissions are labels, not enforcement**: an in-process extension runs as
  you inside the shell. They make review possible and make surprises visible.
- **Built-ins ship as bundled extensions**, so third-party ones are not second
  class.

Loading: QML can't `.import` a path chosen at run time, but
`Qt.createComponent(url)` can load a QML file at run time. Each extension
would ship a three-line `Extension.qml` that imports its `provider.js` and
exposes it as a property, and the bar would load every enabled one at startup.
*Untested*: whether Quickshell's component cache and hot reload behave with
this, and the load cost for twenty extensions.

### 3. Script extensions, in any language

For people who don't want to write QML-flavoured JavaScript, and for anything
that is naturally a command:

```
extensions/
  weather/
    extension.json      { "kind": "script", "command": "./weather", "mode": { "prefix": "wx " } }
    weather             any executable
```

- The bar runs the command with `{"query": "...", "settings": {...}}` on stdin
  and reads rows as JSON from stdout: the same rows and action kinds providers
  return today.
- It is called only in its mode (after its prefix), through the background
  service, newest query wins, bounded by a timeout.
- **The bar still carries out the actions**, from the same fixed list, so a
  script proposes and the user sees what Enter will do.
- This is the model of Raycast script commands, Alfred script filters and
  Ulauncher extensions, so it is familiar to people who have written those.
- Out of process, a script extension could later be run under `bwrap` or
  `systemd-run --user` with no network and a read-only home: a real sandbox,
  which in-process extensions can never have.

### 4. Everywhere on its own

Everywhere is a good first release by itself, and extracting it is the natural
pilot for script extensions.

- **An `everywhere` command**: the engine moved out of `providers/locate.js`
  into one script.
  - `everywhere QUERY` prints ranked paths; `--print0` and `--json` for
    programs.
  - `everywhere --index` refreshes the home index (also a systemd user timer).
  - `everywhere -i` opens an interactive picker in the terminal with fzf and a
    preview pane. This is where fzf fits best.
- **The bar's provider becomes a thin client** of `everywhere --print0`: the
  first script extension.
- **Works elsewhere too**: Walker, rofi, fuzzel and the Omarchy menu can call
  the same command, as can a terminal.
- Later: size and date filters (`size:>10M`, `dm:today`, like Everything's),
  folders marked as folders, and live indexing of home with inotify instead of
  a rebuild on use.
- *Not checked*: whether the name "Everywhere" is taken by another file-search
  or Linux project. Search before committing to it.

## A community release

### Rules it would have to meet

Upstream's CONTRIBUTING.md lists the Omarchy plugin marketplace's
requirements. Two of the fork's features break them as they stand:

| Rule | Conflict | Way out |
|---|---|---|
| Don't ask for administrator rights | Packages: Enter runs `sudo pacman -S` in a terminal | Ship Packages search-only (Enter copies `sudo pacman -S repo/name`, Shift+Enter opens the page), with the install action as an opt-in setting or a separate extension outside the marketplace |
| Keep the defaults neutral | Bible on by default, NASB-first bangs, the Syncthing keyword | Bible and the Bible bangs as an extension, off by default; a neutral bang list (`ddg`, `w`, `yt`, `gh`, `aw`, `maps`); personal keywords in your own config |

Also needed:

- **Its own id and name.** `hypha.commandbar` is a local id; a release needs
  a namespaced one (`io.github.<you>.<name>`) and probably a new name, since it
  is no longer upstream's Command Bar.
- **Dependencies declared and checked**: `fd`, `plocate`, `fzf`, `ripgrep`,
  `expac`, `wl-clipboard`, `wtype`. Today a missing one shows up as an empty
  result.
- **CI** running `node tests/run.js` on every push.
- **Docs for users rather than for this machine**: the README still opens with
  fork notes.
- **Credit**: upstream (MIT, Saikomantisu) and Keystroke (MIT, Arseniy
  Zarechnev) are credited in the README and in each adapted file; keep both.

### Upstream first

Three of the fork's fixes are security fixes upstream would want regardless:

- the `{q}` replacement-string injection in keyword commands;
- copied text on a command line;
- a test that ran an `rm -rf ~` payload.

Offering those back as small pull requests is worth doing whatever you decide
about releasing.

## Recommended order

| Step | What | Size |
|---|---|---|
| 1 | Upstream security PRs | small |
| 2 | One background service (`ctx.run`) | medium, internal |
| 3 | Extract `everywhere` as a command; the bar's provider becomes its client | medium |
| 4 | Extension folders and manifests for built-ins; `"extensions"` toggles | large |
| 5 | Script extensions | medium, once 2 and 4 exist |
| 6 | Release: neutral defaults, marketplace-safe Packages, new id, CI | medium |

Everywhere could be released after step 3, on its own, before any of the
rest.

## As built

What differs from the proposal above, checked against the code:

- **Loading JS extensions** works as proposed, without a shipped
  `Extension.qml`: the bar makes the three-line QML object itself
  (`Qt.createQmlObject` with the extension folder as its URL). Checked live:
  all bundled extensions and a user extension load.
- **`ctx.run`** became three calls: `ctx.requestSearch` (newest wins, chunks,
  stdin), `ctx.load` (once per open, or `ttl`), `ctx.requestJob` (every N s,
  `rerun`). Keys are prefixed per extension.
- **Manifests** also carry `hero`, `minQuery`, `placeholder` and `refresh`;
  `mode` is a regular expression; switches accept `true`/`false` or
  `{ "enabled": ... }`, and the older `"providers"` list still works.
- **The user folder** is `~/.config/omarchy/commandbar/extensions/`, with
  ownership and permission checks in `bin/commandbar-extensions`.
- **Everywhere** is a Python command, `extensions/everywhere/everywhere`; its
  index moved to `~/.cache/everywhere/home.db`. Not done from the "later"
  list: size and date filters, inotify.
- **Also added:** reminders and alarms (`extensions/remind`), and
  `examples/hello`, the smallest script extension.
- **Built since** (2026-10-09, later): a bubblewrap sandbox for script
  extensions from a `sandbox` manifest field; switches in `?extensions`
  (Enter turns one on or off, kept in the cache, not your config file);
  Everywhere's `size:`, `dm:`, `ext:` and `type:` filters.

## Decisions for the maintainer

1. Release as your own project, or try to land features upstream?
2. A name for the bar, and confirming "Everywhere" for the file search.
3. Start with Everywhere (step 3) or the extension system (steps 2 and 4)?
