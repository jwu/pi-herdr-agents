# pi-herdr-agents

Launch interactive Pi subagents in Herdr Core, delegate tasks, exchange messages, and manage child terminals.

## Installation

You need Herdr Core (`hc`) 0.1.21 or later and Pi 1.6 or later. Make sure `hc` and `pi` are on Pi's `PATH`, and configure a model in Pi before starting the parent agent.

```sh
pi install npm:@johnnywu/pi-herdr-agents
```

## Usage

Start Pi in a Herdr Core terminal and attach to it.

```sh
hc run --bg --name pi-lead -- "$(command -v pi)"
hc attach pi-lead
```

For a local checkout, run `pi -e .` from the repository directory inside an hc terminal, or run `pi install .` to add the checkout to Pi's package settings. The extension registers its tools when `HC_TERMINAL_ID` is set. `hc_run` explicitly loads the same extension in the child Pi process, which uses its own model configuration.

| Tool | Usage |
| --- | --- |
| `hc_run` | Pass `name`, `task`, and optionally `agent`, `cwd`, and `labels`. The first task is delivered once the child Pi is idle. |
| `hc_agents` | List the hc addresses and statuses of the current agent, its parent, its direct children, and its siblings. Set `include_finished` to include finished children and siblings. |
| `hc_ls` | List live terminals visible to Herdr Core, including terminals on connected machines. Set `include_finished` to add finished terminals. Returns the JSON from `hc ls`. |
| `hc_send` | Pass a `message`. Omit `target` to send it to the parent, or provide the address of a direct child or sibling. If Pi is working, it receives the message as a steering message. |
| `hc_wait` | Wait for a specific `target`, or set `children` to `"any"` or `"all"` to wait for direct child terminals reported by hc. An incoming message or a timeout can end the wait early. |
| `hc_read` | Read terminal output from a managed direct child by `target`. Optional `lines` defaults to 40 with a range of 0–200. |
| `hc_stop` | Pass a managed direct child’s `target` and an `action`. `interrupt` stops its current turn and `kill` ends its program. |
| `hc_rm` | Remove a managed direct child’s finished terminal by `target`. |

Pass `labels` as a map of string values, such as `{"role":"reviewer","project":"docs"}`. Each entry becomes a separate `hc run --label key=value` argument. The extension reserves the `pi-herdr-agents` key for discovering its agents. Herdr Core treats an empty value as removing that label.

For example, ask the parent agent to delegate code review and testing to two subagents. They can find each other with `hc_agents`, exchange findings with `hc_send`, and report back to the parent when they finish or get blocked. You can open any terminal with `hc attach <address>`.

Herdr Core delivers messages through Pi's input area. A successful send means hc delivered the message. The `started` field indicates whether hc observed a new turn. If `hc_run` returns `first_message.sent` as `false` or `null`, or `started` is `false`, inspect the terminal at the returned address. Respond to any approval prompt shown at startup. If the tool is canceled during delivery, use `hc_agents` to find the launched terminal by name.

By default, child agents exit when the program in their parent terminal exits. The tools operate within a single Herdr Core instance.

## Agent definitions

`hc_run` can use the same Agent Markdown files as `pi-subagents`. Put definitions in `~/.pi/agent/agents/` or `.pi/agents/` in the parent Pi workspace. Project definitions take precedence by frontmatter `name`. The child runs in the directory selected by `cwd`, where Pi discovers project context and skills.

```markdown
---
name: reviewer
description: Review changes for correctness and regressions.
tools: read, grep, find, ls
thinking: high
systemPrompt: replace
---

Review the requested changes. Report actionable findings with file and line references.
```

Invoke it with `hc_run({ "name": "review-auth", "agent": "reviewer", "task": "Review the authentication changes." })`. The `name` identifies the terminal. The `agent` selects the Markdown definition. Omit `agent` to launch a child with its usual Pi configuration, where the parent's delegation rules permit it.

| Field | Behavior |
| --- | --- |
| `name`, `description` | Required profile name and optional summary. |
| `model`, `thinking` | Optional Pi model and thinking level. Thinking defaults to `off` for a named profile. |
| `systemPrompt` | `append` (default) adds the body to the normal prompt. `replace` substitutes the default prompt and keeps project context. `replace-all` also disables project context. Both replacement modes include a tool list and guidelines from the active tools. |
| `tools` | Optional comma-separated Pi tool list. `subagent` selects `hc_run`. HC includes `hc_send` and `hc_agents` for reporting and coordination. |
| `skills` | Comma-separated names or `*` patterns matched against skills available to the child Pi, including enabled package skills. Only matching skills are advertised in the prompt. |
| `allowedAgents`, `maxDepth` | Optional comma-separated list of profiles available for HC delegation and maximum delegation depth (default `10`). Descendants inherit the applicable limits. `maxDepth: 0` prevents the named child from delegating. |
| `debug` | Set to `true` to write `debug-system-prompt.md` in the child workspace when a turn starts. |

The optional `<pi-subagents-runtime-tools />` marker places the runtime tool block at a specific point in a replacement prompt. Without the marker, HC places it after the body.

## Local development

You need Node.js 22.19 or later and Bun.

```sh
bun install
bun run lint
bun test
```

## Project structure

- `extensions/index.ts` is the sole Pi extension entry point.
- `extensions/hc-tools.ts` registers the tools, and `extensions/hc-client.ts` runs hc commands and resolves terminal relationships.
- `tests/` covers Pi package loading and tool behavior.
