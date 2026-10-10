# Writing extensions

Every feature of the bar is an extension: a folder with an `extension.json`
and either a JavaScript provider or any executable. The bundled ones are in
[`extensions/`](../extensions); yours go in
`~/.config/omarchy/commandbar/extensions/<id>/`. Restart the shell
(`omarchy-restart-shell`) to load a new one; `?extensions` lists what loaded,
and `journalctl --user -f | grep commandbar` says why one didn't.

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
  "id": "hello",                     // a-z 0-9 - _, up to 32; also its settings key
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
- `refresh` runs a background job on the first query in the mode after the
  bar opens, at most every `every` seconds; when it finishes, the current
  query runs again. Everywhere uses it to refresh its index.

## Actions

The bar, not the extension, carries out what Enter does, and only these:

| `kind` | Fields | Does |
|---|---|---|
| `open` | `target` | `xdg-open` an `http(s)://`, `mailto:` or `file:///` URL, or an absolute path |
| `copy` | `target` | the text to `wl-copy` on stdin |
| `paste` | `target` | copy, then Shift+Insert into the window you came from |
| `edit` | `target`, `line` | your Omarchy default editor at that line |
| `argv` | `target: [...]`, optional `input` | runs the argument list, no shell; `input` goes to its stdin |

Give every action a `label`; the footer shows it ("open", "set reminder").
JS extensions can also use the bar's internal kinds (`app`, `window`, `note`,
`shell` for keyword commands); scripts can't.

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
