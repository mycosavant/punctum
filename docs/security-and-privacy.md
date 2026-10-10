# Security and privacy

The bar runs inside `omarchy-shell`, as you, with everything you can do. So
the question for each feature is what it runs, what it reads, what it keeps,
and what leaves the machine, and how text you type (or text you copied) is
kept from becoming code.

## What leaves the machine

Nothing, unless you ask:

| When | What | Where |
|---|---|---|
| You type a currency query (`100 usd to eur`) and the saved rates are stale | One GET, response capped at 256 KB | open.er-api.com |
| You press Enter on a web row (bang, Bible, keyword command, web address, chat site) | Your browser opens the address | the site named on the row's subtitle |
| You press Enter on a bang that isn't in your list | The whole query, bang included | DuckDuckGo (`bangs.fallback`; `""` turns it off) |

Searching files, file contents, packages, clipboard history, keybindings and
apps is local. So is everything typed until Enter.

## What it reads, and keeps

| Feature | Reads | Keeps |
|---|---|---|
| Clipboard (`cb `) | `~/.local/state/omarchy/clipboard-history.json`, once per open, only in `cb ` mode | Nothing: dropped when the bar closes |
| Everywhere (`/`) | The system plocate index; its own index of home | `~/.cache/everywhere/home.db`, every path in your home folder, mode 600 |
| Reminders | `omarchy-reminder show --json` | A transient systemd user timer per reminder and its message in `$XDG_RUNTIME_DIR/omarchy-reminders/` (mode 600), as Omarchy's own |
| Files (`~`), Inside files (`rg `) | Your home folder, live | Results until the bar closes |
| Packages (`pkg `) | pacman's sync databases, through `expac` | The list until the bar closes |
| Apps, keybindings | Desktop entries; `omarchy-menu-keybindings` | Launch counts, pins (cache) |

Everything the bar keeps is under `~/.cache/punctum/`, in a 700
folder, each file 600. When the bar closes, the results list, per-open loads
(clipboard history, the package list) and the last search's output are
dropped: each process's output buffer is replaced by an empty run, since
Quickshell keeps the last output a process printed (checked 2026-10-09).
Only the typed text is kept, so it can come back next time (`last-query`).

## Typed text and the shell

Every command the bar runs is an **argument list**, never a string for a shell
to parse, except where noted, and in those cases the typed text is an
**argument to a fixed script**, never part of it.

| Feature | How the text travels |
|---|---|
| Everywhere | A JSON request on the `everywhere` command's stdin. It runs plocate with the words after `--` and fzf with the query as one `--filter=` value, all as argument lists |
| Reminders | `remind-set --at <time>` with the message on stdin; the timer's command is a constant script with the message as an argument. `--cancel` accepts only a name matching `omarchy-reminder-*.timer` |
| Script extensions | A JSON request on stdin, never the command line. Every row and action they print is validated: only `open` (http, https, mailto, file or an absolute path), `copy`, `paste`, `edit` and `argv`, labelled by the bar |
| Inside files | `bash -c SCRIPT punctum-rg <words>`; rg gets them as one fixed-string argument after `--` |
| Files | `fd` as an argument list; words regex-escaped, after `--` or inside `--and=` |
| Packages | `bash -c SCRIPT punctum-pkg <repo>/<name>`. Only names matching pacman's own rules (`[a-z0-9@_+][a-z0-9@._+-]*`) are offered, so none starts with `-` |
| Clipboard, copy | Text on `wl-copy`'s stdin, never on a command line (where any process could read it in `/proc`) |
| Inbox note | Text on `punctum-note`'s stdin |
| Edit at line | `punctum-edit <line> <path>`; the line must be digits, the path absolute |
| Web rows | `{q}` URL-encoded, the address handed to `xdg-open` as one argument; only `http(s)` templates are accepted for bangs |
| Keyword `run` commands | See below |

The tests run Everywhere, Inside files, a script extension and `remind-set`
**for real** with text containing `$(touch <marker>)` and check the marker
never appears.

### Keyword `run` commands

A `run` template is code you wrote, and `{q}` is where typed text goes. Before
this fork, `{q}` was substituted into the script, so a query containing `$'`
or `` $` `` could pull the rest of the template back in unquoted. Now `{q}`
becomes a reference to `$1` (`"$1"`, or `${1}` inside double quotes) and the
text is passed as `$1`: bash expands it once as a value and never parses it.

Two kinds of template are refused, with a message, because bash would evaluate
the value itself there:

- `{q}` inside single quotes (it wouldn't expand at all);
- arithmetic or array subscripts: `$(( ))`, `(( ))`, `[[ ]]`, `let`,
  `declare`, `typeset`, `local`, `${a[…]}`. In these, a value such as
  `a[$(cmd)]` runs `cmd`.

## Privilege

The bar never asks for administrator rights itself. One feature hands you a
prompt that does: **Enter on a package you don't have** opens a terminal
running `sudo pacman -S <repo>/<name>`. sudo asks for your password, and
pacman shows what it will install and asks again. Closing the terminal at
either prompt installs nothing. `"extensions": { "packages": false }` if you'd
rather the bar never offer it. (The Omarchy plugin marketplace doesn't allow
this; see the [release proposal](proposal-extensions.md).)

## Extensions you add

An extension runs as you. A JS extension runs inside the shell with
everything you can do; a script extension is a program you're choosing to
run. So:

- `bin/punctum-extensions` loads nothing from
  `~/.config/omarchy/punctum/extensions/` that another account could have
  put there or could swap later. Every file the bar loads or runs
  (`extension.json`, a JS extension's entry, a script's `./` command and
  refresh command) must resolve inside its extension folder and be yours and
  not writable by group or others, and every folder on its real path up to
  `/` must be yours or root's and not writable by others. A symlinked
  `extension.json` is refused. These are checked when the bar looks (at
  startup and when your config changes); it does nothing about code you
  copied in yourself, or change afterwards.
- **Script extensions run sandboxed** (bubblewrap) unless their manifest says
  `"sandbox": false`: by default no network, an empty home folder, no desktop
  session, a cleared environment, nothing writable but a private `/tmp`. A
  manifest can ask for network, home read or write, and named paths;
  `bin/punctum-sandbox` opens those paths itself at each run without
  following symlinks, refuses overlapping ones and writes to places that run
  code or hold keys. Commands their rows run on Enter run in the same
  sandbox. `?extensions` shows each one's sandbox. Limits: `open` rows open
  outside it (a URL can carry what the script could read, after you press
  Enter), "home read" includes sockets in your home, and "home read-write"
  is not a sandbox. Everywhere is the one bundled script that isn't
  sandboxed (plocate's setgid can't work inside one).
- `?extensions` also shows each one's declared `permissions`. For JS
  extensions those are labels the author wrote, not enforcement: a JS
  extension runs inside the shell. Read an extension before adding it.
- A script extension can only *propose* actions from the list above; the bar
  carries them out and writes the footer label itself ("open", "copy",
  "paste", "run <program>"), whatever the script calls it. `argv` runs any
  command the script names: the footer shows which program, not what it
  does.

## Limits of these guarantees

- The bar is a plugin of a shell that runs as you. A malicious JS extension
  could do anything you can.
- Bounds on searches (3 s, `timeout 3`) protect responsiveness, not secrecy.
- The plocate system index is built by root and filtered by plocate, which
  only shows paths you're allowed to list. The bar adds nothing to that.
- `xdg-open` decides which app opens a file (or, for text whose default app
  runs in a terminal, your editor; `bin/punctum-open`); a file's type can
  be chosen by whoever made it.
