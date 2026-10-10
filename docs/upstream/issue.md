**Title:** Thanks for Command Bar: three fixes (PRs), and a heads-up about a fork (Punctum)

---

Hi! I've been using Command Bar every day on Omarchy and it has become my main launcher. Thank you for building it, and for how carefully it's written: the cache helper and the shell-quoting tests made it easy to work on.

While building on it I ran into three problems. I've opened a small PR for each:

1. **Tests could run `rm -rf ~`** (#PR1). The shell-quoting test and the agent-helper test run payloads ending in `rm -rf ~` for real, in the real HOME. They pass today because the quoting holds, but a regression in that quoting would delete the home folder of whoever runs `node tests/run.js`. The PR swaps the payloads for marker files in a temporary folder.

2. **Typed text can run as code in keyword `run` commands** (#PR2, builds on #PR1). `{q}` is spliced into the template, so:
   - with `{q}` inside double quotes, e.g. `"run": "notify-send \"Looking up {q}\""`, typing `$(touch /tmp/x)` runs it;
   - `$'`, `` $` `` and `$&` in the typed text are JavaScript replacement patterns and pull parts of the template back in, which can also run code;
   - in arithmetic, array subscripts and builtins that take a variable's name (`test -v`, `printf -v`, `read`), bash evaluates a value like `a[$(cmd)]` however it's quoted.

   It needs a `run` command with `{q}` plus text you type or paste, so it's low severity, but pasting untrusted text into a launcher is ordinary. The PR passes the text to bash as `$1` instead, and refuses the few template shapes where that still isn't safe. Tests cover each case, and they fail on the current code.

3. **Copied text goes on a command line** (#PR3). `printf %s '<text>' | wl-copy` runs under `bash -c`, so the text is readable from `/proc/<pid>/cmdline` while it runs, and very long text hits ARG_MAX. The PR sends it to `wl-copy` on stdin, the same change you made for the cache helper in 665ce05.

PR 1 and PR 3 are independent; PR 2 builds on PR 1. All three merge together cleanly and pass `node tests/run.js`. I haven't run them in the shell on these exact branches, so please give a keyword command and a copy a try before merging.

Something else I noticed but haven't fixed: typing `2+2` and pressing Enter launches Pinta instead of copying 4. The app search matches Pinta's desktop keyword `2d` (score 83) above the calculator answer (80). Happy to send a fix if you'd like one.

**And a heads-up:** my fork grew well beyond Command Bar's scope: file search across the whole disk (plocate and fzf), search inside files (ripgrep), clipboard history, pacman package search, bangs, reminders, an inbox note, and an extension system with a bubblewrap sandbox for script extensions in any language. Rather than ask you to take all that on, I'm releasing it as its own project, **Punctum** (https://github.com/mycosavant/punctum), credited to Command Bar in its README and keeping your MIT notice in its LICENSE. If anything there would suit Command Bar, I'm glad to send focused PRs for it; equally glad to keep things separate if you'd rather Command Bar stay small.

Thanks again!
