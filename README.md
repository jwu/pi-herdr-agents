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

For a local checkout, run `pi -e .` from the repository directory inside an hc terminal, or run `pi install .` to add the checkout to Pi's package settings. The extension registers its tools when `HC_TERMINAL_ID` is set, except in `pi-subagents` children, which inherit that variable without owning the terminal. When the lead runs as `pi --agent <name>` with pi-config's custom-agent, the profile's `allowedAgents` also restricts `hc_subagent`. `hc_subagent` explicitly loads the same extension in the child Pi process, which uses its own model configuration.

For example, ask the parent agent to delegate code review and testing to two subagents. They can find each other with `hc_agents`, exchange findings with `hc_send`, and report back to the parent when they finish or get blocked. You can open any terminal with `hc attach <address>`.

By default, child agents exit when the program in their parent terminal exits. The tools operate within a single Herdr Core instance.

## Tools

A *managed direct child* is a terminal this agent started with `hc_subagent`. Tools that take a `target` expect its address, as returned by `hc_subagent` or `hc_agents`.

### `hc_subagent`

Start an interactive Pi child in a new hc terminal and deliver its first task once Pi is idle. Unlike the blocking `subagent` tool from `pi-subagents`, `hc_subagent` is non-blocking: it returns once the task is delivered, and the child reports back with `hc_send`.

| Parameter | Description |
| --- | --- |
| `name` | Required. Unique live terminal name: 1–32 of `a-z`, `0-9`, `-`, `_`. |
| `task` | Required. The first task. The child is told to stay within it and report with `hc_send`. |
| `agent` | Optional agent definition name. See [Agent definitions](#agent-definitions). |
| `model` | Optional model ID or `provider/model` ID. It must be allowed by the agent’s `models`. Defaults to the first entry there. |
| `cwd` | Optional working directory, relative to the parent’s workspace or absolute. Defaults to the parent’s workspace. |
| `tab` | Optional placement in the Herdr window. See below. Defaults to `hidden`. |
| `labels` | Optional map of string labels, such as `{"role":"reviewer"}`. Each entry becomes an `hc run --label key=value` argument. Keys starting with `pi-herdr-agents` are reserved, and so are `herdr.space` and `herdr.tab` when `tab` is set. An empty value removes the label. |

| `tab` | Placement |
| --- | --- |
| `hidden` | No pane. The child runs in the background under its parent. |
| `new` | A new tab in the parent’s space. |
| `shared` | The tab of a live direct child that already has one, else a new tab. Children started this way gather in one tab. |
| `self` | The parent’s own tab. |

Every value except `hidden` requires the parent terminal to be in a Herdr space. The extension sets the `herdr.space` and `herdr.tab` labels for these placements.

The result holds the child’s `terminal` and a `first_message` delivery status. A successful send means hc delivered the message, and `started` tells whether hc observed a new turn. If `first_message.sent` is `false` or `null`, or `started` is `false`, inspect the terminal at the returned address and respond to any approval prompt shown at startup. If the tool is canceled during delivery, use `hc_agents` to find the launched terminal by name.

### `hc_renew`

Give a finished child a new task in a fresh Pi session. The extension types `/new` into the child with `hc keys`, waits until the child reports a new session, and then sends the task. The process, terminal, address, pane, agent, and model stay. The result has the same shape as `hc_subagent`’s.

| Parameter | Description |
| --- | --- |
| `target` | Required. A managed direct child whose status is `idle` or `done`. Interrupt a working child with `hc_stop` first. |
| `task` | Required. The task for the new session. |

A child publishes its Pi session ID in the `pi-herdr-agents.session` label at each session start, which lets `hc_renew` confirm that `/new` took effect. If the child’s editor holds a draft, the typed `/new` joins it and no new session starts; `hc_renew` then reports `first_message.sent: false`. To change the agent or model, close the child with `hc_rm` and start another.

### `hc_send`

Send a message to the parent, a direct child, or a sibling. An idle recipient starts a turn with it. A working recipient handles it by sender: a message from its parent steers the current run, arriving after the running tool calls finish. Messages from children and siblings are queued as follow-ups, which arrive once the run has no more tool calls, so reports do not interrupt the work in progress.

| Parameter | Description |
| --- | --- |
| `message` | Required. The message text. |
| `target` | Optional address of a direct child or sibling. Omit it to send to the parent. |

### `hc_agents`

List the hc addresses and statuses of this agent, its parent, its direct children, and its siblings.

| Parameter | Description |
| --- | --- |
| `include_finished` | Optional. Set `true` to include finished children and siblings. |

### `hc_ls`

List terminals visible to Herdr Core, including those on connected machines. Returns the JSON from `hc ls`.

| Parameter | Description |
| --- | --- |
| `include_finished` | Optional. Set `true` to include finished terminals. |

### `hc_read`

Read a managed direct child’s terminal output.

| Parameter | Description |
| --- | --- |
| `target` | Required. A managed direct child. |
| `lines` | Optional history lines, 0–200. Defaults to 40. |

### `hc_stop`

Stop a managed direct child.

| Parameter | Description |
| --- | --- |
| `target` | Required. A managed direct child. |
| `action` | Required. `interrupt` stops its current turn. `kill` ends its program. |

### `hc_rm`

Close a managed direct child. A running child’s program is ended first, then its terminal is removed.

| Parameter | Description |
| --- | --- |
| `target` | Required. A managed direct child. |

## Agent definitions

`hc_subagent` can use the same Agent Markdown files as `pi-subagents`. Put definitions in `~/.pi/agent/agents/` or `.pi/agents/` in the parent Pi workspace. Project definitions take precedence by frontmatter `name`. The child runs in the directory selected by `cwd`, where Pi discovers project context and skills.

```markdown
---
name: reviewer
description: Review changes for correctness and regressions.
tools: read, grep, find, ls
models: anthropic/claude-sonnet-4-6, magpie/claude/*
thinking: high
systemPrompt: replace
---

Review the requested changes. Report actionable findings with file and line references.
```

Invoke it with `hc_subagent({ "name": "review-auth", "agent": "reviewer", "task": "Review the authentication changes." })`. The `name` identifies the terminal. The `agent` selects the Markdown definition. Omit `agent` to launch a child with its usual Pi configuration, where the parent's delegation rules permit it.

| Field | Behavior |
| --- | --- |
| `name`, `description` | Required profile name and optional summary. |
| `models` | Optional comma-separated model IDs and `*` patterns. Pass `model` to `hc_subagent` to select an allowed model. With no selection, the first entry is used. A wildcard default uses the first available Pi model that matches. An omitted or empty list allows any selection. |
| `thinking` | Optional Pi thinking level. Defaults to `off` for a named profile. |
| `systemPrompt` | `append` (default) adds the body to the normal prompt. `replace` substitutes the default prompt and keeps project context. `replace-all` also disables project context. Both replacement modes include a tool list and guidelines from the active tools. |
| `tools` | Optional comma-separated Pi tool list. `subagent` selects `hc_subagent`, `hc_renew`, `hc_read`, `hc_stop`, and `hc_rm`. HC includes `hc_send` and `hc_agents` for reporting and coordination. |
| `skills` | Comma-separated names or `*` patterns matched against skills available to the child Pi, including enabled package skills. Only matching skills are advertised in the prompt. |
| `allowedAgents`, `maxDepth` | Optional comma-separated list of profiles available for HC delegation and maximum delegation depth (default `10`). Descendants inherit the applicable limits. `maxDepth: 0` prevents the named child from delegating. |
| `debug` | Set to `true` to write `debug-system-prompt.md` in the child workspace when a turn starts. |

Rename an existing `model:` field to `models:`. Profile lookup reports a migration warning for definitions with the old field.

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
- `extensions/hc-inbox.ts` turns incoming messages from children and siblings into follow-ups while Pi works.
- `tests/` covers Pi package loading and tool behavior.
