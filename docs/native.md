# Native extensions and punctumd

Some of the bar's own extensions are written in Rust and run in **punctumd**, a
small daemon the bar keeps running beside it. Each one keeps its JS provider
as a fallback, so the bar works without punctumd.

| Extension | Rust file | What the Rust version uses | Where it does better than the JS |
|---|---|---|---|
| Apps | `apps.rs` | [nucleo-matcher](https://docs.rs/nucleo-matcher) (Helix's fuzzy matcher), [icu_collator](https://docs.rs/icu_collator) | Finds an app by its letters in order from the start of a word (`frfx` → Firefox, `spfy` → Spotify), ranked below everything the old rules find. Ties sort by Unicode collation, as `localeCompare` does |
| Windows | `windows.rs` | nucleo-matcher | Finds a window by its title's letters in order (`w gthb` → GitHub, `w rqst` → Pull request), after everything the old rules find |
| Calculator | `calc.rs` | [libm](https://docs.rs/libm) (the fdlibm JavaScript's `Math` uses), [fend-core](https://docs.rs/fend-core) | The same grammar and answers. What it can't read, fend may answer with a plain number, ranked below: `100!` in full, `0xff + 1`, `255 to hex`, `10 choose 3`, `sin(90°)`, `sqrt(-4)`. A unit or currency answer is left to those extensions, and fend gets 50 ms at most |
| Units | `units.rs` | — | Nothing yet: a port, digit for digit |
| Time | `time.rs` | [jiff](https://docs.rs/jiff) and the system's tzdata | Every IANA zone by name or city. Converted times use the offset at that moment, which is right across DST changes. A misspelled zone in your config is left out instead of shown as UTC. A month added to the 31st ends on the month's last day |
| Colour | `colors.rs` | [csscolorparser](https://docs.rs/csscolorparser) | Reads every CSS colour function (`hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `rgb()` with percentages) and `#rgba` hex, and adds an OKLCH row. Colour names stay words. The `formats` setting adds HSV, HWB, LAB, LCH, OKLAB, CMYK, `vec4`, decimal and `0x` forms. `#fff on #333` gives the WCAG contrast ratio and the levels it passes. A colour shows its contrast on white and black. The screen colour picker does what `afterPick` (Enter) and `afterPickAlt` (Shift+Enter) say: copy it in `copyFormat`, open the bar on it, or both; another picks a text colour and a background for their contrast. `pick ` lists the history and copies it as the `exports` you keep (CSS, SCSS, JSON, Tailwind, GIMP palette) |
| Hotkeys | `hotkeys.rs` | nucleo-matcher | In `keys` mode, finds a binding by its label's letters in order (`keys fllscrn` → Full screen), after everything the old rules find |
| Clipboard | `clipboard.rs` | [serde_json](https://docs.rs/serde_json) | Nothing new: a port. Says it's reading the history instead of calling it empty while the file loads |
| Packages | `packages.rs` | — | A port; about 1 ms a keystroke over 15,000 packages, against 6 ms in JS |
| Reminders | `remind.rs` | jiff, [fancy-regex](https://docs.rs/fancy-regex) | A port. Dates are worked out with jiff in the system's zone, as the JS's `Date` does, and the parity check holds across clock changes in six zones |
| Web address | `url.rs` | [psl](https://docs.rs/psl) (Public Suffix List), [idna](https://docs.rs/idna), `std::net` | A bare name needs a real top-level domain, so `mr.smith` and `notes.txt/` stay words. Private-network names (`.local`, `.lan`, `.internal`, `home.arpa`, …) still open |

Time zones come from `/usr/share/zoneinfo`, the same data `date` reads, which
the distribution keeps current. punctumd falls back to a copy built into the
binary only where the system has none. A copy compiled in goes stale. The
first time port used one, and the parity check caught it: it disagreed with
`date` about Vancouver's offset in December 2026.

punctumd runs no programs. Extensions that need a program's output
(keybindings, the clipboard history, the package list, Omarchy's reminders,
the colours you picked) and ones whose rows run something on Enter name
those commands in their manifest (see [the manifest](#the-manifest)); the bar
runs them and passes the output in. So every program a native extension can
cause to run is listed in its `extension.json`.

The plan is to move the bundled extensions over one at a time, and
later to run third-party extensions in punctumd as WebAssembly, where they can
be sandboxed even though they answer every keystroke.

## Why a daemon

QML can only load JavaScript, and the plugin has to be QML. So the bar stays a
thin QML layer: the window, the keys, the processes, carrying out actions.
Deciding what a query means can live anywhere that answers fast. punctumd
answers in well under a millisecond, and one process serves every keystroke,
so no process starts per key the way a script extension's does.

That gets the project:

- tested Rust libraries where the JS has hand-written code (time zones,
  arithmetic, units),
- `cargo test`,
- new extension code without restarting the shell: `pkill -x punctumd` and the
  bar starts the rebuilt one,
- room for a real sandbox for extensions that answer every keystroke, which JS
  extensions inside the shell can't have.

## Getting it

`omarchy plugin add` only clones the repository and never builds or runs
anything, so a plain install starts with the JavaScript versions. There are
three ways to get punctumd from there.

**From the bar.** `?extensions` opens with a *Native extensions* row. It says
whether they run in Rust or JavaScript, what punctumd is and what it touches.
Enter starts the switch in a terminal, through `bin/punctum-native`. That
script shows what it is about to do and asks before doing it:

| You have | Enter | Shift+Enter |
|---|---|---|
| cargo | build it from `native/` in the plugin folder | download the release instead, if there is one |
| no cargo, a release for this version | download it and check its SHA-256 against `native/checksums.txt` | |
| neither | copy `sudo pacman -S rust` | |
| punctumd in the plugin's `bin/` | rebuild (or download again) | remove it: back to JavaScript |
| punctumd from a package | (nothing to do here) | |

The build runs in `~/.cache/punctum/native-target`. The shell reloads the
plugin for every file written under `~/.config/omarchy/plugins/`, so
building there would make it reload over and over. Only the finished binary
is copied into `bin/`. A download is checked against `native/checksums.txt`,
which is in git, so a new checksum shows in the diff that
`omarchy plugin update` shows before it pulls. Nothing uses sudo.

**From a package.** `packaging/arch/` has `punctumd` (from a tagged source
release, with `cargo test` in `check()`), `punctumd-bin` (the release binary,
unstripped so its SHA-256 still equals the release's) and `punctumd-git`
(latest main). Each installs only `/usr/bin/punctumd`, which the bar finds
on `PATH`; the plugin itself still comes from `omarchy plugin add`.

**By hand.** `cargo build --release` in a clone, then copy
`target/release/punctumd` into the plugin's `bin/` and run
`pkill -x punctumd`.

The bar looks for punctumd in this order: the plugin's `bin/punctumd`, then
its `target/release/punctumd`, then `punctumd` on `PATH`. It looks at
startup, whenever punctumd stops, and on each open while none is running, so
a new one is picked up without restarting the shell. When punctumd stops,
the bar starts it again: it waits 0.5 s before the first try and doubles the
wait each time. After five failures in a row without a hello it stays on the
fallbacks until the next open.

## Releasing it

1. Bump the version in `manifest.json` and `native/punctumd/Cargo.toml`.
   `native/release-build` refuses to build if they differ.
2. Tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` runs
   `native/release-build` and attaches the static (musl) binaries and their
   `.sha256` files to a **draft** release.
3. Rebuild from the tag yourself with `native/release-build` and compare the
   checksums. The build is reproducible: the toolchain is pinned and paths
   are remapped, and two checkouts in different folders give the same
   bytes.
4. Publish the draft, add its lines to `native/checksums.txt`, and update
   `pkgver` and the checksums in `packaging/arch/*/PKGBUILD` (`updpkgsums`,
   then `makepkg --printsrcinfo > .SRCINFO`).

## The protocol

punctumd reads requests on stdin and answers each on its own line of stdout,
in order, one JSON object per line. It exits when stdin closes.

```jsonc
// hello: what this punctumd serves. The bar sends it first.
→ {"id": "hello", "op": "hello"}
← {"id": "hello", "protocol": 1, "version": "0.1.0", "extensions": ["units"]}

// match: one query for one extension ("op" defaults to "match")
→ {"id": "units\n5 km to mi", "ext": "units", "query": "5 km to mi", "settings": {}}
← {"id": "units\n5 km to mi", "rows": [{"title": "3.1069 mi", "subtitle": "5 km → mi · Length",
                                        "icon": "󰑭", "score": 90, "copy": "3.1069"}]}

// an answer that reads the clock says how many ms it holds
→ {"id": "time\ntime in tokyo", "ext": "time", "query": "time in tokyo", "settings": {...}}
← {"id": "time\ntime in tokyo", "rows": [...], "ttl": 41250}

// the shell's state an extension needs, sent when it changes and after each
// hello: apps, launches, pinned, windows (the only keys it takes)
→ {"id": "data", "op": "data", "key": "apps", "value": [{"id": "firefox", "name": "Firefox", ...}]}
← {"id": "data", "ok": true}

// a load: the output of a command the extension's manifest lists under
// "loads", which the bar ran because an answer said it needed it; null drops it
→ {"id": "load", "op": "load", "ext": "packages", "key": "list", "text": "Q\tkfind\t25.08-1\n…"}
← {"id": "load", "ok": true}

// an answer that read a load (or wanted one it didn't have yet) says so
→ {"id": "packages\npkg kfind", "ext": "packages", "query": "pkg kfind", "settings": {}}
← {"id": "packages\npkg kfind", "rows": [{"title": "Reading the package list…", …}], "needs": ["list"]}

// tests fix the clock and the system zone; the bar never sends these
→ {"id": 1, "ext": "time", "query": "time", "now": 1790152230000, "local_zone": "Asia/Colombo"}

// anything it can't answer
← {"id": …, "error": "no extension \"x\""}
```

Rows may carry `run` and `alt` actions: open, copy, paste and edit, checked
the way a script's are; the bar's own `app` (an id of letters, digits and
`._+-`, and an optional action index) and `window` (a `0x…` address); and
`action`, one of the manifest's actions by name:

```jsonc
{"kind": "action", "name": "install", "args": ["kfind", "extra/kfind"], "input": "…"}
```

A native row can't name a program (`argv` is refused). Its `action` gets the
manifest's command with `args` in place of `{1}`…`{9}`, each a whole
argument, and its `input` on stdin if the manifest says `"input": true`; an
action the manifest doesn't list, or one missing an argument, is dropped. The
footer shows the manifest's label. Rows may also set `swatch`, `image`,
`group`, `complete`, `appId` and `pinned`, each checked too.

Apps, windows and hotkeys share the letters-in-order rule: three characters
or more, the first letter at the start of a word, each next letter in the
same word or at the start of the next one, and all of them close together
(spanning at most twice the query's length plus two). So `fllscrn` finds Full
screen, but `men` doesn't find Move window. A manifest with `"empty": true`
has its answer to `""` listed on the empty bar (Apps' pinned apps).

An answer's `needs` lists the loads it read or wanted, by the manifest's
keys. The bar runs each one's command through the same queue as a JS
extension's `ctx.load` (once per open, or again after its `ttl`), sends the
output with `op: "load"`, drops that extension's cached answers and asks
again. When the bar closes it sends `null` for every load read for that open,
so the clipboard history and the package list don't stay in punctumd's
memory, and drops its cache of punctumd's answers too. A load the bar keeps
on a timer (keybindings) is sent again only when its text changes, and
again after punctumd restarts.

When the bar sends new shell state, it drops every cached answer and every
answer still coming, since those used the old state. Requests and replies
share one pipe, in order, so a query sent after the state is answered with
it.

The bar uses the extension id and query as the request id, and caches each
answer until the config changes or its `ttl` runs out. A stale answer stays
on screen until the fresh one arrives, so a clock doesn't flicker. While a
first answer is on its way,
`ctx.native(query)` returns null and the extension shows nothing. When the
answer arrives, the bar runs the query again. Rows go through the same checks
as a script's rows (`Ext.nativeProvider`), except that they keep their own
scores. A panic inside an extension becomes an `error` reply for that request.
The daemon keeps running.

## The manifest

```jsonc
{
  "schema": 1, "id": "packages", "type": "native",
  "entry": "provider.js",   // optional: the JS fallback
  "help": [...], "commands": [...],   // from the manifest, as for scripts
  // Output punctumd may ask for, by key. ttl (ms) keeps it and reads it
  // again when it's older; without one it's read once per open.
  "loads": {
    "list": { "command": ["bash", "-c", "expac -Q 'Q\\t%n\\t%v' && …"] }
  },
  // What its rows may run on Enter, by name.
  "actions": {
    "install": {
      "command": ["uwsm-app", "--", "xdg-terminal-exec", "--title=Install {1}", "-e",
                  "bash", "-c", "sudo pacman -S -- \"$1\"", "punctum-pkg", "{2}"],
      "label": "install",
      "input": false        // true: the row's "input" goes on stdin
    }
  }
}
```

In both, `{omarchy}` is Omarchy's folder, `{home}` your home and `{dir}` the
extension's folder. `{1}`…`{9}` are an action's arguments from punctumd. They
can't appear in a load, nor in the argument after a `-c`, where a string
would become code; such a manifest is refused. Put them in a script's
arguments and read them as `$1`, `$2`.

Only bundled extensions can be native. The bar refuses `"type": "native"` from
your extensions folder, because native code is compiled into punctumd and is
not loaded from that folder.

## Adding one

1. Write `native/punctumd/src/<id>.rs` with a type that implements
   `Extension` (`id` and `matches`), and add it to `extensions()` in `lib.rs`.
2. Port the JS provider's tests to `#[cfg(test)]` in the same file.
3. Set the manifest's `"type"` to `"native"`, keep `"entry"` as the fallback,
   and move `help` and `commands` into the manifest. Commands the JS ran
   with `ctx.load` become `loads`, read with `ctx.load(key)` in Rust (which
   adds the key to the answer's `needs`); `argv` actions become `actions`.
   Keep a parse of a load in a `Memo`, so it's done once per text.
4. Add a parity test like [`tests/units-parity.js`](../tests/units-parity.js).
   It puts thousands of queries to both the JS and the Rust provider and fails
   on any difference. Where the Rust version is better on purpose, pin the new
   behaviour in its Rust tests and have the parity check count those queries
   apart, by a rule narrow enough that nothing else hides under it
   (`time-parity.js` and `url-parity.js` do this). CI runs every
   `tests/*-parity.js`.

Numbers are formatted by `format.rs`, which matches `Engine.format` and
JavaScript's `String(n)` digit for digit, ties included. For example,
198684442655728.125 prints as …728.12 in both.

## Tests

```sh
cargo test                      # the Rust extensions and the protocol
cargo build && node tests/run.js  # the bar, with native extensions through punctumd and through their fallbacks
for t in tests/*-parity.js; do node "$t"; done   # each native extension agrees with its JS
```
