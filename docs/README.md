# Command Bar documentation

A Spotlight-style command bar for Omarchy, opened with **Super+Period**. Type
and it answers: apps, windows, files anywhere on the disk, lines inside files,
clipboard history, sums, conversions, packages, scripture, web searches.

This is the hypha fork of
[Saikomantisu/omarchy-commandbar](https://github.com/Saikomantisu/omarchy-commandbar).
The top-level [README](../README.md) has the quick table; these pages go deeper.

| Page | What it covers |
|---|---|
| [Features](features.md) | Every feature: what to type, what Enter and Shift+Enter do, what it reads |
| [Everywhere](everywhere.md) | The file search: how it finds, ranks and stays current, and its query syntax |
| [Configuration](configuration.md) | Every setting in `commandbar.json`, with defaults |
| [Security and privacy](security-and-privacy.md) | What runs, what is read, what leaves the machine, and how typed text is kept out of shell code |
| [Writing a provider](writing-a-provider.md) | Adding a feature today: the provider contract, async searches, tests |
| [Architecture](architecture.md) | How a keystroke becomes rows, and where each piece lives |
| [Extensions and release proposal](proposal-extensions.md) | Making features optional plugins others can write, releasing Everywhere on its own, and what a community release needs |

## In one minute

- **Open**: Super+Period. **Close**: Esc twice (the first clears the text).
- **Move**: Up/Down or Ctrl+N/P. **Do it**: Enter. **The other thing**:
  Shift+Enter (the footer names it). **Jump**: Alt+1 to Alt+9.
- **Help**: type `?`. Each topic shows live examples; Enter on one tries it.
- **Modes** start with a prefix, shown as a chip in the search field:

| Prefix | Mode |
|---|---|
| `/` | Everywhere: files anywhere on the disk |
| `~` | Files under your home folder, found live |
| `rg ` | Lines inside your files |
| `cb ` | Clipboard history |
| `pkg ` | Packages |
| `!` | Bangs (`!nasb john 3:16`) |
| `n ` | Add a line to your inbox note |
| `keys ` | Keybindings |
| `w ` | Open windows |
| `kill ` | Processes |
| `:` | Emoji |
| `?` | Help |

Anything else is matched by every feature at once: `firefox` finds the app,
`2+2` answers 4, `john 3:16` offers the verse, `mar 3` gives the date.

## Settings file

`~/.config/omarchy/extensions/commandbar.json` (JSONC: comments allowed). It is
merged over [`config.default.json`](../config.default.json): objects merge key
by key, lists replace. See [Configuration](configuration.md).

## After changing code

Run `omarchy-restart-shell`: Quickshell caches compiled components, so a code
change isn't live until the shell restarts. Settings changes don't need it.
`node tests/run.js` runs the tests without the shell.
