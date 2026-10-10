# Contributing

Thanks for helping. Bug reports, fixes and new features are all welcome.

## Before you start

- For a bug, open an issue with what you typed, what you expected and what happened.
- For a new feature, open an issue first so we can agree on it before you build it.
- Keep pull requests small and focused on one thing.

## Working on the plugin

Clone your fork into Omarchy's plugin folder so the shell loads it:

```sh
omarchy plugin remove io.github.mycosavant.punctum   # if the released version is installed
git clone https://github.com/<you>/punctum ~/.config/omarchy/plugins/io.github.mycosavant.punctum
omarchy plugin enable io.github.mycosavant.punctum
```

Keep only one copy in that folder. Two copies register the same plugin ID.

After changing the code, run `omarchy restart shell` to load it. The shell reloads plugins on its own when files change, but that isn't always reliable, so restart before you decide something works. `journalctl --user -f | grep -i punctum` shows the bar's warnings and errors.

New features are extensions: a folder in `extensions/` with an `extension.json`. [docs/writing-extensions.md](docs/writing-extensions.md) has the format; `examples/hello` is the smallest one. Bundled extensions are moving to Rust in `native/punctumd`; [docs/native.md](docs/native.md) covers building it and porting one.

## Tests

```sh
cargo test                  # native extensions (punctumd)
cargo build && node tests/run.js
node tests/units-parity.js  # the Rust and JS units agree
```

All tests must pass, and CI runs them on every push and pull request. Add tests for anything you add or fix, and break your change once to see the test fail. They run without the shell, using sample rates, time zones and processes; a few run real `bwrap`, `plocate`, `fd` and `fzf`.

## Rules

Punctum is meant for the Omarchy plugin marketplace, whose automated security check and review require these:

- Don't ask for administrator rights, and don't start, stop or change system services. The marketplace's automated check flags these.
- Don't download something and then run it.
- Don't add network requests unless the feature needs one, and only make them when the user asks for that feature.
- Don't write to the user's config files. The bar keeps its own state only in `~/.cache/punctum/`; an extension that writes elsewhere says so in its manifest's `permissions`.
- Keep the defaults neutral. Personal choices, such as a currency, time zone or hotkey, go in your own `~/.config/omarchy/extensions/punctum.json`, not in `config.default.json`.
- Never put what the user types into a shell string. Use argument lists, or pass it as an argument or on stdin to a constant script. See `{q}` handling in `extensions/commands/provider.js`.
- List any new command-line tool in the README's Dependencies section.

## License

By contributing, you agree that your changes are released under the project's [MIT license](LICENSE).
