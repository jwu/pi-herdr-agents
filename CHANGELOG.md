# Changelog

## Unreleased

- Rename `hc_run` to `hc_subagent` and describe it as non-blocking, unlike the blocking `subagent` tool from `pi-subagents`.
- Remove `hc_wait`. Children report back with `hc_send`.
- Add a `tab` option to `hc_subagent`: `hidden` (default), `new`, `shared`, or `self`.
- Add `hc_renew`, which types `/new` into a child with `hc keys`, waits for the new session, and sends it a new task. Children publish their session ID in the `pi-herdr-agents.session` label.
- Let `hc_rm` close a running child by ending its program before removing the terminal.
- Deliver `hc_send` messages from children and siblings to a working Pi as follow-ups instead of steering. Messages from the parent still steer.
- Reserve label keys that start with `pi-herdr-agents`.

## 0.2.0

- Let `hc_run` callers select a model allowed by the agent profile.
- Use the shared `models` field and `tools` syntax from `@johnnywu/pi-agent-profiles@0.2.0`.

## 0.1.1

- Use the parent Pi's `PATH` when launching a child through Herdr Core on Unix so Pi launchers can find Node.js.

## 0.1.0

- Load named Agent Markdown profiles through `@johnnywu/pi-agent-profiles`, with shared system prompt modes, skill selection, and tool guidance.

- Add Herdr Core tools to launch interactive Pi subagents, exchange messages among parent, child, and sibling agents, and wait for and manage child terminals.
- Set up the Pi extension package and development tooling.
