# Writing a provider

A feature is a *provider*: one JavaScript file in `providers/` that turns a
query into rows. This page describes the contract as it is today. The
[extensions proposal](proposal-extensions.md) describes how it could become
something you drop in without editing the plugin.

## The smallest provider

```js
.pragma library

var provider = {
  id: "shout",                 // also the key of its settings in the config
  name: "Shout",               // the group heading
  icon: "󰔊",                   // a Nerd Font glyph
  match: function(query, ctx) {
    var m = String(query || "").match(/^\s*shout\s+(.+)$/i)
    if (!m) return []          // not for this provider: return nothing
    var loud = m[1].toUpperCase()
    return [{ title: loud, subtitle: "Enter copies", score: 95, copy: loud }]
  }
}
```

To turn it on:

1. Import it in [`providers/index.js`](../providers/index.js)
   (`.import "shout.js" as Shout`) and add `Shout.provider` to the list.
2. Add `"shout"` to `"providers"` in `config.default.json`.
3. `omarchy-restart-shell`.

`.pragma library` files are shared and stateless between calls: keep state in
`ctx`, not in module variables (a lookup table built once is fine).

## A row

| Field | Meaning |
|---|---|
| `title`, `subtitle` | The two lines |
| `score` | Ranking across all providers. 98 an exact answer to a mode or keyword; 90-97 strong; 70 time and app matches; 40 placeholders ("Searching…") |
| `copy` | What Enter copies when there's no `run`. `""` for nothing |
| `run` | What Enter does (below) |
| `alt` | What Shift+Enter does, same shape as `run`. Give it a `label` |
| `complete` | What Tab puts in the search field (`"pkg "`) |
| `icon`, `image` | A glyph, or an icon name or image path drawn instead |
| `swatch` | A colour drawn as the icon tile |
| `group` | A heading other than the provider's name |
| `fallback: true` | Shown only when no other provider answered |
| `appId`, `pinned` | Marks an app row Alt+P can pin |

### Actions (`run`, `alt`)

The bar, not the provider, carries out an action, and only these kinds exist:

| `kind` | Fields | Does |
|---|---|---|
| `open` | `target` | `xdg-open target` |
| `copy` | `target` | Text to `wl-copy` on stdin |
| `paste` | `target` | Copy, then Shift+Insert into the previous window |
| `argv` | `target: [...]` | Runs the argument list, no shell |
| `edit` | `target`, `line` | Opens your editor at the line |
| `note` | `target`, `path` | Appends a line to a note |
| `shell` | `target`, `arg` | `bash -c target commandbar arg`: the typed text is `$1`. Only for keyword commands |
| `app`, `window` | `target` | Launch an app, focus a window |

Every action can have a `label`, which the footer shows ("open", "install").
**Never build a shell string from typed text.** Use `argv`, or a constant
script with the text as an argument.

## Context (`ctx`)

| Field | What |
|---|---|
| `settings` | This provider's section of the merged config |
| `home` | The home folder |
| `now()` | The current `Date` (tests pin it) |
| `format(n)`, `plain(n)` | Number formatting |
| `apps`, `windows`, `processes`, `emojis`, `zones`, `rates` | Data the bar already has |
| `clipboard`, `packages` | Loaded on request (below) |
| `search` | `{ key, text, timedOut }`, the output of the last background search |
| `inMode(q)` | Whether a query is in some feature's mode (`/`, `rg `…) |
| `keywords` | Keywords taken by the user's keyword commands |

## Other hooks on the provider

| Field | What |
|---|---|
| `commands` | Rows found by name ("unit" finds "Convert units"); an array or a function of `ctx` |
| `help` | Topics for the `?` list, each with live examples; an array or a function of `ctx` |
| `empty(ctx)` | Rows for the empty bar (pinned apps use it) |

Add a mode chip in `mode()` in [`lib/Engine.js`](../lib/Engine.js) and a help
position in `HELP_ORDER` there.

## Background work

`match` must return straight away. Anything slow runs as a process, and the
provider is called again when it lands:

```js
var p = { key: "mine\n" + text, argv: ["bash", "-c", SCRIPT, "commandbar-mine", text] }
var have = ctx.search
if (!have || have.key !== p.key) {
  if (ctx.requestSearch) ctx.requestSearch(p.key, p.argv)
  if (!have || have.key.indexOf("mine\n") !== 0) return [{ title: "Searching…", score: 40, copy: "" }]
}
// parse have.text into rows; have.timedOut means it was stopped at 3 s
```

- One background search runs at a time, shared by all providers. A newer key
  stops the old process; output is filed only under the key that asked.
- Make the key start with your provider's id, so you can tell your output from
  another provider's.
- Bound slow commands inside the script with `timeout 3`: stopping bash
  doesn't stop the pipeline under it.
- Clipboard history, the package list and the file walker have hooks of their
  own (`requestClipboard`, `requestPackages`, `requestFiles`). A new kind of
  data today means new code in `CommandBar.qml`; the proposal removes that.
- Help previews call `match` with every `request*` hook set to `null`, so
  check a hook exists before calling it.

## Tests

`node tests/run.js` runs every provider in Node with fixed data: no shell, no
network. Add checks there:

```js
{ const r = run("shout hi", ["shout"])
  check("shout: upper case", r[0].title === "HI") }
```

For anything that runs a command, run it for real with a hostile input
(`$(touch <marker>)`) in a temporary folder and check nothing happened. Then
break your code on purpose and make sure the test fails.
