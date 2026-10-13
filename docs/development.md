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
(`claude plugin disable lens@claude-lens`) so two copies do not draw at once, and enable it
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
Versioned release tags are immutable; cut a new patch version instead of moving one.
Only `latest`, the convenience alias for the latest published release, may move.

Claude Lens has no npm publication payload. Treat the release payload as the tagged repository
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

8. Promote `latest` only after the versioned release is published and verified:

   ```sh
   git tag latest 'v0.1.1^{commit}'
   git push origin refs/tags/latest
   ```

   For later releases, first inspect `git ls-remote origin refs/tags/latest`.
   Replace `OLD_OBJECT_ID` with that result and use the newly published version:

   ```sh
   git tag -f latest 'v0.1.1^{commit}'
   git push --force-with-lease=refs/tags/latest:OLD_OBJECT_ID origin refs/tags/latest
   ```

   Never force a version tag or branch. Inspect a failed lease before retrying.

9. Update managed installations' explicit marketplace `source.ref` pins.
   Verify the installed plugin version. Keep the previous pin for rollback.
   No release branch is required.

Installed copies reconcile their configured source with
`claude plugin marketplace update claude-lens`, then `claude plugin update lens@claude-lens`,
or through marketplace auto-update.
A version-pinned marketplace does not follow `latest` or the default branch.
Changing the shared pin is a separate deployment step.
Publishing a release does not change installed settings.
