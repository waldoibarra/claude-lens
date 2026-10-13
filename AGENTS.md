# AGENTS.md

Navigation index for coding agents. Read this first; open linked docs when the task needs them.

## Project

`claude-lens` is the Claude Code plugin `lens`, built from function hooks. It redraws the
transcript in three views (`/lens normal`, `/lens clean`, `/lens raw`) without changing what Claude
reads. The hooks module is `hooks/register.tsx`, pure logic is `hooks/lens.ts`, the state contract
is `types/index.d.ts`, and tests are in `tests/`.

## Commands

Run `just help` before using a recipe you have not seen in this conversation.

| Command | Purpose |
| --- | --- |
| `just setup` | Install the toolchain, dev dependencies, plugin types and Git hooks |
| `just install-types` | Have Claude Code write its plugin API types into `.claude-plugin/types/` |
| `just dev` | Start Claude Code with this working tree loaded as the plugin |
| `just test` | Run the tests against Claude Code's engine |
| `just validate` | Check the manifests and hooks module |
| `just typecheck` | Typecheck hooks, types and tests |
| `just lint` | Run editorconfig, Markdown and Prettier checks |
| `just format` | Format sources with Prettier |
| `just check` | Run every check the Git hooks run |

## Read before

| Read before… | Doc |
| --- | --- |
| Changing what a view shows, or the error lines | [Views](/docs/views.md) |
| Changing what Lens records, or relying on Ctrl+O, clicks or timestamps | [How it works](/docs/how-it-works.md) |
| Changing the hooks module, the tests or the dev loop, or releasing | [Development](/docs/development.md) |
| Adding, removing or configuring a tool | [Toolchain](/docs/toolchain.md) |
| Changing a Git hook or CI workflow | [Git hooks](/docs/hooks.md) |

The plugin API is `.claude-plugin/types/claude-code/index.d.ts` after `just install-types`; it is
the authority on events, components and props.

## Doc maintenance

Update docs in the same commit as the change that needs them:

- A change to what a view draws, a label or an error line updates `docs/views.md` and, when a
  reader would notice, `README.md`.
- A change to recorded state, its limits or the plugin's side effects updates
  `docs/how-it-works.md`.
- A new tool or changed `mise.toml`, `package.json` or lint config updates `docs/toolchain.md`.
- A changed `hk.pkl` or workflow updates `docs/hooks.md`.
- A new `justfile` recipe adds a row to the commands table above.
- A release follows the steps in `docs/development.md`; never move a published tag.

Remove stale content rather than leaving it.
