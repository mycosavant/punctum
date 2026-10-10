# Architecture

## The pieces

```
omarchy-shell (Quickshell, long-running)
└── CommandBar.qml            the overlay: input, list, keys, geometry, glass;
    │                         runs processes and carries out actions
    ├── lib/Engine.js         runs enabled providers, ranks, groups, help, mode chip
    ├── providers/index.js    the registry: every provider, imported statically
    ├── providers/*.js        one feature each: query → rows (pure functions)
    ├── lib/Geometry.js       card position and size (pure)
    ├── lib/Hotkey.js         binding the hotkey without stealing a taken one (pure)
    └── bin/                  small helpers the bar runs
        ├── commandbar-cache    the only reader and writer of the cache files
        ├── commandbar-note     appends to the inbox note
        ├── commandbar-edit     opens the editor at a line
        └── commandbar-agent    starts the default agent with a prompt
```

The manifest (`manifest.json`) declares one `overlay` entry point,
`CommandBar.qml`, with `keepLoaded: true`, so the window survives between
opens and opening costs no load time.

## A keystroke

1. The text changes; `CommandBar.qml` calls `Engine.run(text, config, services)`.
2. Engine builds a `ctx` for each enabled provider (its settings plus the
   data and request hooks the bar has) and calls `match`.
3. A provider that needs something slow calls a request hook
   (`requestSearch`, `requestFiles`, `requestPackages`, `requestClipboard`)
   and returns a placeholder or its previous rows.
4. Engine adds the rows found by name (`commands`), drops `fallback` rows if
   anything else answered, sorts by score, groups by heading, and marks a
   direct answer as the large "hero" row.
5. When a process lands, the bar stores its output and runs step 1 again.
6. Enter calls `activate()`, which hands the row's `run` to `perform()`;
   `perform()` carries it out by `kind`. Providers never run anything themselves.

## Who owns what

| Concern | Lives in |
|---|---|
| What a query means | providers |
| Ranking, grouping, help, mode chips | `lib/Engine.js` |
| Running processes, reading files, the network | `CommandBar.qml` |
| Carrying out actions | `CommandBar.qml` (`perform`) |
| Persisted state | `bin/commandbar-cache`, `~/.cache/omarchy-commandbar/` |
| Settings | `config.default.json` merged with the user's `commandbar.json` |

Keeping providers pure is what makes them testable in Node (`tests/run.js`)
with no shell, and it keeps what can happen on Enter to a short, reviewable
list: a provider that follows the contract only *proposes* an action. This is
a convention, not a sandbox: provider code runs inside the shell, where QML's
`Qt` object could build a process, so a provider is trusted code.

## Background processes

| Process | Started by | Bounded by |
|---|---|---|
| `searchProc` | `requestSearch` (Everywhere, Inside files) | one at a time; newest key wins; 3 s watchdog; `timeout 3` inside |
| `homeIndexProc` | `requestHomeIndex` | at most once a minute |
| `filesProc` | `requestFiles` (`~`) | one walk at a time; 3 s watchdog |
| `packagesProc` | `requestPackages` | once per open |
| clipboard `FileView` | `requestClipboard` | once per open |
| `hotkeysProc` | any query | at most every 30 s |
| `ratesProc` | a currency query | when stale, at most every 10 minutes |

All loaded data is dropped in `forget()` when the bar closes.

## Where it strains

- **Static registry.** QML `.import` is resolved when the file loads, so every
  provider is compiled in. A new feature means editing `providers/index.js`.
- **Per-feature plumbing in the bar.** Each kind of background data
  (clipboard, packages, files) has its own properties, process and request
  hook in `CommandBar.qml`, about 40 lines each. `requestSearch` is the
  general version and could absorb most of them.
- **One defaults file.** Every feature's defaults sit in `config.default.json`,
  so features can't be added or removed as units.

The [extensions proposal](proposal-extensions.md) addresses these.
