**Title:** Tests: payloads create marker files instead of running `rm -rf ~`

---

The shell-quoting test ran `bash -c` on a keyword command built from `it's; rm -rf ~`, in the real HOME, and the agent-helper test's payload ended in `&& rm -rf ~`. Both pass today because the quoting holds; a regression in that quoting would have run `rm -rf ~` for whoever ran the tests.

**What changes** (tests only):

- Payloads only create marker files in a throwaway folder, and the checks assert the markers stay absent.
- The quoting test runs in that folder with `HOME` pointed at it, and also tries `$( )` and backticks, not just `;` and a quote.
- It uses `spawnSync`, so a broken quote reports a failed check instead of crashing the run.
- The evil-window fixture's address becomes `$(touch pwned)`. It was never executed (`focusWindow` only accepts hex addresses), so only the string changes.

**Checked:** `node tests/run.js` passes. As a calibration, making `shellQuote` return its input unchanged makes all four quoting checks fail, each naming the marker that ran.

Part of #ISSUE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
