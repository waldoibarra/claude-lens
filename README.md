# Lens

A calmer Claude Code transcript: tool runs fold to one line, errors read in plain words, and
nothing Claude sees changes.

A long turn in Claude Code is mostly tool calls: every read, command and edit gets its rows, and
the reply you care about sits between them. Lens redraws the transcript so you can follow what
Claude did and what it said, and opens the detail only when you click.

## Before and after

The same turn: Claude reads two files and runs the tests, which fail.

**Without Lens** (`/lens raw` shows Claude Code's own drawing):

```text
> run the tests

● I'll check the config, then run the tests.

● Read(src/config.ts)
  ⎿  Read 34 lines

● Read(package.json)
  ⎿  Read 41 lines

● Bash(npm run tset -- --coverage)
  ⎿  Error: Exit code 1
     npm ERR! Missing script: "tset"
     npm ERR! A complete log of this run can be found in:
     npm ERR!     /Users/you/.npm/_logs/2026-10-08T15_22_04_118Z-debug-0.log
```

**Normal**, the default: one count line per run, and each step with the one fact that matters.

```text
> run the tests
                                                                You · 10:22

I'll check the config, then run the tests.
                                                           Opus 5.5 · 10:22
• Read 2 files, ran 1 command (1 failed)
  ▸ ✓ Read config.ts · 34 lines
  ▸ ✓ Read package.json · 41 lines
  ▸ ✗ Run the tests · exit 1
    The command failed (exit 1). Press Ctrl+O to see its output.
    npm ERR! Missing script: "tset"
                                                    Opus 5.5 · 10:22 (cyan)
```

**Clean** (`/lens clean`), the lean option: a step count per run and only what went wrong. Use
it when you want to read Claude's replies without distractions.

```text
> run the tests
                                                                You · 10:22

I'll check the config, then run the tests.
                                                           Opus 5.5 · 10:22
▸ 3 steps · 1 failed
  ✗ The command failed (exit 1). Press Ctrl+O to see its output.
                                                    Opus 5.5 · 10:22 (cyan)
```

Click a step and it opens Claude Code's own detail row in place, without Lens-added truncation.

## Install

```sh
claude plugin marketplace add waldoibarra/claude-lens@v0.1.1
claude plugin install lens@claude-lens
```

Start a new Claude Code session, or run `/reload-plugins` in an open one. Lens starts in the normal
view; type `/lens` to check it loaded.

If you installed Lens before the repository rename, remove the old marketplace entry and reinstall
from `claude-lens` while keeping plugin data:

```sh
claude plugin uninstall lens@claude-code-lens --scope user --keep-data
claude plugin marketplace remove claude-code-lens --scope user
claude plugin marketplace add waldoibarra/claude-lens@v0.1.1
claude plugin install lens@claude-lens
```

Lens needs Claude Code 2.1.287 or later, the release that added Claude Mods; it is tested on
2.1.293. If `/lens` is not a known command after installing, update Claude Code with
`claude update` and try again.

## What you get

- **Three views, one command:** normal by default; `/lens clean` strips the transcript to replies
  and failures for distraction-free reading; `/lens raw` shows Claude Code's own drawing. Each
  redraws the whole transcript, earlier turns included.
- **Folded runs:** normal shows inert counts for back-to-back tool calls, except single-step runs.
  Long runs show 5 steps and a `+N more` you can click.
- **Plain labels:** `Run the tests` and `Edited README.md`, never the raw command, the full path or
  a tool call ID.
- **Plain errors:** raw errors become one line that says what happened and what to do, across 15
  kinds of failure.
- **Click to open:** `▸` steps delegate to Claude Code's native detail row, so Lens adds no
  output, diff or age cap.
- **Message labels:** your prompts and Claude's replies get a right-aligned label with the time and,
  for replies, the model that wrote them, so a `/model` switch is visible where it happened.
- **Questions:** question transcript rows get a disclosure; answered rows show the answer when
  opened, while waiting, skipped and failed rows keep Claude Code's native detail.
- **A working line:** while a step runs, the spinner names it.
- **Sub-agents:** a delegated step shows the model the agent ran on.

Use Pi instead of Claude Code? Install the sibling [Pi Lens](https://github.com/waldoibarra/pi-lens)
from `git:github.com/waldoibarra/pi-lens@v0.1.1`.

Read [Views](/docs/views.md) before picking a view; it shows each one and lists every error line.

## Nothing is lost

- Claude reads exactly what it read before. Lens changes the drawing, never the conversation, the
  transcript file or what is sent to the model.
- **Ctrl+O** still opens the full transcript, and `/lens raw` turns Lens off for the screen at any
  time.
- The plugin makes no model calls and adds nothing to your usage.

## Notes

- Lens is built for the fullscreen interface (`/tui fullscreen`), where clicks work.
- Turns from before Lens loaded show one plain line per step, without folds or timestamps; they
  still open their native detail when Claude Code provides it.
- Clicking outside Lens's lines selects the row with a gray highlight. That is Claude Code's own
  behavior and a plugin cannot turn it off.
- Lens can ask Claude Code to redraw native tool details, but Claude Code does not promise
  Ctrl+O-equivalent output for every renderer through the plugin API. The live question dialog stays
  native; Lens only folds its transcript rows.

Read [How it works](/docs/how-it-works.md) before relying on Lens in an unusual setup; it covers
what Lens records and every known limit. Read [Development](/docs/development.md) before changing
the plugin.

## License

MIT
