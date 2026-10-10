# Punctum documentation

The extensible command bar for Linux, a plugin for Omarchy's shell, opened with **Super+Period**. Type
and it answers: apps, windows, files anywhere on the disk, lines inside files,
clipboard history, sums, conversions, packages, web searches.

It started as
[Command Bar](https://github.com/Saikomantisu/omarchy-commandbar) by Saikomantisu.
The top-level [README](../README.md) has the quick table; these pages go deeper.

| Page | What it covers |
|---|---|
| [Features](features.md) | Every feature: what to type, what Enter and Shift+Enter do, what it reads |
| [Everywhere](everywhere.md) | The file search: how it finds, ranks and stays current, and its query syntax |
| [Configuration](configuration.md) | Every setting in `punctum.json`, with defaults |
| [Security and privacy](security-and-privacy.md) | What runs, what is read, what leaves the machine, and how typed text is kept out of shell code |
| [Writing extensions](writing-extensions.md) | Your own features: the manifest, script extensions in any language, JS extensions, actions, tests |
| [Architecture](architecture.md) | How a keystroke becomes rows, and where each piece lives |
| [Extensions and release proposal](proposal-extensions.md) | Making features optional plugins others can write, releasing Everywhere on its own, and what a community release needs |
| [Agent proposal](proposal-agent.md) | `>_`: from a doorway to the default agent to answers in the bar |
| [Naming](release/naming.md) | How the name was chosen, and the [checks on it](release/punctum-checks.md) |

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
| `remind `, `alarm `, `!remindme ` | Reminders and alarms |
| `!` | Bangs (`!w hyprland`) |
| `>_ `, `> `, `ai ` | Ask your default agent |
| `n ` | Add a line to your inbox note |
| `keys ` | Keybindings |
| `w ` | Open windows |
| `kill ` | Processes |
| `:` | Emoji |
| `?` | Help |

Anything else is matched by every feature at once: `firefox` finds the app,
`2+2` answers 4, `5 km to mi` converts, `mar 3` gives the date.

## Extensions

Every feature is an extension you can switch off (`"extensions": { "bible": false }`),
and you can add your own, as a script in any language or in JavaScript, in
`~/.config/omarchy/punctum/extensions/`. Type `?extensions` to see them
all and what each touches.

## Settings file

`~/.config/omarchy/extensions/punctum.json` (JSONC: comments allowed). It is
merged over [`config.default.json`](../config.default.json) and each
extension's defaults: objects merge key by key, lists replace. See
[Configuration](configuration.md).

## After changing code

Run `omarchy-restart-shell`: Quickshell caches compiled components, so a code
change isn't live until the shell restarts. Settings changes don't need it.
`node tests/run.js` runs the tests without the shell.
