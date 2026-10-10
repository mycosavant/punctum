# WebAssembly extensions

An extension can be a WebAssembly component that punctumd runs in a sandbox.
It answers every keystroke, the way the bar's own native extensions do, and
it can be yours: drop it in `~/.config/omarchy/punctum/extensions/<id>/`.
[`examples/wasm-roman`](../examples/wasm-roman) is one to copy from.

| | js | script | wasm |
|---|---|---|---|
| Runs | inside the shell, unsandboxed | a process per query, in bubblewrap | inside punctumd, in a WebAssembly sandbox |
| Fast enough for every keystroke | yes | no: it needs a mode | yes |
| Can run programs | through the bar | yes, inside its sandbox | only those its manifest names, through the bar |
| Written in | JavaScript | anything | anything that builds a WebAssembly component: Rust, C, Go, Python, JS |

Use a script extension to wrap a tool (ripgrep, plocate, a web API); use
WebAssembly for logic (converters, lookups, ranking).

## What it can touch

Nothing, unless its manifest asks the bar:

- **Files, environment, network:** none. It gets WASI with nothing in it: no
  folders, no environment variables, no arguments, no sockets, its output
  discarded. It can read the clock and get random numbers.
- **Memory:** 64 MB. **Time:** 50 ms a query. A module that goes over, or
  panics, is stopped. The query gets an error, and the next query starts a
  fresh instance.
- **Programs:** only through the manifest, as for native extensions
  ([docs/native.md](native.md#the-manifest)). `loads` names commands whose
  output it may ask for (`load(key)`); the bar runs them. `actions` names what
  its rows may run on Enter, with its strings as whole arguments: never
  inside a script (after `-c`) or a command line (after `-e`, `env -S`,
  `exec`), and one that starts with `-` only after `--` or after a script,
  where it can't be read as an option. ?extensions lists those commands in
  full, as the manifest writes them. It can't have `searches`.
- **Its own commands and help examples:** copy text, or open a web or mail
  address. Nothing else, so they can't run a program or approve another
  extension.
- **Opening things:** web and mail addresses only, never a local file.
- **Its rows:** under its own heading ("Roman numerals · sandboxed"), never
  another's, and scored at most 97, an answer in its own mode.
- **What it's asked:** with a mode, only queries in that mode; without one,
  every query (?extensions says which).

Between queries it keeps its instance, so it can cache. When the bar closes,
the instance starts afresh, so nothing it saw (your queries, your clipboard
history) outlives the open it was for.

## Trust: the hash and the source

A WebAssembly extension must come with its source: `"source"` names a file or
folder in its own folder, and without it the extension isn't loaded. It's
**off until you approve it** in `?extensions`. Its row shows:

    Not approved · sandboxed · sha256 c96300e4aa7de41d…377bf8 · 54 KB · source src/ ·
    Enter approves this build · yours · asked about queries matching ^\s*roman\s ·
    runs nothing · roman 2026: Roman numerals …

Enter approves exactly the build that row showed: the SHA-256 of the module,
and one of its manifest together with every helper in its folder that its
commands run (`{dir}/…`), are kept in the bar's cache (`wasm-trust.json`). If
any of them changes (a new build, a manifest that names other commands, an
edited helper) it's off again and the row says it changed. A helper must be
yours and not writable by others, like a script extension's command.
`"source"` can't be the folder itself or a module. Shift+Enter opens the
source folder. Rebuild it yourself and compare the hash: `sha256sum
roman.wasm`.

In results, its group heading says *sandboxed*: "Roman numerals · sandboxed".
The hash appears only in `?extensions`, where you decide.

## Writing one

The interface is [`native/punctumd/wit/extension.wit`](../native/punctumd/wit/extension.wit),
`punctum:extension@1.0.0`. A component exports one function and may import
one:

```wit
import load: func(key: string) -> option<string>;
export respond: func(query: string, settings: string, now-ms: s64) -> answer;
```

`settings` is its section of the config as JSON, manifest defaults merged
with yours. `answer` is rows, each with a title, subtitle, icon, score, what
Ctrl+C copies, and what Enter and Shift+Enter do: `open`, `copy`, `paste`, or
`run`, one of the manifest's actions.

In Rust, with [wit-bindgen](https://docs.rs/wit-bindgen):

```rust
wit_bindgen::generate!({ path: "path/to/extension.wit", world: "extension" });

struct Mine;
impl Guest for Mine {
    fn respond(query: String, settings: String, now_ms: i64) -> Answer { … }
}
export!(Mine);
```

Build for `wasm32-wasip2` (`rustup target add wasm32-wasip2`, or Arch's
`rust-wasm`); the result is already a component. The manifest:

```json
{
  "schema": 1, "id": "roman", "name": "Roman numerals", "version": "1.0.0",
  "description": "roman 2026: Roman numerals both ways",
  "type": "wasm", "module": "roman.wasm", "source": "src",
  "mode": { "pattern": "^\\s*roman\\s", "label": "Roman" },
  "help": [...], "commands": [...], "loads": {...}, "actions": {...}
}
```

With a `mode`, it's asked only about queries in it: the rest of what you
type never reaches it. Without one it's asked about every query, so it
should answer nothing quickly when the query isn't for it.

## How it runs

The bar's `bin/punctum-extensions` reads the module (at most 32 MB), and its
SHA-256, and sends it to punctumd once you've approved it and it's on:

```jsonc
→ {"id": "wasm\nroman", "op": "wasm", "ext": "roman", "module": "<base64>", "sha256": "c963…"}
← {"id": "wasm\nroman", "ok": true, "sha256": "c963…"}
→ {"id": "wasm\nroman", "op": "wasm", "ext": "roman", "module": null}   // off: dropped
```

punctumd checks the hash, compiles the module with
[wasmtime](https://wasmtime.dev) (Cranelift), and answers its queries like a
native extension's. One with a built-in's id answers in its place. punctumd
itself still reads no files: the module comes over the pipe.

## Tests

`cargo test` runs [`tests/wasm.rs`](../native/punctumd/tests/wasm.rs). It
builds a guest that misbehaves on request (`tests/guests/misbehave`): it
loops forever, takes 200 MB, panics, reads `/etc/passwd`, lists `/`, counts
environment variables and opens a socket. The test checks the sandbox stops
each one. `node tests/run.js` checks the manifest rules, approval, the
?extensions row and, once `examples/wasm-roman/build` has run, the example
end to end.
