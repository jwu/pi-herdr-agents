# AGENTS.md

pi-herdr-agents is a Pi extension for agent collaboration in Herdr Core, built with TypeScript and Bun.

- Use English for repository work, including documentation, comments, and contributor communication.
- `extensions/index.ts` is the sole entry point. `hc-tools.ts` registers the Pi tools, and `hc-client.ts` runs `hc` commands and resolves terminal relationships.
- `tests/` contains Bun tests. The package-loading test covers the entry point declared in `package.json`.
- Use two-space indentation, single quotes, and semicolons in TypeScript.
- Run `bun run lint` and `bun test` after changing code. Use `bun run format` to format TypeScript.

## Releasing

1. Move the `## Unreleased` entries in `CHANGELOG.md` under `## X.Y.Z`, bump `version` in `package.json`, and commit both as `chore: prepare version X.Y.Z`.
2. Tag the commit with an annotated tag: `git tag -a vX.Y.Z -m "Release X.Y.Z"`.
3. Push the branch and the tag: `git push origin main vX.Y.Z`.
4. Publish to npm: `npm publish`.
5. Create the GitHub release from the tag, using the version's `CHANGELOG.md` section as its notes: `gh release create vX.Y.Z --verify-tag --title "X.Y.Z" --notes-file <notes>`.
