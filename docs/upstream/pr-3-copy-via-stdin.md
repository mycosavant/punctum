**Title:** Copy through `wl-copy`'s stdin instead of a bash command line

---

Copying a row ran `bash -c "printf %s '<text>' | wl-copy"`. The quoting holds, but the copied text sat on bash's command line, where any process on the machine can read it from `/proc/<pid>/cmdline` while it runs, and long enough text fails with E2BIG (ARG_MAX). This is the same change 665ce05 made for cache writes.

**What changes:**

- `wl-copy` runs as an argument list and gets the text on stdin, which is closed once written so wl-copy sees the end.
- Copies go one at a time through a small queue. An item leaves the queue as its `wl-copy` starts, so one that never starts can't hold up later copies.
- The emoji row still passes the emoji on `omarchy-menu-emoji-insert`'s command line. Emoji are public data, so that's left alone here.

**Checked:**

- `node tests/run.js` passes.
- qmllint reports no syntax problems (calibrated with a missing parenthesis, which it reports).
- Not run in the shell on this branch. Please try a copy (Enter on `2*3`) before merging.

Part of #ISSUE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
