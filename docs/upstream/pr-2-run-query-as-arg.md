**Title:** Keyword commands get the typed text as `$1`, never spliced into the script

---

Builds on #PR1 (its first commit is PR 1's), since these tests use the safe payloads.

**The problem.** A `run` template's `{q}` was replaced with the shell-quoted text, using a replacement *string*, so the text was spliced into the script. Three ways that goes wrong:

| Case | Example | What happened |
|---|---|---|
| Replacement patterns | `$'"; touch m; #` against `printf %s {q} "it's"` | `$'` inserted the template's tail, and `touch m` ran. `price $& tax` came out as `price {q} tax` |
| `{q}` inside double quotes | `notify-send "Looking up {q}"` + `$(touch m)` | Became `"Looking up '$(touch m)'"`. Single quotes mean nothing inside double quotes, so it ran |
| Bash evaluates a value | `echo $(( {q} ))`, `${a[{q}]}`, `test -v {q}`, `printf -v {q} …`, `read {q}` + `a[$(touch m)]` | Runs `touch m` however the value is quoted |

**The fix.**

- `{q}` becomes a reference to `$1` (`"$1"`, or `${1}` inside double quotes).
- The bar runs `bash -c <script> commandbar <text>`, so bash expands the text once, as a value, and never parses it.
- The scan tracks quoting and skips comments.
- Templates where that still isn't safe are refused, with a "switched off" row instead of running:
  - `{q}` inside single quotes, where it would never expand;
  - any use of arithmetic, array subscripts or a builtin that takes a variable's name: `$(( ))`, `(( ))`, `[[ ]]`, `let`, `declare`, `typeset`, `local`, `${a[…]}`, `${!…}`, `test -v`/`[ -v ]`, `printf -v`, `read`, `mapfile`, `unset`, `getopts`, `wait -p`. With bash 5.3, `test -v`, `[ -v ]`, `${!x}`, `printf -v`, `read` and `declare -n` ran the payload; the rest are refused because they take a name too.
- A template that hands the text to another shell on purpose (`eval`, `sh -c`, `ssh host {q}`) still runs it as code: that's what those commands are for.
- A template without `{q}` runs as before, and `open` templates are unchanged apart from also using a replacement function.

**Checked:**

- `node tests/run.js` passes.
- With the old `commands.js` swapped back in, 8 checks fail, some by creating their marker file (re-counted 2026-10-10 on 1.3.1).
- Not run in the shell on this branch. Please try a keyword command with `{q}` (e.g. `{ "keyword": "say", "run": "notify-send \"{q}\"" }`) before merging.

Part of #ISSUE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
