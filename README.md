# Punctum

**The extensible command bar for Linux.** Press Super + Period and type: apps,
windows, every file on the disk, lines inside files, clipboard history, sums,
unit and currency conversions, time zones, emoji, bangs, reminders, your own
keyword commands, and anything you add as an extension, in any language.

*Punctum* (PUNK-tum) is Latin for "point": the dot on the key that opens it,
and the one place you look.

It is a plugin for [Omarchy](https://omarchy.org)'s shell, and it started as
[Command Bar](https://github.com/Saikomantisu/omarchy-commandbar) by
Saikomantisu.

![Punctum](preview.png)

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
| `/notes`, `/report .pdf$`, `/hosts !backup` | Every file on the disk by name (plocate, ranked through fzf). Your home folder is current; elsewhere as of last night |
| `remind 10m tea`, `alarm 6:45`, `!remindme 3pm call mom` | Reminders and alarms, alongside Omarchy's own |
| `rg invoice`, `grep TODO` | Lines inside your files (ripgrep). Enter opens the editor at that line |
| `!w hyprland`, `!aw wayland`, `!` | Bangs: your list first, anything else through DuckDuckGo |
| `pkg kfind`, `pkg file search` | Packages from your pacman repositories. Enter copies the install command, or shows details for one you have |
| `n call the dentist` | Adds a dated line to your inbox note, once you name the note in the config |
| `john 3:16`, `psalm 23` | Scripture on Bible Gateway, once you turn the Bible extension on |
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

## Extensions

Every feature is an extension, and `?extensions` lists them, on or off, with
what each one runs, reads, writes and contacts. Enter switches one.

You can add your own, as a script in any language or in JavaScript (see
[Adding a feature](#adding-a-feature)). A script extension runs in a
[bubblewrap](https://github.com/containers/bubblewrap) sandbox built from its
manifest: by default no network, an empty home folder and no desktop session,
and only what it asks for beyond that.

## Documentation

[`docs/`](docs/README.md): [features](docs/features.md),
[Everywhere](docs/everywhere.md) (the file search),
[configuration](docs/configuration.md), [security and privacy](docs/security-and-privacy.md),
[writing extensions](docs/writing-extensions.md) and [architecture](docs/architecture.md).

## Install

```sh
omarchy plugin add https://github.com/mycosavant/punctum.git
omarchy plugin enable io.github.mycosavant.punctum
```

Omarchy clones the repository into `~/.config/omarchy/plugins/io.github.mycosavant.punctum/`
and adds it switched off, so you can read the code before you enable it.
`omarchy plugin update io.github.mycosavant.punctum` shows the changes before
pulling them. Nothing is installed with sudo, and no install script runs.

Press Super + Period to open it. If another binding already uses that key,
Punctum leaves it alone and a notification says so; set `"hotkey"` in the
config to choose another.

To open the bar with text already filled in, pass a query. For example, to open emoji search directly:

```sh
omarchy-shell shell toggle io.github.mycosavant.punctum '{"query": ":"}'
```

### Dependencies

All of these come with Omarchy. An extension whose command is missing stays
off, and `?extensions` says which command it needs.

- `curl`: exchange rates
- `wl-copy` (from `wl-clipboard`): copying results
- `xdg-open`: web keyword commands
- `ps` (from `procps-ng`) and `kill` (from `util-linux`): the process list
- `date` and `timedatectl`: time zones
- `uwsm-app` and `gtk-launch`: opening apps, the same way Omarchy's own launcher does
- `hyprctl`: setting the hotkey, and listing and focusing windows
- `notify-send`: warning when the hotkey is already taken
- `python3`: reading and writing the cache files safely (`bin/punctum-cache`)
- `omarchy-menu-emoji-insert` and Omarchy's `emojis.json`: emoji
- `omarchy-default-agent`, `omarchy-cmd-missing`, `omarchy-agent-prompt` and `omarchy-agent --pick`: asking your agent (`bin/punctum-agent`)
- `fd`: file search under your home folder
- `plocate`, `updatedb` and `fzf`: Everywhere, the search across the disk
- `rg` (from `ripgrep`): search inside files
- `expac`: package search
- `bwrap` (from `bubblewrap`, which Nautilus brings in): the sandbox for script extensions; without it they stay off
- `xdg-mime`, `file` and `gio`: opening a file in the right app (`bin/punctum-open`)
- `systemd-run` and `omarchy-reminder`: reminders and alarms
- `omarchy-menu-keybindings`: the keybinding list and running a binding
- `omarchy-clipboard-paste-file` and `wtype`: pasting clipboard images and text
- `hyprpicker`: Pick a colour from the screen

### Network, files and processes

- The only network request is to `https://open.er-api.com/v6/latest/USD`, made when you convert currency and the saved rates are out of date. The rates update once a day. What you type is not sent anywhere, except the text you search with a web keyword like `g` and the prompt you give your agent with `ai`.
- The bar keeps its own state only in `~/.cache/punctum/`: the saved rates, your last query, how often you've opened each app from the bar (used to order equally good matches), your pinned apps, the card's position and size, and extensions you switched in `?extensions`. Extensions write where `?extensions` says: Everywhere its index of your home folder in `~/.cache/everywhere/`, `n` your inbox note, reminders their messages under `$XDG_RUNTIME_DIR`, and a script extension the folders its manifest asks to write. Nothing changes your Hyprland or Omarchy config files.
- It reads `~/.local/state/omarchy/clipboard-history.json` once, the first time you type `cb ` after opening the bar, and forgets it and every row built from it when the bar closes. It isn't watched, so a copy landing while you browse can't move the rows under the selection; reopen to see it. It never writes that file.
- `~` searches run `fd` as an argument list with your words regex-escaped, under your home folder, stopping after 400 hits or 3 seconds. Hidden files are left out unless `"files": { "hidden": true }`.
- Keybindings come from sourcing Omarchy's `omarchy-menu-keybindings`, at most every 30 seconds and only once you type something. They depend on that script doing nothing but define functions when sourced with `--print`.
- The cache files are read and written only through `bin/punctum-cache`. It refuses symlinks, hard links, files you don't own and files over a size limit (4 KiB for the last query, 64 KiB for app counts, 256 KiB for rates), and saves each file through a private temporary file.
- It sets its hotkey in the running Hyprland with `hyprctl eval`, and sets it again after Hyprland reloads its config. The hotkey is removed when the plugin is disabled or removed.
- It lists only your own processes, and quits one only when you press Enter on it.
- It asks `omarchy-default-agent` for your default agent each time it opens, reading at most 64 bytes of the answer, and starts that agent only when you press Enter on an `ai` row. The bar itself sends nothing to an AI service; the agent does, as it would if you started it yourself.

## Remove

```sh
omarchy plugin remove io.github.mycosavant.punctum
rm -rf ~/.cache/punctum ~/.cache/everywhere ~/.config/omarchy/extensions/punctum.json ~/.config/omarchy/punctum
```

The hotkey is removed with the plugin.

## Configure

Put your settings in `~/.config/omarchy/extensions/punctum.json`. They override the defaults in [`config.default.json`](config.default.json) and in each extension's `extension.json`, and changes apply when you save. You can use comments and trailing commas. [Configuration](docs/configuration.md) lists every setting.

```jsonc
{
  // A Hyprland key combination. "" means no hotkey.
  "hotkey": "SUPER + PERIOD",
  // Switch extensions off or on by id. ?extensions lists them all.
  "extensions": { "bible": true, "packages": false },
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

`{q}` is whatever you type after the keyword. In `open` commands it is URL-encoded. In `run` commands it is passed as `$1`, so it can't change the command itself. Templates where bash would evaluate that value anyway are refused with a message: `{q}` in single quotes, arithmetic or array subscripts (`$(( ))`, `(( ))`, `[[ ]]`, `let`, `${a[…]}`), and builtins that take a variable's name (`declare`, `${!…}`, `test -v`, `printf -v`, `read` and the like), where `a[$(cmd)]` runs `cmd`. A template that hands the text to another shell on purpose, such as `eval`, `sh -c` or `ssh host {q}`, runs it as code: that is what those do.

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

Every feature is an extension: a folder with an `extension.json` and either a script in any language or a JavaScript provider. Put yours in `~/.config/omarchy/punctum/extensions/<id>/` and run `omarchy-restart-shell`. The smallest one, [`examples/hello`](examples/hello), is a twelve-line Python script:

```jsonc
// extension.json
{ "schema": 1, "id": "hello", "name": "Hello", "type": "script", "command": ["./hello"],
  "mode": { "pattern": "^\\s*hi\\s", "label": "Hello" } }
```

The bar sends the script `{"text": "Ada", "settings": {...}, ...}` on stdin and shows the rows it prints, `{"items": [{"title": "Hello, Ada!", "copy": "Hello, Ada!"}]}`. Enter does what a row's action says, from a short list the bar carries out itself (open, copy, paste, edit, run a command). [Writing extensions](docs/writing-extensions.md) has the manifest, both kinds, the actions and testing.

Test without the shell by running `node tests/run.js`.

To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License and credits

MIT; see [LICENSE](LICENSE). Punctum started from
[Command Bar](https://github.com/Saikomantisu/omarchy-commandbar) by
Saikomantisu (MIT). File search, keybindings, web addresses and colours are
adapted from [Keystroke](https://github.com/evindor/keystroke) (MIT); each
file says which part.
