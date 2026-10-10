# Contributions offered upstream

Drafts for [Saikomantisu/omarchy-commandbar](https://github.com/Saikomantisu/omarchy-commandbar),
prepared 2026-10-09 against upstream `main` at `665ce05` (unchanged since this
fork was made). Nothing here has been sent yet.

| Draft | Branch in this repo | Base | Commit |
|---|---|---|---|
| [Issue: hello, fixes and a question](issue.md) | n/a | n/a | n/a |
| [PR 1: safe test payloads](pr-1-safe-test-payloads.md) | `fix/safe-test-payloads` | `upstream/main` | `fcbd84b` |
| [PR 2: keyword text as $1](pr-2-run-query-as-arg.md) | `fix/run-query-as-arg` | PR 1 | `8f85cde` |
| [PR 3: copy through stdin](pr-3-copy-via-stdin.md) | `fix/copy-via-stdin` | `upstream/main` | `223b5ba` |

All three merge onto upstream together without conflicts; the result passes
`node tests/run.js` and qmllint's syntax check (checked 2026-10-09). None was
run in the shell on its branch.

Upstream has private vulnerability reporting **off** and no Discussions, so
the route is public issue and PRs. The bugs are low severity (they need text
you type or paste into a keyword command), which makes that reasonable. To be
extra courteous, you could first email the author (the address on upstream's
commits) and say PRs are coming.

## Submitting

```sh
cd ~/.config/omarchy/plugins/hypha.commandbar
gh repo fork Saikomantisu/omarchy-commandbar --clone=false   # once: your GitHub fork
git remote add mine https://github.com/<you>/omarchy-commandbar.git
git push mine fix/safe-test-payloads fix/run-query-as-arg fix/copy-via-stdin

# PR 1 and 3 against upstream main; PR 2 after PR 1 merges (or say it builds on #PR1)
gh pr create -R Saikomantisu/omarchy-commandbar --head <you>:fix/safe-test-payloads --title "…" --body-file docs/upstream/pr-1-safe-test-payloads.md
```

Open the issue first and link the PRs from it (or the other way round).
Pushing to your GitHub fork publishes the branches; nothing here does that
for you.

## Not offered (yet)

- `2+2` launches Pinta instead of copying 4: the app search matches Pinta's
  keyword `2d` at score 83, above the calculator's 80. Present upstream too.
  Mentioned in the issue, with an offer to fix.
