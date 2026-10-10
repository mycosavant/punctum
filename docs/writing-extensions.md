# Writing extensions

Every feature of the bar is an extension: a folder with an `extension.json`
and either a JavaScript provider or any executable. The bundled ones are in
[`extensions/`](../extensions); yours go in
`~/.config/omarchy/punctum/extensions/<id>/`. A new folder is found at
startup and whenever your config file changes; a changed provider file needs
`omarchy-restart-shell`, since Quickshell caches what it has imported.
`?extensions` lists what loaded, and `journalctl --user -f | grep punctum`
says why one didn't.

There are two kinds:

| | Script extension | JS extension |
|---|---|---|
| Written in | anything executable | JavaScript (QML's `.pragma library`) |
| Runs | out of process, only in its mode, newest query wins, 3 s limit | inside the shell, on every keystroke |
| Good for | lookups, other tools' output, anything you'd write as a script | answers that must appear as you type everywhere (a calculator) |
| Example | [`examples/hello`](../examples/hello), [`extensions/everywhere`](../extensions/everywhere) | [`extensions/bible`](../extensions/bible) |

Start with a script extension unless you need to answer outside a mode.

## The manifest

```jsonc
{
  "schema": 1,                       // this format; the bar refuses others
  "id": "hello",                     // a-z 0-9 - _, up to 32; also its settings key.
                                     // window, glass, hotkey, extensions, providers,
                                     // help, bar and locate are taken
  "name": "Hello",
  "version": "1.0.0",
  "description": "hi <name>: the smallest script extension",
  "icon": "󰞅",                        // a Nerd Font glyph
  "type": "script",                  // or "js"
  "command": ["./hello"],            // script: ./ is this folder; or a command name. Never a shell string
  "entry": "provider.js",            // js: a .js file in this folder
  "mode": { "pattern": "^\\s*hi\\s", "label": "Hello" },   // required for scripts
  "enabled": true,                   // default when the user hasn't said
  "order": 500,                      // ties with other extensions, lower first
  "helpOrder": 500,                  // place in the ? list
  "hero": false,                     // its top row is an answer, shown large
  "minQuery": 1,                     // script: characters after the prefix before it runs
  "placeholder": "Type a name after hi",
  "defaults": { "greeting": "Hello" },          // settings, merged with the user's "hello": {...}
  "requires": ["fzf"],               // commands that must be on PATH, or it stays off
  "refresh": { "command": ["./hello", "--warm"], "every": 60 },   // script: background job, see below
  "sandbox": { "network": false, "home": "none", "reads": [], "writes": [] },   // script: see below
  "permissions": {                   // what it touches, shown in ?extensions
    "runs": [], "reads": [], "writes": [], "network": []
  },
  "help": [{ "id": "hello", "title": "Hello", "about": "hi and a name",
             "examples": [{ "q": "hi Ada", "note": "Hello, Ada!" }] }],
  "commands": [{ "title": "Say hello", "keywords": "greet", "text": "hi and a name", "complete": "hi " }]
}
```

`permissions` are labels, not enforcement: say honestly what the extension
runs, reads, writes and contacts, and when. Users read them before turning it
on.

## Script extensions

The bar runs `command` with one JSON request on stdin:

```json
{ "protocol": 1, "query": "hi Ada", "text": "Ada", "settings": { "greeting": "Hello" }, "home": "/home/you" }
```

`text` is what follows the mode prefix. The script prints:

```json
{ "items": [ { "title": "Hello, Ada!", "subtitle": "Enter copies it", "copy": "Hello, Ada!",
               "run": { "kind": "copy", "target": "Hello, Ada!", "label": "copy" } } ],
  "message": "shown when items is empty" }
```

- At most 200 items; strings are cut to sensible lengths.
- Each item: `title` (required), `subtitle`, `icon`, `image` (absolute path
  or icon name), `copy`, `complete` (what Tab fills in), `run` (Enter),
  `alt` (Shift+Enter).
- A newer keystroke stops the run in progress; a run still going after 3 s is
  stopped and the bar says so. Bound slow commands yourself (`timeout 3`).
- The query never appears on a command line.
- `refresh` runs a background job on a query in the mode, at most every
  `every` seconds; when it finishes, the current query runs again, so the
  rows may refresh while you look. Everywhere uses it to refresh its index.
- If the command can't start, or fails with no output, the extension says
  so in a row with the first error line; `bin/punctum-extensions` also
  keeps an extension off when its `./` command isn't executable, its command
  isn't on PATH, or (sandboxed) its command or interpreter lives in your
  home folder.

## The sandbox

A script extension runs inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox the bar builds from its manifest, and `?extensions` shows what each
one got. With no `sandbox` field it gets the strictest one:

- no network;
- an empty, throwaway home folder;
- read-only `/usr` and `/etc`, its own folder (read-only, and the working
  directory), a private `/tmp`;
- no desktop session: no Wayland, no D-Bus, no `$XDG_RUNTIME_DIR`.

It asks for more, and only what it needs:

```jsonc
"sandbox": {
  "network": true,                    // for a web lookup
  "home": "read",                     // "none" (default), "read" or "read-write"
  "reads": ["~/.config/thing"],       // these paths readable, even with home "none"
  "writes": ["~/.cache/thing"]        // these paths writable
}
```

How it holds:

- `bin/punctum-sandbox` builds the bwrap command each time the script
  runs. It opens every `reads` and `writes` path one component at a time
  from your home folder without following symlinks and mounts the open file,
  so a script can't plant a link in a folder it may write and have a later
  run mount something else there. A symlink anywhere in a path is refused.
- Paths are under `~/`, with no empty, `.` or `..` parts, and none may
  contain another. `writes` may not touch places that run code or hold keys
  (shell rc files, `~/.ssh`, `~/.gnupg`, `~/.local/bin`, `~/.config/hypr`,
  systemd, autostart, the bar's own folders). A `writes` folder that doesn't
  exist yet is created, mode 700.
- The environment is cleared: the script sees `HOME`, `TMPDIR`, the locale,
  `TZ`, and a `PATH` without folders in your home (so a command or
  interpreter from mise or `~/.local/bin` isn't there; the bar reports such
  an extension as "not reachable inside the sandbox" and keeps it off).
- With `"network": true` the resolver files are mounted, so DNS works.
- A command one of its rows runs on Enter (an `argv` action) runs in the same
  sandbox. `open` rows still open in your browser or default app, outside
  it, so a URL a script builds can carry what it was allowed to read; the
  footer and row show what Enter opens.
- `"home": "read"` also lets it connect to sockets in your home folder;
  `"home": "read-write"` is not a sandbox, and `?extensions` says so.
- If the sandboxed command fails (it exits non-zero with no output), the row
  says so with its first error line.

`"sandbox": false` runs it unsandboxed, which `?extensions` says plainly;
Everywhere needs that, because `plocate` reads the system index through its
setgid bit, which a sandbox turns off. A sandboxed extension needs `bwrap`
(the `bubblewrap` package) and stays off without it. The tests run a probe
script through the default, home read, named reads, network on, home
read-write and unsandboxed, and check what it could and couldn't reach,
including a planted symlink.

## Actions

The bar, not the extension, carries out what Enter does, and only these:

| `kind` | Fields | Does |
|---|---|---|
| `open` | `target` | open an `http(s)://`, `mailto:` or `file:///` URL, or an absolute path, through `bin/punctum-open`: `xdg-open`, except that a text file whose default app runs in a terminal (or has none) opens in your Omarchy default editor, and another terminal app starts through `gio open` |
| `copy` | `target` | the text to `wl-copy` on stdin |
| `paste` | `target` | copy, then Shift+Insert into the window you came from |
| `edit` | `target`, `line` | your Omarchy default editor at that line |
| `argv` | `target: [...]`, optional `input` | runs the argument list, no shell; `input` goes to its stdin |

For a script's actions the bar writes the footer label itself ("open",
"copy", "paste", "edit", "run <program>"), so a row can't say one thing and
do another; `argv` still runs whatever program it names. A JS extension's
`label` is shown as given, and JS extensions can also use the bar's internal
kinds (`app`, `window`, `note`, `shell` for keyword commands).

## JS extensions

```js
.pragma library

var provider = {
  id: "shout",          // must match the manifest's id
  name: "Shout",
  icon: "󰔊",
  match: function(query, ctx) {
    var m = String(query || "").match(/^\s*shout\s+(.+)$/i)
    if (!m) return []
    var loud = m[1].toUpperCase()
    return [{ title: loud, subtitle: "Enter copies", score: 95, copy: loud }]
  }
}
```

The file is loaded with `.pragma library`: shared, and stateless between
calls unless you keep state yourself. It runs inside the shell with
everything you can do, so it's trusted code: keep it to matching and
proposing actions.

A row has the script fields above plus `score` (98 an exact answer to a mode,
90-97 strong, 70 time and app matches, 40 placeholders), `group`,
`fallback: true` (only when nothing else answered), `swatch`, `appId`.

Other provider hooks:

| Hook | What |
|---|---|
| `commands` | rows found by name ("unit" finds "Convert units"); array or `function(ctx)` |
| `help` | topics for `?`; array or `function(ctx)` |
| `empty(ctx)` | rows for the empty bar |
| `mode(query, ctx)` | a chip worked out at run time (keyword commands use it); a static `mode` in the manifest is simpler |
| `forget()` | the bar closed: drop anything kept between keystrokes |

### Context

| Field | What |
|---|---|
| `settings` | this extension's section: manifest `defaults` merged with the user's |
| `dir` | this extension's folder (for its own helper scripts) |
| `home`, `omarchyPath` | paths |
| `now()` | the current `Date` (tests pin it) |
| `apps`, `windows`, `processes`, `emojis`, `zones`, `rates`, `pinnedApps` | data the bar keeps |
| `inMode(q)`, `modeOf(q)` | whether a query is in a mode, and whose |
| `keywords` | keywords the user's keyword commands take |
| `format(n)`, `plain(n)` | number formatting |

### Background work

`match` must return straight away. Anything slow runs as a process the bar
starts for you; your provider is called again when it lands. Keys are
private to your extension.

```js
// A search: argument lists run in turn, newest key wins, 3 s each.
var have = ctx.search                       // { key, text, chunks, timedOut, done } or null
if (!have || have.key !== text) {
  if (ctx.requestSearch) ctx.requestSearch(text, [["mytool", "--", text]], { timeout: 3000 })
  if (!have) return [{ title: "Searching…", score: 40, copy: "" }]
}

// Text read once per open (or kept and re-read every ttl ms); null while loading.
var list = ctx.load("list", ["mytool", "--list"], { ttl: 30000 })

// A job at most every N seconds; rerun searches again when it ends.
if (ctx.requestJob) ctx.requestJob("warm", ["mytool", "--warm"], { every: 60, rerun: true })
```

Help previews call `match` with the `request*` hooks set to `null`, so
browsing help never starts anything: check a hook exists before calling it.
`ctx.load` still returns what's already loaded.

**Never build a shell string from typed text.** Use argument lists, put the
text after `--`, or pass it as an argument to a constant script
(`["bash", "-c", SCRIPT, "name", text]`).

## Testing

`node tests/run.js` loads every bundled extension the way the bar does and
runs them in Node with fixed data. Add checks there. For anything that runs a
command, run it for real with a hostile input (`$(touch <marker>)`) in a
temporary folder, and break your code once to see the test fail.
