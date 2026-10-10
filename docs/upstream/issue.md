**Title:** Thanks for Command Bar: three fixes (PRs), and a question about a fork

---

Hi! I've been using Command Bar every day on Omarchy and it has become my main launcher. Thank you for building it, and for how carefully it's written: the cache helper and the shell-quoting tests made it easy to work on.

While building on it I ran into three problems. I've opened a small PR for each:

1. **Tests could run `rm -rf ~`** (#PR1). The shell-quoting test and the agent-helper test run payloads ending in `rm -rf ~` for real, in the real HOME. They pass today because the quoting holds, but a regression in that quoting would delete the home folder of whoever runs `node tests/run.js`. The PR swaps the payloads for marker files in a temporary folder.

2. **Typed text can run as code in keyword `run` commands** (#PR2, builds on #PR1). `{q}` is spliced into the template, so:
   - with `{q}` inside double quotes, e.g. `"run": "notify-send \"Looking up {q}\""`, typing `$(touch /tmp/x)` runs it;
   - `$'`, `` $` `` and `$&` in the typed text are JavaScript replacement patterns and pull parts of the template back in, which can also run code;
   - in arithmetic or array subscripts, bash evaluates a value like `a[$(cmd)]` however it's quoted.

   It needs a `run` command with `{q}` plus text you type or paste, so it's low severity, but pasting untrusted text into a launcher is ordinary. The PR passes the text to bash as `$1` instead, and refuses the few template shapes where that still isn't safe. Tests cover each case, and they fail on the current code.

3. **Copied text goes on a command line** (#PR3). `printf %s '<text>' | wl-copy` runs under `bash -c`, so the text is readable from `/proc/<pid>/cmdline` while it runs, and very long text hits ARG_MAX. The PR sends it to `wl-copy` on stdin, the same change you made for the cache helper in 665ce05.

PR 1 and PR 3 are independent; PR 2 builds on PR 1. All three merge together cleanly and pass `node tests/run.js`. I haven't run them in the shell on these exact branches, so please give a keyword command and a copy a try before merging.

Something else I noticed but haven't fixed: typing `2+2` and pressing Enter launches Pinta instead of copying 4. The app search matches Pinta's desktop keyword `2d` (score 83) above the calculator answer (80). Happy to send a fix if you'd like one.

**And the question:** my fork has grown quite a bit. It now has file search across the whole disk (plocate and fzf), search inside files (ripgrep), clipboard history, pacman package search, bangs, an inbox note, Bible references, and a movable frosted card, plus docs. It has drifted from Command Bar's scope, and I'm considering releasing it some day as its own project under a different name, credited to Command Bar and keeping your MIT notice. Before anything like that: is there anything in it you'd want upstream? I'm glad to send focused PRs for whatever fits, and equally glad to keep it separate if you'd rather Command Bar stay small. The fork: <link once it's on GitHub>.

Thanks again!
