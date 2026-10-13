# Development

## Set up

You need [mise](https://mise.jdx.dev) and Claude Code installed. From the repository root:

```sh
just setup
```

`just setup` installs the toolchain with mise, TypeScript and Prettier with Bun, Claude Code's
plugin types, and the Git hooks. Read [Toolchain](/docs/toolchain.md) before adding or replacing a
tool.

The plugin types are written by Claude Code, not committed. `just install-types` loads this folder
as a plugin once (`claude --plugin-dir . -p "/lens"`), which makes Claude Code write its API
declarations into `.claude-plugin/types/`. Run it again after updating Claude Code, so
`just typecheck` checks against the API you run.

## Commands

```sh
just dev         # start Claude Code with this working tree loaded as the plugin
just test        # run the tests against Claude Code's own engine
just validate    # check the manifests and hooks module as Claude Code loads them
just typecheck   # strict tsc over hooks, types and tests
just lint        # editorconfig, Markdown and Prettier checks
just format      # format TypeScript, JSON and YAML with Prettier
just check       # every check the Git hooks run
```

## Try a change

`just dev` starts Claude Code with the working tree loaded through `--plugin-dir`. Saving a file
reloads the plugin; a save made during a turn reloads when the turn ends. Saved state such as the
current view survives the reload.

If Lens is also installed from the marketplace, disable it for the session
(`claude plugin disable lens@claude-code-lens`) so two copies do not draw at once, and enable it
again afterwards.

## Layout

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | The hooks module: recording steps, drawing each view, the `/lens` command |
| `hooks/lens.ts` | Pure functions: labels, error lines, counts, facts and timestamps |
| `types/index.d.ts` | The state contract: every value Lens keeps in Claude Code's session state |
| `tests/lens.test.ts` | Tests for the pure functions |
| `tests/render.test.tsx` | Tests that drive the hooks through Claude Code's engine and read the drawing |
| `.claude-plugin/plugin.json` | The plugin manifest |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace listing the plugin |

Logic that needs no `$` belongs in `hooks/lens.ts`, where a plain unit test covers it. A function
in `hooks/register.tsx` that takes `$` must be declared at the top level of the file;
`claude plugin validate` rejects a `$` passed to a nested function.

The full plugin API is in `.claude-plugin/types/claude-code/index.d.ts` once types are installed.
Search it for the event or component at hand, such as `'tool.call'` or `ToolGroup: {`.

## Tests

`claude plugin test` runs each `*.test.ts` and `*.test.tsx` file in an environment like the
plugin's own, with Claude Code's engine as `$`. The tests answer the engine's side themselves:
they run tool calls through the plugin, mount a component on the terminal or desktop surface, press
its buttons, and read the drawn tree. They never start a Claude session or call a model. Passing
these tests proves hook composition, not complete physical TUI rendering of every native detail;
verify actual Claude rendering before claiming that.

## Release

Users get a new version when its `version` in `.claude-plugin/plugin.json` changes.
Public release tags are immutable; cut a new patch version instead of moving one.

Claude Code Lens has no npm publication payload. Treat the release payload as the tagged repository
archive plus Claude Code plugin validation.

1. Bump `version` in `.claude-plugin/plugin.json`: patch for fixes and docs, minor for new
   behavior, major for breaking changes.
2. Run the pre-publication check:

   ```sh
   just check
   ```

3. Commit it as `chore: release vX.Y.Z`.
4. Tag the commit: `git tag -a vX.Y.Z -m "<one-line summary>"`.
5. Push both: `git push && git push origin vX.Y.Z`.
6. Confirm CI passes on the tagged commit.
7. Publish a GitHub Release for the tag with short notes: what changed and whether upgrading needs
   any action.

Installed copies update with `claude plugin marketplace update claude-code-lens`, then
`claude plugin update lens@claude-code-lens`, or on their own when the marketplace is added with
auto-update on.
