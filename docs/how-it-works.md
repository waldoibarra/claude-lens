# How it works

Lens is a Claude Code plugin built from function hooks: one TypeScript module that Claude Code
loads and calls as it runs. It changes how the transcript is drawn and never what is in it.

## What Lens changes, and what it leaves alone

Claude Code draws each part of the transcript (a prompt, a reply, a tool call, a group of tool
calls, the spinner) through a render hook. Lens answers those hooks with its own drawing, or
passes them to Claude Code unchanged in raw view.

What Claude reads is untouched. The conversation Claude Code stores, the transcript file and every
request sent to the model hold the same rows with or without Lens. Switching views redraws the
screen; it loses nothing.

The plugin makes no model calls. The only command it runs is `date +%z`, once per session, to read
your time zone for message timestamps.

## What Lens records

Drawing a fold needs facts the render hooks do not carry, such as which run a tool call belongs to
and what it returned. Lens records them as they happen:

- **Steps:** each main-conversation tool call, with its run, label, status, start time, the model
  whose reply called it, and one fact from its result. Lens keeps the last 600 step summaries, but
  not copied outputs or diffs.
- **Message stamps:** the time of each prompt and reply, and the replying model.
- **Your choices:** the current view and which runs and steps are open.

These live in Claude Code's session state, so they survive a reload of the plugin and end with the
session. Tool calls made inside a sub-agent are not recorded as steps; the delegation itself is.

## Limits

- **Earlier turns:** turns from before Lens loaded, or from a resumed session, have no recorded
  steps. Each of their steps shows as one plain line that can open its native detail when Claude
  Code still provides that detail, and their messages show a label without a time.
- **Ctrl+O detection:** the plugin API marks the Ctrl+O transcript only on user messages and
  grouped tool calls. When one of those says the Ctrl+O view is open, Lens draws everything
  unchanged for the next 3 seconds. A long Ctrl+O view scrolled to a turn with no user message on
  screen can still show folded runs; `/lens raw` always shows everything.
- **Clicks:** opening runs, steps and questions needs mouse support, which the fullscreen interface
  has (`/tui fullscreen`). Clicking anywhere else selects the row with a gray highlight; that is
  Claude Code's own behavior and the plugin cannot turn it off.
- **Main screen:** Lens is developed and tested in the fullscreen interface. On the classic main
  screen, finished rows may not redraw as later steps arrive; this is untested.
- **Native detail:** Lens opens steps by delegating to Claude Code's native `ToolUse` and
  `ToolResult` render sites. It adds no output, diff, command-length or age cap. Native rendering
  may still have host limits; the generated 2.1.294 API does not declare a prop that forces every
  tool to draw a Ctrl+O-equivalent expanded body. Renderer completeness needs a real Claude Code
  host check; the mocked test engine cannot prove it.
- **Viewport anchoring:** Lens inserts expanded rows below the clicked header, but Claude Code owns
  transcript scrolling. The generated 2.1.294 API exposes read-only `onScreen` facts and
  scroll-into-view calls, not a hook to pin existing rows or disable follow-end. Exact peek-style
  anchoring still needs a real host check and may differ from Pi Lens.
- **Facts:** a background sub-agent shows no duration, because its result returns before it
  finishes. Builds without separate search tools show searches as commands, with an exit code
  instead of a match count.
- **API:** Lens is built on Claude Mods, the function-hook plugin API that Claude Code 2.1.287
  added. The API is early access and may change between releases. Lens is tested on Claude Code
  2.1.293; 2.1.289 fixed installed mods not loading in the first session after an upgrade, and a
  `ui.render` failure that could end a session, so older builds may misbehave.

Read [Development](/docs/development.md) before changing the hooks module.
