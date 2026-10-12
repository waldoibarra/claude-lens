# Views

Lens draws the Claude Code transcript in one of three views. Switch with `/lens`:

```text
/lens normal   # the default: one count line per run, each step with one fact
/lens clean    # one short line per run, nothing else
/lens raw      # Claude Code's own drawing, untouched
```

`/lens` with no argument prints the current view. The view applies to the whole transcript at
once, including turns drawn before the switch, and resets to `normal` in each new session.

A **run** is a group of tool calls Claude makes back to back, with no reply text between them. A
turn that reads two files, says something, then runs a command has two runs.

## Normal

```text
I'll check the config, then run the tests.
                                                           Opus 5.5 · 10:22
• Read 2 files, ran 1 command (1 failed)
  ▸ ✓ Read config.ts · 34 lines
  ▸ ✓ Read package.json · 41 lines
  ▸ ✗ Run the tests · exit 1
    The command failed (exit 1). Press Ctrl+O to see its output.
    npm ERR! Missing script: "tset"
                                                    Opus 5.5 · 10:22 (gray)
```

- The count line totals each kind of step: files read, files changed, commands, searches, web
  lookups, delegated tasks, skills and integrations. It is informational, not clickable, and a
  one-step run omits it.
- Each step shows a plain label and one fact from its result: `exit 0`, `34 lines`, `+2 −1 lines`,
  the sub-agent's model and duration, or a web page's domain. A fact the result does not carry is
  left off. Expandable steps start with `▸`; opened steps start with `▾`.
- A run shows its first 5 steps. Click `+N more` to show the rest and `show fewer` to go back.
  The toggle stays after the fifth step, so expansion inserts extra rows below it. If a hidden
  step is currently running, the count line names that observed step without making the count
  interactive.
- A failed step adds a plain line saying what happened and what to do, then the raw error's first
  line in gray, with paths shortened to the file name.

## Clean

The lean view, for reading Claude's replies without distractions.

```text
I'll check the config, then run the tests.
                                                           Opus 5.5 · 10:22
▸ 3 steps · 1 failed
  ✗ The command failed (exit 1). Press Ctrl+O to see its output.
                                                    Opus 5.5 · 10:22 (gray)
```

- Each run is one line: the number of steps and the number that failed.
- Only the run's most recent failure shows, as one red line.
- Click the line to list the step names. A sub-agent step also names its model.

## Raw

Claude Code draws everything itself. Lens adds no labels and folds nothing. Use it to see a turn
exactly as Claude Code shows it without Lens.

## What every view except raw adds

- **Message labels:** a right-aligned line under each message: `You · 10:20` under your prompts,
  the replying model under each block of Claude's reply (`Opus 5.5 · 10:22`), and a gray label
  under each run with the model that called its steps and the time the run started. The model is
  read per reply, so a `/model` switch shows on the next reply. Known non-Claude model ids are
  humanized, unknown identifiers stay unchanged, and missing model metadata shows `Claude`.
  Claude Code's `●` bullet is dropped, since the label marks each message.
- **Plain step labels:** a step reads `Run the tests`, `Edited README.md` or `Delegated: Find
  usages`, never the raw command, the full path, or a tool call ID. Commands use the description
  Claude gave them.
- **Plain errors:** raw errors become one line that says what happened and what to do. See
  [Error lines](#error-lines).
- **Click to open a step:** a `▸` step asks Claude Code to draw that step's native detail row in
  place and changes to `▾`. Click again to close.
- **Questions:** a question transcript row always has a disclosure, such as `▸ ? Waiting for your
  answer…` or `▸ ? Answered Scope: User`. Answered rows show the question and answer when opened;
  waiting, skipped and failed rows delegate to Claude Code's native detail only.
- **Working line:** while a step runs, the spinner shows its label instead of a random verb.
- **Background agents:** the "Agent … finished" row ends with the agent's model and finish time.

## Error lines

| The raw error mentions | Lens shows |
| --- | --- |
| A step you declined | You declined this step. Tell Claude how to proceed. |
| An interruption | Stopped by you. Send a message to continue. |
| A file not read before editing | Claude must read the file before changing it. It will retry. |
| Text to replace not found | The text to change was not found. Claude should re-read the file. |
| Text to replace found more than once | The text to change appears more than once. Claude should give more context. |
| `ENOENT`, no such file | File or folder not found. Check the name, or ask Claude to search for it. |
| `EACCES`, permission denied | Permission denied. Check file permissions or run with access. |
| Command not found | A required program is not installed. Install it or ask for another way. |
| A timeout | The step timed out. Retry it, or run it in the background. |
| `429`, rate limit | Rate limited. Wait a moment, then retry. |
| Connection refused, DNS failure | Network request failed. Check the connection or the address. |
| `401`, `403` | Access was refused. Sign in again or check credentials. |
| `404` | Not found. Check the name or address. |
| An exit code | The command failed (exit N). Press Ctrl+O to see its output. |
| A syntax error | A syntax error stopped the step. Claude should fix the code and retry. |
| Anything else | The step failed. Press Ctrl+O to see the details. |

A failed slash command's output is relabeled the same way.

## Full detail

- **Ctrl+O** opens Claude Code's full transcript, which Lens leaves untouched.
- **`/lens raw`** shows the whole transcript without Lens.
- Clicking a step or question transcript row delegates to Claude Code's native detail renderer for
  that original row. Lens does not copy command output, diffs or read results, and adds no line,
  character or age cap.
- Native details can still be limited by Claude Code itself. In the generated 2.1.294 plugin API,
  hooks can request native `ToolUse`, `ToolResult` and expanded `ToolGroup` rendering, but there is
  no prop that promises a Ctrl+O-equivalent expanded body for every tool. Lens does not hook the
  live `AskUserQuestion` dialog; only its transcript rows are folded.
- Pi Lens shares this visual target where Pi's host allows it. Its source-only, unreleased public
  repository is <https://github.com/waldoibarra/pi-lens>; host-specific thinking and viewport
  behavior can still differ.

Read [How it works](/docs/how-it-works.md) before relying on Ctrl+O, timestamps or clicks in an
unusual setup.
