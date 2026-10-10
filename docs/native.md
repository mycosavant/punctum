# Native extensions and punctumd

Some of the bar's own extensions are written in Rust and run in **punctumd**, a
small daemon the bar keeps running beside it. Each one keeps its JS provider
as a fallback, so the bar works without punctumd.

| Extension | Rust file | What the Rust version uses | Where it does better than the JS |
|---|---|---|---|
| Units | `units.rs` | — | Nothing yet: a port, digit for digit |
| Time | `time.rs` | [jiff](https://docs.rs/jiff) and the system's tzdata | Every IANA zone by name or city. Converted times use the offset at that moment, which is right across DST changes. A misspelled zone in your config is left out instead of shown as UTC. A month added to the 31st ends on the month's last day |
| Web address | `url.rs` | [psl](https://docs.rs/psl) (Public Suffix List), [idna](https://docs.rs/idna), `std::net` | A bare name needs a real top-level domain, so `mr.smith` and `notes.txt/` stay words. Private-network names (`.local`, `.lan`, `.internal`, `home.arpa`, …) still open |

Time zones come from `/usr/share/zoneinfo`, the same data `date` reads, which
the distribution keeps current. punctumd falls back to a copy built into the
binary only where the system has none. A copy compiled in goes stale. The
first time port used one, and the parity check caught it: it disagreed with
`date` about Vancouver's offset in December 2026. The plan is to move the bundled extensions over one at a time, and
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

## Building it

```sh
cargo build --release
```

The bar looks for punctumd in this order, at startup and whenever it stops:

1. `bin/punctumd` in the plugin folder (not in git; for a copied binary),
2. `target/release/punctumd`, from the build above,
3. `punctumd` on `PATH`, from a distribution package or `cargo install --path native/punctumd`.

If none is found, native extensions run their JS fallbacks, and
`?extensions` says so for each one. When punctumd stops, the bar starts it
again: it waits 0.5 s before the first try and doubles the wait each time.
After five failures in a row without a hello it stays on the fallbacks.

Building inside the installed plugin folder works, but the shell sees every
file cargo writes under `~/.config/omarchy/plugins/` and reloads the plugin
for each one. It's quieter to build elsewhere (your own clone, say) and copy
the one binary in: `install -m755 target/release/punctumd
~/.config/omarchy/plugins/io.github.mycosavant.punctum/bin/`, then
`pkill -x punctumd`.

`omarchy plugin add` only clones the repository and never builds anything, so
a plain install runs the fallbacks until you build punctumd or install a
package.

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

// tests fix the clock and the system zone; the bar never sends these
→ {"id": 1, "ext": "time", "query": "time", "now": 1790152230000, "local_zone": "Asia/Colombo"}

// anything it can't answer
← {"id": …, "error": "no extension \"x\""}
```

Rows may carry `run` and `alt` actions from the bar's short list (open, copy,
paste, edit, argv). The bar checks them the way it checks a script's actions.

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
  "schema": 1, "id": "units", "type": "native",
  "entry": "provider.js",   // optional: the JS fallback
  "hero": true,
  "help": [...], "commands": [...]   // from the manifest, as for scripts
}
```

Only bundled extensions can be native. The bar refuses `"type": "native"` from
your extensions folder, because native code is compiled into punctumd and is
not loaded from that folder.

## Adding one

1. Write `native/punctumd/src/<id>.rs` with a type that implements
   `Extension` (`id` and `matches`), and add it to `extensions()` in `lib.rs`.
2. Port the JS provider's tests to `#[cfg(test)]` in the same file.
3. Set the manifest's `"type"` to `"native"`, keep `"entry"` as the fallback,
   and move `help` and `commands` into the manifest.
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

## Shipping a binary

Omarchy's plugin installer clones the repository and runs nothing else, and
the marketplace's publishing rules say nothing about binaries either way.
There are three ways to get punctumd onto a machine:

- **A package**: AUR (`punctum-bin` or `punctum-git`), and later other
  distributions, installs `/usr/bin/punctumd`. The bar finds it on `PATH`.
  This is also how Punctum would ship outside Omarchy.
- **A release download**, which the bar would fetch and check on request. This
  is the Windscribe plugin's approach, but it is more code that has to be
  trusted.
- **Building from the clone**, with `cargo build --release`, for anyone with
  Rust installed.

Committing binaries to git is ruled out. Updates would be opaque blobs that
nobody can review, which defeats `omarchy plugin update` showing a diff.
