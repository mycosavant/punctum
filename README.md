# Command Bar (hypha fork)

Spotlight-style command bar - app launcher, calculator, currency, time zones, date maths, emoji, kill process, ask your AI agent and your own keyword commands

**This is a personal fork** of [Saikomantisu/omarchy-commandbar](https://github.com/Saikomantisu/omarchy-commandbar) 1.3.0, installed as `hypha.commandbar`. Upstream is the `upstream` remote; `git fetch upstream && git log main..upstream/main` shows what's new there. It adds:

- **Clipboard history** (`cb `), read from the history the `hypha.clipboard` plugin keeps, pinned entries first. Enter pastes, Shift+Enter copies.
- **Files** (`~name`), found with `fd` under your home folder. Enter opens, Shift+Enter opens a terminal there.
- **Keybindings**: type what you want to do ("full screen") and see its keys; `keys ` lists every binding. Enter runs it.
- **Web addresses**: `example.com/docs` opens in your browser.
- **Colours**: `#ff6644` or `rgb(…)` shows a swatch and its HEX, RGB and HSL forms.
- **Pinned apps**: Alt+P pins an app; the empty bar lists your pins, so Super+Period then Alt+1 opens the first.
- **Inbox notes**: `n call the dentist` appends `- 2026-10-08 18:05 call the dentist` to the note named by `"notes": { "inbox": "~/Vault/Inbox.md" }`. `bin/commandbar-note` writes it: text on stdin, symlinks refused, never creates the folder.
- **Bible**: type a reference (`john 3:16`, `1 jn 1:9`, `ps 23`) and it opens on Bible Gateway, NASB first; `bible love one another` is a word search. `"bible": { "versions": [...] }` sets the translations.
- **Bangs**: `!nasb john 3:16`, `!aw hyprland`, or the bang at the end. Yours go under `"bangs": { "engines": { … } }`, merged over the defaults by name (`"g": null` drops one). A bang you haven't listed goes to DuckDuckGo with the whole query, as Zen does with DuckDuckGo as its engine; `"fallback": ""` stops that. `!` lists them.
- **Packages**: `pkg kfind` searches your pacman repositories (official only, no AUR), read once per open with `expac`. Enter on a package you don't have opens a terminal with `sudo pacman -S`, so pacman asks first; on one you have it shows `pacman -Qi`. Shift+Enter opens its archlinux.org page.
- **Frosted glass**: the card is the theme's menu colour at `"glass": { "opacity": 0.78 }` with Hyprland blurring what's behind it. Needs `decoration.blur.enabled` in your Hyprland config; `"glass": { "enabled": false }` makes it solid.
- **Move and resize**: drag the card by its edges or footer, resize from the grip in the bottom-right corner. It stays where you leave it (`~/.cache/omarchy-commandbar/geometry.json`); the command "Reset command bar position" goes back to `"window": { "cx": 0.5, "top": 0.22, "width": 640, "rows": 7 }`.

File search, keybindings, web addresses and colours are adapted from [evindor/keystroke](https://github.com/evindor/keystroke) (MIT); each file says which part.

It also fixes three things found reading upstream:

- A keyword command's `{q}` was substituted with a replacement *string*, so typed text containing `$'` or `` $` `` could pull the rest of the template back in unquoted and run it. Even fixed, splicing quoted text into a script stayed fragile (heredocs and comments defeat it), so `run` commands now get the typed text as `$1`: `{q}` becomes `"$1"`, which bash expands as a value and never parses as code. Templates where bash would evaluate that value anyway are refused with a message: `{q}` in single quotes, and arithmetic or array subscripts (`$(( ))`, `(( ))`, `[[ ]]`, `let`, `${a[…]}`), where `a[$(cmd)]` runs `cmd`.
- Copied text was put on a `bash` command line, where any process can read it. It now goes to `wl-copy` on stdin.
- A test executed a payload containing `rm -rf ~`, which a quoting regression would have run for real. Test payloads now only create marker files in a temporary folder.

![Command Bar: Spotlight-style command bar for Omarchy](preview.png)

<p align="center">
  <b>Open an app</b><br>
  <img src="screenshots/apps.png" alt="Opening Brave or one of its actions" width="460">
</p>

<p align="center">
  <b>Switch window</b><br>
  <img src="screenshots/windows.png" alt="Switching to an open window" width="460">
</p>

<p align="center">
  <b>Kill a process</b><br>
  <img src="screenshots/kill.png" alt="Quitting a process" width="460">
</p>

## What it does

| Type | Result |
|------|--------|
| `12*8 + 15%`, `sqrt(2)`, `15% of 200`, `5!` | Calculator |
| `100 usd to eur`, `$50`, `50 gbp`, `usd jpy` | Currency conversion, using rates from [open.er-api.com](https://open.er-api.com) |
| `time`, `time in tokyo`, `3pm cet to pst` | Time zones |
| `days until dec 25`, `today + 45 days`, `next friday` | Date calculations |
| `:fire`, `emoji party` | Emoji search. Enter types the emoji into the app you were using and copies it |
| `5 km to mi`, `72f`, `5 ft 11 in to cm`, `2 cups in ml` | Unit conversion: length, weight, temperature, volume, area, speed, data and time. Offline |
| `brave`, `netflix`, `w `, `w github` | Switch to an open window, found by its app or its title. `w ` lists them all, most recent first |
| `firefox`, `term`, `vsc`, `brave new window` | Open an installed app, or one of its actions like New Window. Only apps: nothing here changes a setting or a default |
| `kill`, `kill chrome`, `kill -9 node` | Quit one of your processes, or all processes with that name |
| `cb `, `cb invoice` | Clipboard history, pinned first. Enter pastes into the app you were using, Shift+Enter only copies |
| `~readme`, `~docs report` | Files and folders under `~`, letters in order (`~dwnlds` finds Downloads). Enter opens, Shift+Enter opens a terminal in the folder |
| `full screen`, `super f`, `keys `, `keys screenshot` | Your keybindings, with their keys. Enter runs one, as pressing the keys would |
| `example.com`, `localhost:3000` | Open a web address in your default browser. File names like `readme.md` stay files |
| `#ff6644`, `ff6644`, `rgb(40, 120, 200)` | A colour swatch with its HEX, RGB and HSL forms; Enter copies one |
| `ai why is my wifi slow` | Open Omarchy's default agent (`omarchy default agent`) in a terminal with that prompt, or ChatGPT or Claude in your browser. |
| `john 3:16`, `ps 23`, `bible grace` | Scripture on Bible Gateway, your first translation (NASB) on top |
| `!nasb john 3:16`, `!aw wayland`, `!` | Bangs: your list first, anything else through DuckDuckGo |
| `pkg kfind`, `pkg file search` | Packages from your pacman repositories. Enter installs (pacman asks) or shows details |
| `g …`, `yt …`, `gh …`, `wiki …`, `lock` | Keyword commands, which you can change in the config |

Type part of a feature's name to find it. `emo` finds Search emoji and `curr` finds Convert currency.

Type `?` for help. It lists one topic per feature. Enter opens a topic, and each example in it shows the answer it would give, so `5 km to mi` reads `→ 3.1069 mi`. Enter on an example tries it. Esc goes back to the topics. Type words after the `?` to search the help, for example `?money`.

Results come in groups (Windows, Apps, Calculator and so on). A sum or a conversion at the top shows in large type. The footer names the selected row's group and what Enter will do with it, such as Open, Switch or Copy.

Keys:

- Up/Down or Ctrl+N/P moves the selection.
- Enter copies, opens or runs the selected row.
- Shift+Enter does the row's second action when it has one (copy instead of paste, a terminal in a file's folder). The footer names it.
- Alt+P pins or unpins the selected app. Pinned apps are what the empty bar lists.
- Alt+1 to Alt+9 copy, open or run that row straight away. Each of the first nine rows shows its key. The `?` help has no shortcuts.
- Tab fills in the query for the selected row, for example a keyword and a space.
- Esc clears the text. Press it again to close the bar.

After you copy, open or run something, the bar starts empty next time. If you close it without doing anything (Esc or clicking outside), it keeps your text, selected, so typing replaces it.

## Install

This fork lives in `~/.config/omarchy/plugins/hypha.commandbar` as a git repository; enable it with:

```sh
omarchy plugin enable hypha.commandbar
```

Press Super + Period to open it. You can change the key with `"hotkey"` in the config. If another action already uses the key, the bar leaves it alone and shows a notification.

To open the bar with text already filled in, pass a query. For example, to open emoji search directly:

```sh
omarchy-shell shell toggle hypha.commandbar '{"query": ":"}'
```

### Dependencies

All of these come with Omarchy:

- `curl`: exchange rates
- `wl-copy` (from `wl-clipboard`): copying results
- `xdg-open`: web keyword commands
- `ps` and `kill` (from `procps-ng`): the process list
- `date` and `timedatectl`: time zones
- `uwsm-app` and `gtk-launch`: opening apps, the same way Omarchy's own launcher does
- `hyprctl`: setting the hotkey, and listing and focusing windows
- `notify-send`: warning when the hotkey is already taken
- `python3`: reading and writing the cache files safely (`bin/commandbar-cache`)
- `omarchy-menu-emoji-insert` and Omarchy's `emojis.json`: emoji
- `omarchy-default-agent`, `omarchy-cmd-missing`, `omarchy-agent-prompt` and `omarchy-agent --pick`: asking your agent (`bin/commandbar-agent`)
- `fd`: file search
- `omarchy-menu-keybindings`: the keybinding list and running a binding
- `omarchy-clipboard-paste-file` and `wtype`: pasting clipboard images and text
- `hyprpicker`: Pick a colour from the screen

### Network, files and processes

- The only network request is to `https://open.er-api.com/v6/latest/USD`, made when you convert currency and the saved rates are out of date. The rates update once a day. What you type is not sent anywhere, except the text you search with a web keyword like `g` and the prompt you give your agent with `ai`.
- It writes only to `~/.cache/omarchy-commandbar/`: the saved rates, your last query, how often you've opened each app from the bar (used to order equally good matches) and your pinned apps. It does not change your Hyprland or Omarchy config files.
- It reads `~/.local/state/omarchy/clipboard-history.json` once, the first time you type `cb ` after opening the bar, and forgets it and every row built from it when the bar closes. It isn't watched, so a copy landing while you browse can't move the rows under the selection; reopen to see it. It never writes that file.
- `~` searches run `fd` as an argument list with your words regex-escaped, under your home folder, stopping after 400 hits or 3 seconds. Hidden files are left out unless `"files": { "hidden": true }`.
- Keybindings come from sourcing Omarchy's `omarchy-menu-keybindings`, at most every 30 seconds and only once you type something. They depend on that script doing nothing but define functions when sourced with `--print`.
- The cache files are read and written only through `bin/commandbar-cache`. It refuses symlinks, hard links, files you don't own and files over a size limit (4 KiB for the last query, 64 KiB for app counts, 256 KiB for rates), and saves each file through a private temporary file.
- It sets its hotkey in the running Hyprland with `hyprctl eval`, and sets it again after Hyprland reloads its config. The hotkey is removed when the plugin is disabled or removed.
- It lists only your own processes, and quits one only when you press Enter on it.
- It asks `omarchy-default-agent` for your default agent each time it opens, reading at most 64 bytes of the answer, and starts that agent only when you press Enter on an `ai` row. The bar itself sends nothing to an AI service; the agent does, as it would if you started it yourself.

## Remove

```sh
omarchy plugin disable hypha.commandbar
rm -rf ~/.cache/omarchy-commandbar ~/.config/omarchy/extensions/commandbar.json
```

The hotkey is removed with the plugin.

## Configure

Put your settings in `~/.config/omarchy/extensions/commandbar.json`. They override the defaults in [`config.default.json`](config.default.json), and changes apply when you save. You can use comments and trailing commas.

```jsonc
{
  // A Hyprland key combination. "" means no hotkey.
  "hotkey": "SUPER + PERIOD",
  // Features to turn on. When results score equally, earlier ones come first.
  "providers": ["commands", "clipboard", "files", "url", "colors", "math", "currency", "time", "emoji", "processes", "units", "windows", "apps", "hotkeys", "ai"],
  // Default home currency is USD.
  "currency": { "home": "EUR", "favorites": ["USD", "GBP"] },
  // Default home zone is your system time zone.
  "time": { "home": "Europe/Berlin", "zones": ["UTC", "America/New_York"], "clock24": true },
  // "paste" types the emoji into the app you were using and copies it; "copy" only copies it.
  "emoji": { "onEnter": "paste" },
  // Apps listed when the bar opens empty. Once you pin with Alt+P, the list
  // in the cache is used instead of this one.
  "apps": { "pinned": ["org.kde.kate"] },
  // true includes dotfiles and dot-folders in ~ searches.
  "files": { "hidden": false },
  // Asking your agent. See "Asking your agent" below.
  "ai": { "keyword": "ai", "fallback": false, "chats": [{ "title": "ChatGPT", "open": "https://chatgpt.com/?q={q}" }] },
  // This list replaces the default keyword commands.
  "commands": [
    { "keyword": "g", "title": "Search Google", "open": "https://www.google.com/search?q={q}" },
    { "keyword": "ddg", "title": "DuckDuckGo", "open": "https://duckduckgo.com/?q={q}" },
    { "keyword": "term", "title": "Terminal", "run": "xdg-terminal-exec" },
    { "keyword": "say", "title": "Notify", "run": "notify-send {q}" }
  ]
}
```

`{q}` is whatever you type after the keyword. In `open` commands it is URL-encoded. In `run` commands it is passed as `$1`, so it can't change the command itself; see the list of refused templates above.

## Asking your agent

`ai <prompt>` hands your prompt to `omarchy agent prompt`, which opens the agent you picked with `omarchy default agent` in a terminal, the way the Super + Shift + Ctrl + A key does. If you haven't picked one, Enter opens Omarchy's agent menu instead. Omarchy installs an agent when you pick it. If it has been removed since, a notification says so and how to install it again.

Omarchy starts every agent with its auto-approve setting (`claude --permission-mode auto`, `codex --approve-for-me`, `gemini --yolo` and so on), so the agent runs commands without asking. The row says so before you press Enter.

| Setting | Default | What it does |
|---|---|---|
| `keyword` | `"ai"` | The word that starts a prompt. A keyword command with the same word takes it over |
| `fallback` | `false` | `true` offers the agent and the chat websites when a query of two words or more matches nothing else, as if you had typed `ai` first. Enter on a mistyped query then starts the agent |
| `chats` | ChatGPT, Claude | Chat websites listed under the agent. `{q}` is the prompt, URL-encoded. `[]` hides them |

Under the agent, a "Chat websites" section lists each site, so Alt+2 and Alt+3 open the prompt in ChatGPT or Claude instead. Add others, such as Perplexity (`https://www.perplexity.ai/search?q={q}`), to the list. Opening one sends your prompt to that site, the same as a web keyword.

## Adding a feature

Each feature is a JavaScript file in `providers/`:

```js
.pragma library

var provider = {
  id: "units",
  name: "Units",
  icon: "󰕒",
  // Found by name: typing "unit" shows this command.
  commands: [{ title: "Convert Units", keywords: "unit convert", text: "e.g. 5 km to mi", complete: "5 km to mi", select: true }],
  // Shown in the "?" list.
  help: [{ title: "Units", examples: ["5 km to mi", "30c to f"] }],
  // Return [] if the query isn't for this feature.
  match: function(query, ctx) {
    return [{ title: "3.11 mi", subtitle: "5 km → mi", score: 80, copy: "3.11" }]
  }
}
```

A result can include `run: { kind: "open" | "run", target }` to open or run something on Enter, `group` to list it under its own heading instead of the feature's name, and `fallback: true` to show it only when no other result does. `ctx.settings` is the provider's section of the config. `ctx` also has `rates`, `zones`, `localZone`, `emojis`, `processes`, `now()`, `format(n)` and `plain(n)`.

To enable it, import it in [`providers/index.js`](providers/index.js), add it to the list there, and add its `id` to `"providers"` in the config.

Test providers without the shell by running `node tests/run.js`.

To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
