# Proposal: the agent branch (`>_`)

Status: proposal, 2026-10-09. The first step (the prefix) is built; the rest
is design. Claims about Claude Code are from `claude --help` (2.1.296) on
this machine; claims about Omarchy from its scripts in `/usr/share/omarchy/bin`.

## What exists

- `ai <prompt>`, and now `>_ <prompt>` or `> <prompt>`, hand the prompt to
  your Omarchy default agent through `omarchy-agent-prompt`, in a terminal.
  Rows below offer the same prompt to chat websites.
- Omarchy starts each agent unattended: `claude --permission-mode auto`,
  `gemini --yolo`, `grok --permission-mode bypassPermissions`
  (`omarchy-agent`). The row says so before Enter.

So today the bar is a doorway: it starts a full agent session elsewhere. The
branch below would let the bar *answer*, and hand off only when you want a
full session.

## The idea

`>_` becomes the agent's mode, the way `/` is Everywhere's:

```
>_ what's using port 8080              an answer streams into the bar
>_ summarise                           …about what you copied (cb) or selected
>_ fix the wifi                        proposes commands; you choose
Enter on the answer                    copy it
Shift+Enter                            continue in a terminal, same session
```

## Building blocks, all present

| Need | How |
|---|---|
| An answer without a terminal | `claude -p --output-format stream-json --include-partial-messages`: the answer streams as JSON lines |
| Read-only by default | `--permission-mode plan`, or `--tools` limited to read-only ones (`Read`, `Grep`, `Glob`); nothing runs or writes |
| Continue where it left off | each run reports a session id; `claude --resume <id>` opens it in a terminal, with full permissions only then |
| Streaming into rows | the bar's search service already runs a command and re-renders as output lands; it needs to deliver output as it streams, not only at exit |
| Other agents | Codex, OpenCode and Gemini have non-interactive modes too; through ACP (`claude-agent-acp`, `codex-acp`, `opencode acp`, as the Warp fork uses) one client speaks to all of them, including their permission prompts |

## Steps

1. **Prefix** (built): `>_` and `>` as the agent keyword.
2. **Inline answer, read-only**: an `agent` script extension in `>_` mode.
   It runs the default agent's print mode with read-only tools and streams
   the answer into a tall result row; Enter copies, Shift+Enter continues the
   session in a terminal (`--resume`). Needs the search service to deliver
   partial output (today it delivers at exit), and a result row that can
   show a few lines.
3. **Context on purpose**: `>_` with a suffix picks what goes with the
   prompt, and the row says what's attached before Enter: `>_ cb` (the
   current clipboard), a file chosen in Everywhere (Shift+Enter "ask about
   this"), the focused window's title. Nothing is attached unless you ask.
4. **Proposed commands as rows**: the agent answers with commands (in plan
   mode it can only propose); each becomes a row showing the exact command,
   and Enter runs it in a terminal where you see it. The bar never runs an
   agent's command unseen.
5. **Sessions**: `>_` alone lists recent sessions (Claude Code keeps them
   under `~/.claude/projects/`); Enter resumes one in a terminal.
6. **ACP client** (later): the bar speaks ACP, so any agent works the same
   way and an agent's permission request ("run `rm`?") arrives as a row you
   approve or refuse.

## What it costs, and the cautions

- **Network and money**: every inline answer is a model call on your
  subscription or key. The mode must be explicit (`>_`), never a fallback
  for unanswered queries.
- **Privacy**: a prompt and anything attached leave the machine. Attachments
  must be named on the row before Enter; the clipboard is never attached by
  default.
- **Permissions**: inline answers stay read-only. A session continued in a
  terminal gets the agent's normal mode, which Omarchy sets to unattended;
  the hand-off row should say which mode it opens in.
- **Sandbox**: an inline-answer script needs the network and the agent's
  credentials, which is close to what an agent session has anyway. Declared
  with `"network": true` and `"home": "read"`, it can read anything in your
  home (keys, browser profiles) and send it out, and reach sockets there, so
  that sandbox mostly keeps it off the desktop session and out of writes; it
  is not containment. Claude Code also writes `~/.claude.json` and
  `~/.claude/`, which the denylist allows but `"home": "read"` alone doesn't.
  Not tried: running `claude -p` inside bwrap. Read-only tools and the plan
  permission mode, not the sandbox, are what keep an inline answer harmless.
- **Latency**: answers take seconds; the row shows progress and Esc stops the
  run (the search service already stops a superseded command).

## Decision for the maintainer

Whether to build step 2 next (it carries most of the value), and whether the
agent branch should live in this bar or as its own extension others can
install. Built as an extension, it exercises the extension system's hardest
case: a long-running, streaming, networked script.
