# AGENTS.md

pi-herdr-agents is a Pi extension for agent collaboration in Herdr Core, built with TypeScript and Bun.

- Use English for repository work, including documentation, comments, and contributor communication.
- `extensions/index.ts` is the sole entry point. `hc-tools.ts` registers the Pi tools, and `hc-client.ts` runs `hc` commands and resolves terminal relationships.
- `tests/` contains Bun tests. The package-loading test covers the entry point declared in `package.json`.
- Use two-space indentation, single quotes, and semicolons in TypeScript.
- Run `bun run lint` and `bun test` after changing code. Use `bun run format` to format TypeScript.
