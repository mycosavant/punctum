# Features

Each feature is an extension: a folder in `extensions/` with an
`extension.json`. `"extensions": { "<id>": false }` in your config switches
one off; `?extensions` lists them all, on or off, with what each runs, reads,
writes and contacts. Features from upstream (calculator, currency, time,
units, emoji, windows, apps, processes, agent) are summarised at the end; the
[README](../README.md) table has their examples. To write your own, see
[Writing extensions](writing-extensions.md).

For each: what to type, what Enter and Shift+Enter do, and what it reads or
runs.

---

## Everywhere — `/`  (`everywhere`)

Files and folders anywhere on the disk, by name, as you type. Also a command
of its own (`everywhere`, with an fzf picker). [Everywhere](everywhere.md)
has the full account.

- `/notes`, `/dwnlds`, `/report .pdf$`, `/hosts !backup`, and filters:
  `/report ext:pdf dm:week`, `/dm:today`, `/size:>1G`
- **Enter** opens with the default app. **Shift+Enter** opens a terminal in its folder.
- **Runs** the `everywhere` command, a script extension, which runs `plocate`,
  `fzf` and, for its home index, `updatedb`. All local.

## Files under home — `~`  (`files`)

A live walk of your home folder with `fd`: always current, slower than `/` on
a big home folder.

- `~readme`; `~docs report` finds "report" under a folder like docs. Letters
  may skip: `~dwnlds`.
- **Enter** opens. **Shift+Enter** opens a terminal in the folder.
- **Runs** `fd` twice per query (the words as typed, then letters in order),
  stopped after 3 s.
- `"files": { "hidden": true }` includes dot-folders.

## Inside files — `rg `  (`contents`)

Lines containing your words, in files under your home folder.

- `rg invoice`, `grep TODO`. At least three characters.
- The words are a fixed string, not a regex. Case is ignored unless you type a
  capital.
- **Enter** opens your Omarchy default editor at that line. **Shift+Enter**
  opens the file with its default app.
- **Runs** `rg` (ripgrep): 3 lines per file, 300 in all, files over 4 MB
  skipped, stopped after 3 s.
- ripgrep skips hidden files, git-ignored files and binaries.
  `"contents": { "hidden": true }` includes hidden files (~/.config).
- Opening at the line goes through `bin/punctum-edit`, which passes the
  line the way each editor wants (nvim and vim `-c N`, nano `+N`, micro and
  helix `file:N`, VS Code `--goto`, Zed `file:N`, Kate `--line`).
  `omarchy-launch-editor +N` can't be used: Ghostty drops arguments that start
  with `+`.

## Clipboard history — `cb `  (`clipboard`)

What you copied, pinned entries first, from the history the
[hypha.clipboard](../../hypha.clipboard) plugin keeps.

- `cb `, `cb invoice`
- **Enter** pastes into the window you came from (copy, then Shift+Insert, as
  Super+Ctrl+V does). **Shift+Enter** only copies.
- **Reads** `~/.local/state/omarchy/clipboard-history.json` once, when `cb ` is
  first typed after the bar opens, and drops it when the bar closes. Never
  writes it: pins, expiry and deletion stay with the clipboard plugin.
- Text goes to `wl-copy` on stdin, never on a command line.

## Packages — `pkg `  (`packages`)

Packages in the repositories in your pacman.conf (Arch's, plus Omarchy's own on
an Omarchy install). The AUR is never searched.

- `pkg kfind`, `pkg file search` (words in the description count).
- A package you don't have: **Enter** opens a terminal running
  `sudo pacman -S <repo>/<name>`. pacman shows what it will do and asks first;
  the repository is the one on the row you chose.
- A package you have: **Enter** shows `pacman -Qi`.
- **Shift+Enter** opens its archlinux.org page, or `pacman -Si` in a terminal
  for a repository that isn't Arch's.
- **Reads** the whole list once per open with `expac` (about 15,700 packages,
  0.15 s), from the sync databases your last `pacman -Sy` downloaded. No
  network.

## Bible  (`bible`)

Scripture on Bible Gateway, your first translation on top.

- With no keyword, a reference: `john 3:16`, `1 john 1:9`, `psalm 23`,
  `rom 8:28-30`, `song of songs 2:4`.
  - The book needs three letters or more (`rom`, `psalm`), unless a verse
    follows a colon (`1 jn 1:9`, `is 53:5`). So `mar 3` stays a date and
    `am 5` a time.
  - A chapter alone ranks below dates, times and apps; a verse ranks near the
    top.
- After `bible`, any form: `bible ps 23`, `bible rom 8.28`, and word searches,
  `bible love one another`.
- **Enter** opens the passage or search. **Shift+Enter** copies the link.
- Other translations are rows underneath.
- `"bible": { "versions": ["NASB", "NASB1995", "ESV", "KJV"] }`, in Bible
  Gateway's names.
- **Network**: only when you press Enter, in your browser.

## Bangs — `!`  (`bangs`)

As in DuckDuckGo: `!` and a short name sends the rest to one site.

- `!nasb john 3:16`, `!aw hyprland`, or at the end: `john 3:16 !nasb`.
- `!` alone lists your bangs; `!na` narrows them; Tab completes.
- A bang not in your list goes to DuckDuckGo with the whole query, bang
  included, which knows thousands of them. That is what Zen does when
  DuckDuckGo is its search engine: Zen itself has no bangs.
- Inside a mode, a trailing `!word` belongs to the mode: in `/hosts !backup`
  it means "leave out", not a bang.
- **Enter** opens. **Shift+Enter** copies the link.
- Defaults: `nasb`, `bible`, `nasb95`, `esv`, `kjv`, `ddg`, `g`, `w`, `yt`,
  `gh`, `aw` (Arch Wiki), `ap` (Arch packages), `maps` (OpenStreetMap).
  See [Configuration](configuration.md#bangs) to add, change or drop them.

## Reminders and alarms — `remind`, `alarm`, `!remindme`  (`remind`)

Reminders that show with Omarchy's own: in its bar indicator, and in
`omarchy-reminder show` and `clear`.

- `remind 10m take out the laundry`, `remind me to call mom at 3pm`,
  `!remindme tomorrow 9am dentist`, `remind 1h30m stretch`, `remind 20 tea`
  (a bare number is minutes, as `omarchy-reminder` takes it).
- Times: `10m`, `1h30m`, `2.5h`, `90s`, `3pm`, `7:15pm`, `at 7` (the next
  7 o'clock), `18:30`, `noon`, `midnight`, `tonight 8`, `tomorrow 9am`,
  `friday noon`. A time with a colon is the 24-hour clock: `alarm 6:45` is
  06:45. A number in the message doesn't confuse it: `buy 2 eggs at 5pm` is
  17:00.
- `alarm 6:45`, `alarm tomorrow 7am`: a critical notification and the alarm
  sound, three times.
- **Enter** sets it. `remind` on its own lists what's set; **Shift+Enter**
  cancels one.
- **Runs** `remind-set`, which makes a transient systemd user timer named the
  way Omarchy names its own; the message goes to it on stdin.
- Like Omarchy's, a reminder doesn't survive a reboot or logout. Unlike
  Omarchy's, which counts time awake, one due while the laptop sleeps fires
  when it wakes. A duration counts from when you press Enter.

## Inbox note — `n `  (`notes`)

Appends a line to a note, such as your Obsidian inbox.

- `n call the dentist` → `- 2026-10-08 18:05 call the dentist`
- **Enter** appends it.
- Needs `"notes": { "inbox": "~/Vault/Inbox.md" }`. `"format"` shapes the line
  from `{date}`, `{time}` and `{text}`.
- `bin/punctum-note` writes it: the text arrives on stdin, a symlink is
  refused, the folder must already exist, and a new file is created mode 600.

## Keybindings — `keys `  (`hotkeys`)

Your Hyprland keybindings, found by what they do.

- `full screen`, `super f`, `keys `, `keys screenshot`
- **Enter** runs the binding, as pressing the keys would.
- **Reads** Omarchy's own keybinding list (`omarchy-menu-keybindings`), at
  most every 30 s.

## Web addresses  (`url`)

- `example.com/docs`, `localhost:3000`, `192.168.1.1:8080`
- **Enter** opens it in your default browser. File names like `readme.md` stay
  files.

## Colours  (`colors`)

- `#ff6644`, `ff6644`, `rgb(40, 120, 200)`: a swatch with HEX, RGB and HSL.
- **Enter** copies the form on the selected row.

## Pinned apps  (`apps`)

- **Alt+P** on an app pins or unpins it. The empty bar lists your pins, so
  Super+Period then Alt+1 opens the first.
- Pins are saved in `~/.cache/punctum/pinned-apps.json`;
  `"apps": { "pinned": [...] }` is the starting list.

## Keyword commands  (`commands`)

Your own shortcuts, entirely in the config:

```jsonc
"commands": [
  { "keyword": "g", "title": "Search Google", "open": "https://www.google.com/search?q={q}" },
  { "keyword": "lock", "title": "Lock screen", "run": "omarchy-system-lock" },
  { "keyword": "syncthing", "title": "Syncthing", "open": "http://127.0.0.1:8384/" }
]
```

- `open` URL-encodes `{q}` and hands the address to `xdg-open`.
- `run` runs under bash with the typed text as `$1`; `{q}` becomes `"$1"`.
  Templates where bash would evaluate the value anyway (`{q}` in single
  quotes, arithmetic, array subscripts) are refused with a message. See
  [Security and privacy](security-and-privacy.md#typed-text-and-the-shell).

## The card

- **Frosted glass**: the theme's menu colour at `"glass": { "opacity": 0.78 }`,
  with Hyprland blurring what's behind it. Needs `decoration.blur.enabled` in
  your Hyprland config. `"glass": { "enabled": false }` makes it solid.
- **Move and resize**: drag by the edges or the footer; resize from the grip in
  the bottom-right corner. It stays where you leave it
  (`~/.cache/punctum/geometry.json`). The command "Reset command bar
  position" goes back to `"window"` in the config. A card that would run off
  the bottom of the screen is moved up to fit.

---

## Switching extensions — `?extensions`

Every extension, on or off, with what it runs, reads, writes and contacts
and, for script extensions, its sandbox. **Enter** switches the selected one
and the bar stays open. Switches are kept in the bar's cache, not your config
file; "Reset extension switches" goes back to what the config says, and "Open
settings file" opens `punctum.json` in your editor.

## From upstream

| Provider | Type | Notes |
|---|---|---|
| `math` | `12*8 + 15%`, `sqrt(2)`, `5!` | Offline |
| `currency` | `100 usd to eur`, `$50` | Rates from open.er-api.com, fetched only when you type a currency query |
| `time` | `time in tokyo`, `3pm cet to pst`, `days until dec 25` | Offline |
| `units` | `5 km to mi`, `72f`, `2 cups in ml` | Offline |
| `emoji` | `:fire`, `emoji party` | Enter types it into the app you were using |
| `windows` | `w `, `w github` | Switch to an open window |
| `apps` | `firefox`, `brave new window` | Launch an app or one of its actions |
| `processes` | `kill chrome`, `kill -9 node` | Quit your own processes |
| `ai` | `ai why is my wifi slow`, `>_ why is my wifi slow` | Opens your Omarchy default agent, or a chat site. `>_` and `>` work like the keyword; see [the agent proposal](proposal-agent.md) for where this could go |
