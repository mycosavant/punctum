**Title:** Keyword commands get the typed text as `$1`, never spliced into the script

---

Builds on #PR1 (its first commit is PR 1's), since these tests use the safe payloads.

**The problem.** A `run` template's `{q}` was replaced with the shell-quoted text, using a replacement *string*, so the text was spliced into the script. Three ways that goes wrong:

| Case | Example | What happened |
|---|---|---|
| Replacement patterns | `$'"; touch m; #` against `printf %s {q} "it's"` | `$'` inserted the template's tail, and `touch m` ran. `price $& tax` came out as `price {q} tax` |
| `{q}` inside double quotes | `notify-send "Looking up {q}"` + `$(touch m)` | Became `"Looking up '$(touch m)'"`. Single quotes mean nothing inside double quotes, so it ran |
| Bash evaluates a value | `echo $(( {q} ))`, `${a[{q}]}` + `a[$(touch m)]` | Runs `touch m` however the value is quoted |

**The fix.**

- `{q}` becomes a reference to `$1` (`"$1"`, or `${1}` inside double quotes).
- The bar runs `bash -c <script> commandbar <text>`, so bash expands the text once, as a value, and never parses it.
- The scan tracks quoting and skips comments.
- Templates where that still isn't safe are refused, with a "switched off" row instead of running:
  - `{q}` inside single quotes, where it would never expand;
  - any use of `$(( ))`, `(( ))`, `[[ ]]`, `let`, `declare`, `typeset`, `local` or `${a[…]}`.
- A template without `{q}` runs as before, and `open` templates are unchanged apart from also using a replacement function.

**Checked:**

- `node tests/run.js` passes.
- With the old `commands.js` swapped back in, 8 checks fail, three of them by creating their marker file.
- Not run in the shell on this branch. Please try a keyword command with `{q}` (e.g. `{ "keyword": "say", "run": "notify-send \"{q}\"" }`) before merging.

Part of #ISSUE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
