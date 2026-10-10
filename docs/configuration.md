# Configuration

Your settings go in `~/.config/omarchy/extensions/commandbar.json`. It is
JSONC, so `//` and `/* */` comments are fine. Create it if it doesn't exist.

It is merged over the bar's own [`config.default.json`](../config.default.json)
(hotkey, card, glass) and, for each extension, over the `defaults` in its
`extension.json`:

- **Objects merge key by key.** `{ "glass": { "opacity": 0.9 } }` changes the
  opacity and keeps `enabled`.
- **Lists replace.** `"bible": { "versions": [...] }` replaces the
  translations; `"commands": [...]` replaces the keyword commands.
- **`null` removes** a key from an object: `"bangs": { "engines": { "g": null } }`
  drops the `!g` bang.

Settings take effect when the bar next reads the file; code changes need
`omarchy-restart-shell`.

A short example:

```jsonc
{
  // Switch extensions off (or on) by id; ?extensions lists them all.
  "extensions": { "bible": false, "packages": false },
  "notes": { "inbox": "~/Vault/Inbox.md" },
  "bangs": { "engines": { "rust": { "title": "Rust docs", "open": "https://doc.rust-lang.org/std/?search={q}" } } },
  "contents": { "hidden": true }
}
```

## Top level

| Key | Default | Meaning |
|---|---|---|
| `hotkey` | `"SUPER + PERIOD"` | The key that opens the bar. If it's taken by another binding, the bar says so instead of binding over it |
| `extensions` | `{}` | `"id": false` switches an extension off, `true` on (`{ "enabled": false }` works too). Unlisted ones follow their manifest |
| `providers` | unset | The older form: a list of ids that are on, in order. If present, it decides alone. `locate` in it means `everywhere`, and a `"locate"` section still sets Everywhere's exclusions when there's no `"everywhere"` one |

Your own extensions go in `~/.config/omarchy/commandbar/extensions/<id>/`; see
[Writing extensions](writing-extensions.md). One with a bundled extension's
id replaces it.

## The card

| Key | Default | Meaning |
|---|---|---|
| `window.cx` | `0.5` | Horizontal centre, as a fraction of the screen width |
| `window.top` | `0.22` | Top edge, as a fraction of the screen height |
| `window.width` | `640` | Width in pixels |
| `window.rows` | `7` | Rows shown before the list scrolls |
| `glass.enabled` | `true` | Frosted glass (needs Hyprland blur) |
| `glass.opacity` | `0.78` | The card's opacity, 0.3 to 1 |

`window` is the default; once you drag or resize the card, the saved geometry
in `~/.cache/omarchy-commandbar/geometry.json` wins until you run "Reset
command bar position".

## Features

### `everywhere` (`/`)

| Key | Default | Meaning |
|---|---|---|
| `exclude` | `["/.cache/", "/.cargo/registry/", "/.cargo/git/", "/node_modules/", "/.local/share/Trash/", "/.git/"]` | Paths containing any of these strings are left out (case-insensitive) |

### `files` (`~`)

| Key | Default | Meaning |
|---|---|---|
| `hidden` | `false` | Include dot-files and dot-folders (`.git` is still skipped) |

### `contents` (`rg `)

| Key | Default | Meaning |
|---|---|---|
| `hidden` | `false` | Include hidden files and folders. Git-ignored files stay skipped |

### `remind`

No settings. `remind 10m tea`, `alarm 6:45`; see [Features](features.md#reminders-and-alarms--remind--alarm--remindme--remind).

### `bible`

| Key | Default | Meaning |
|---|---|---|
| `versions` | `["NASB", "NASB1995", "ESV", "KJV"]` | Translations, first on top, as Bible Gateway names them (letters, digits and `-`, up to 16) |

### `bangs`

| Key | Default | Meaning |
|---|---|---|
| `engines` | 13 bangs (see below) | `name → { title, open, home? }`. Merged by name over the defaults |
| `fallback` | `"https://duckduckgo.com/?q={q}"` | Where a bang not in `engines` goes, with the whole query. `""` keeps unlisted bangs in the bar |

An engine:

```jsonc
"nasb": {
  "title": "Bible (NASB)",                                   // shown on the row
  "open": "https://www.biblegateway.com/quicksearch/?quicksearch={q}&version=NASB",
  "home": "https://www.biblegateway.com/"                   // optional: Enter on a bare !nasb
}
```

- A name is letters, digits, `.`, `_` and `-`, up to 25 characters.
- `open` and `home` must be `http://` or `https://`; anything else is ignored.
- `{q}` is URL-encoded.
- `"g": null` drops a default.

Defaults: `nasb`, `bible` and `nasb95`, `esv`, `kjv` (Bible Gateway), `ddg`,
`g`, `w` (Wikipedia), `yt`, `gh`, `aw` (Arch Wiki), `ap` (Arch packages),
`maps` (OpenStreetMap).

### `notes` (`n `)

| Key | Default | Meaning |
|---|---|---|
| `inbox` | `""` | The note to append to. Absolute or `~/…`. The folder must exist |
| `format` | `"- {date} {time} {text}"` | The line. Must contain `{text}` |

### `apps`

| Key | Default | Meaning |
|---|---|---|
| `pinned` | `[]` | Desktop ids of pinned apps (`"org.kde.kate"`). Pinning with Alt+P saves its own list in the cache, which then wins |

### `math`, `currency`, `time`, `emoji`, `ai`

| Key | Default | Meaning |
|---|---|---|
| `math.precision` | `10` | Significant digits |
| `currency.home` | `"USD"` | Your currency |
| `currency.favorites` | `["EUR", "GBP"]` | Shown for a bare amount |
| `time.home` | your system zone | Your zone |
| `time.zones` | `["UTC", "America/New_York", "Europe/London"]` | Shown for `time` |
| `time.clock24` | `true` | `false` for 12-hour times |
| `emoji.onEnter` | `"paste"` | `"copy"` to only copy |
| `ai.keyword` | `"ai"` | The keyword |
| `ai.fallback` | `false` | Offer "Ask…" when nothing else answers |
| `ai.chats` | ChatGPT, Claude | `{ title, open }` chat sites, `{q}` URL-encoded |

### `commands`

A list of keyword commands. Each has `keyword`, `title`, and either `open` (a
URL with `{q}`) or `run` (a bash command where `{q}` is the typed text).
Optional: `keywords` (extra words to find it by), `icon`. The list replaces
the defaults, so copy the ones you want to keep. See
[Features](features.md#keyword-commands) and
[Security and privacy](security-and-privacy.md#typed-text-and-the-shell).

## Files the bar keeps

All under `~/.cache/omarchy-commandbar/`, mode 600 in a 700 folder:

| File | What |
|---|---|
| `geometry.json` | Where you left the card |
| `pinned-apps.json` | Your pins |
| `launches.json` | How often you open each app, for ranking |
| `last-query` | The text you closed the bar with, so it comes back |
| `rates.json` | The last exchange rates, so currency works offline |

Each goes through `bin/commandbar-cache`, which knows only these names, caps
each file's size, refuses symlinks and files it doesn't own, and writes
through a private temporary file and a rename.

Everywhere keeps its index of your home folder at
`~/.cache/everywhere/home.db` (mode 600 in a 700 folder), and reminders keep
their messages where Omarchy's do, in `$XDG_RUNTIME_DIR/omarchy-reminders/`.

Delete the folder to reset all of it.
