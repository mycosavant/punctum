# Architecture

## The pieces

```
omarchy-shell (Quickshell, long-running)
└── Punctum.qml             the overlay: input, list, keys, geometry, glass;
    │                          finds and loads extensions; runs every process;
    │                          carries out actions
    ├── lib/Engine.js          runs the enabled extensions, ranks, groups, help,
    │                          mode chips, ?extensions
    ├── lib/Extensions.js      manifests: validation, switches, settings,
    │                          script extensions (pure)
    ├── lib/Match.js, Calc.js, FileKinds.js, tzcities.js
    │                          helpers shared by bundled extensions
    ├── lib/Geometry.js        card position and size (pure)
    ├── lib/Hotkey.js          binding the hotkey without stealing a taken one (pure)
    ├── extensions/<id>/       one feature each: extension.json + provider.js,
    │                          a script (everywhere; the example in examples/),
    │                          or native, in punctumd (units)
    └── bin/
        ├── punctum-extensions  finds extensions and reads their manifests
        ├── punctum-cache       the only reader and writer of the cache files
        ├── punctum-note        appends to the inbox note
        ├── punctum-edit        opens the editor at a line
        ├── punctum-open        opens a URL or file (xdg-open, but text
        │                          with a terminal default goes to the editor)
        └── punctum-agent       starts the default agent with a prompt

punctumd (Rust, native/punctumd/)  native extensions, kept running beside the
                                    bar, one JSON line per query (docs/native.md)
```

Your extensions live in `~/.config/omarchy/punctum/extensions/<id>/`; one
with a bundled extension's id replaces it.

## Startup

1. `bin/punctum-extensions` lists the bundled extensions, then yours. From
   your folder it refuses anything not yours alone (a folder or manifest
   another user owns or can write, a symlinked manifest), and it reports
   required commands missing from PATH.
2. `lib/Extensions.js` validates each manifest; refused ones go to
   `?extensions` with the reason.
3. A JS extension's provider is loaded through a three-line QML object made
   at run time (`Qt.createQmlObject` importing its file), the only way QML
   can import a path chosen at run time. A script extension gets a provider
   from `Ext.scriptProvider`; a native one from `Ext.nativeProvider` when
   punctumd's hello lists it, and from its JS fallback when not.
4. `Engine.setProviders` takes them all, in manifest order.
5. The config is built from `config.default.json` (the bar's own settings),
   your `punctum.json`, and each extension's section: its manifest
   defaults merged with yours.

This runs again whenever your config changes, which picks up a new
extension folder; a changed provider file needs `omarchy-restart-shell`.

## A keystroke

1. `Punctum.qml` calls `Engine.run(text, config, services)`.
2. Engine builds a `ctx` per enabled extension (its settings, its folder, the
   bar's data, and its own view of the background service) and calls `match`.
3. An extension that needs something slow asks: `ctx.requestSearch`,
   `ctx.load`, `ctx.requestJob`. It returns a placeholder or its previous rows.
4. Engine adds rows found by name (`commands`), drops `fallback` rows if
   anything else answered, sorts by score then extension order, groups by
   heading, and shows a `hero` extension's answer large.
5. When a process lands, the bar stores the output and runs step 1 again.
6. Enter calls `activate()`, which hands the row's action to `perform()`.
   Extensions never run anything themselves.

## The background service

All in `Punctum.qml`, all argument lists:

| Part | Asked by | Behaviour |
|---|---|---|
| search | `ctx.requestSearch(key, argvs, { stdin, timeout })` | one at a time for the whole bar, and only for the extension whose mode the query is in; argument lists run in turn, each landing as a chunk; a newer key stops the running one; 3 s watchdog per command, results marked `timedOut`; a command that can't start is marked `failed` |
| load | `ctx.load(key, argv, { ttl })` | one at a time; once per open and dropped on close (a late result for a closed bar is discarded), or kept and re-read every `ttl` |
| job | `ctx.requestJob(key, argv, { every, rerun })` | at most every N seconds, one at a time; `rerun` drops the extension's search so it asks again |
| input | an `argv` action with `input` | stdin, one at a time |
| native | `ctx.native(query)` | punctumd, every keystroke; answers cached until the config changes, null until one lands |

Keys are prefixed with the extension's id in Engine, so one extension never
sees another's results. On close the bar stops the search, drops per-open
loads, and calls every provider's `forget()`.

Data the bar keeps for everyone (apps, windows, processes, rates, zones,
emojis, the default agent) still has its own small process each.

## Who owns what

| Concern | Lives in |
|---|---|
| What a query means | extensions |
| Which extensions are on, their settings, the script protocol | `lib/Extensions.js` |
| Ranking, grouping, help, mode chips | `lib/Engine.js` |
| Processes, files, the network | `Punctum.qml` |
| Carrying out actions | `Punctum.qml` (`perform`) |
| Persisted state | `bin/punctum-cache`, `~/.cache/punctum/` |

An extension that follows the contract only *proposes* actions from a short
list the bar carries out. For JS extensions that's a convention: they run
inside the shell, where QML's `Qt` object could build a process, so they're
trusted code. For script extensions it's a boundary on shape: the bar
validates every row and action they print and labels the actions itself, and
they never touch the shell; but an `argv` action runs whatever program the
script names.

## Limits

- A changed provider file needs `omarchy-restart-shell`: Quickshell caches the
  files it has imported. A rebuilt punctumd doesn't: `pkill -x punctumd` and
  the bar starts the new one.
- Script extensions run only in their mode; one that answered every keystroke
  would start a process per key.
- Script extensions run in a bubblewrap sandbox built from their manifest
  (`Ext.wrap`); JS extensions can't be sandboxed, since they run inside the
  shell, and their permissions stay labels.
