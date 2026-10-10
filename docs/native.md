# Native extensions and punctumd

Some of the bar's own extensions are written in Rust and run in **punctumd**, a
small daemon the bar keeps running beside it. Units is the first. Each one
keeps its JS provider as a fallback, so the bar works the same without
punctumd. The plan is to move the bundled extensions over one at a time, and
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

// anything it can't answer
← {"id": …, "error": "no extension \"x\""}
```

The bar uses the extension id and query as the request id, and caches each
answer until the config changes. While an answer is on its way,
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
   on any difference.

Numbers are formatted by `format.rs`, which matches `Engine.format` and
JavaScript's `String(n)` digit for digit, ties included. For example,
198684442655728.125 prints as …728.12 in both.

## Tests

```sh
cargo test                      # the Rust extensions and the protocol
cargo build && node tests/run.js  # the bar, with units through punctumd and through its fallback
node tests/units-parity.js      # JS and Rust units agree
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
