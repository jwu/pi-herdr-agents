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

For a local checkout, run `pi -e .` from the repository directory inside an hc terminal, or run `pi install .` to add the checkout to Pi's package settings. The extension registers its tools when `HC_TERMINAL_ID` is set, except in `pi-subagents` children, which inherit that variable without owning the terminal. When the lead runs as `pi --agent <name>` with pi-config's custom-agent, the profile's `allowedAgents` and `maxDepth` also limit `hc_subagent`. `hc_subagent` explicitly loads the same extension in the child Pi process, which uses its own model configuration.

For example, ask the parent agent to delegate code review and testing to two subagents. They can find each other with `hc_agents`, exchange findings with `hc_send`, and report back to the parent when they finish or get blocked. You can open any terminal with `hc attach <address>`.

By default, child agents exit when the program in their parent terminal exits. Parents, children, and siblings live on one machine. Peers can be on any machine that Herdr Core connects to.

## Peers

Every Pi that runs this extension labels its terminal at each session start: `pi-herdr-agents.peer=1` marks it, and `pi-herdr-agents.session` and `pi-herdr-agents.session-file` name its Pi session. A *peer* is another root terminal, one without an hc parent, that carries the peer label. It can be on this machine or a connected one, such as `macbook/t7`. Only a root terminal has peers, so a child cannot reach its own ancestors this way.

Peers can message each other with `hc_send` and read each other with `hc_read`. They cannot stop, renew, or remove each other. Each machine must run this version of the extension, and a peer can reply only if its machine has added the sender's machine. A message to a remote peer names the sender by its Herdr Core ID, such as `<core-id>/t2`, which the receiving hc resolves to its own name for that machine.

### Worker session storage

To keep newly launched workers out of the lead's `/resume` list, set `PI_HERDR_AGENTS_WORKER_SESSION_DIR` or start the lead with `--hc-worker-session-dir`. A non-empty flag takes precedence over the environment variable; empty values are ignored.

```sh
hc run --bg --name pi-lead -- "$(command -v pi)" \
  --hc-worker-session-dir '~/.pi/agent/sessions/_hc-workers'
```

Each `hc_subagent` passes `--session-dir` to the worker. A base directory gets a subdirectory named the same way Pi names its default per-workspace session directories, such as `--home-alex-project--` for `/home/alex/project`. Use a quoted `<cwd-slug>` placeholder to place that name elsewhere in the path, for example `'~/worker-history/<cwd-slug>/sessions'`. `~` refers to your home directory, and relative paths resolve against the lead's workspace.

Descendant workers inherit the template and use their own working directory to compute the slug. Renewed workers keep their session directory when `hc_renew` starts a fresh session. If neither setting is provided, workers use Pi's usual session storage.

## Tools

A *managed direct child* is a terminal this agent started with `hc_subagent`. Tools that take a `target` expect its address, as returned by `hc_subagent` or `hc_agents`. As in hc, `state` is `live` or `finished`, and `status` is what Pi reports: `idle`, `working`, `done`, `blocked`, or `error`.

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

The `pi-herdr-agents.session` label, updated at each session start, lets `hc_renew` confirm that `/new` took effect. If the child’s editor holds a draft, the typed `/new` joins it and no new session starts; `hc_renew` then reports `first_message.sent: false`. To change the agent or model, close the child with `hc_rm` and start another.

### `hc_send`

Send a message to the parent, a direct child, a sibling, or a peer. An idle recipient starts a turn with it. A working recipient handles it by sender: a message from its parent steers the current run, arriving after the running tool calls finish. Messages from children, siblings, and peers are queued as follow-ups, which arrive once the run has no more tool calls, so reports do not interrupt the work in progress.

| Parameter | Description |
| --- | --- |
| `message` | Required. The message text. |
| `target` | Optional address of a direct child, sibling, or peer. A remote peer may be given as `machine/t7` or as the `core-id/t7` from a message's `<hc from="...">` tag. Omit it to send to the parent. |

### `hc_agents`

List the hc addresses and statuses of this agent, its parent, its direct children, its siblings, and, for a root terminal, its peers.

| Parameter | Description |
| --- | --- |
| `include_finished` | Optional. Set `true` to include finished children, siblings, and peers. |

### `hc_ls`

List terminals visible to Herdr Core, including those on connected machines. Returns the JSON from `hc ls`.

| Parameter | Description |
| --- | --- |
| `include_finished` | Optional. Set `true` to include finished terminals. |

### `hc_read`

Read a managed direct child or a peer: its recent conversation or its screen.

| Parameter | Description |
| --- | --- |
| `target` | Required. A managed direct child or a peer. |
| `source` | Optional. `auto` (default) reads the transcript and falls back to the screen. `transcript` reads only the transcript and fails if it cannot. `screen` reads the visible screen. |
| `limit` | Optional number of transcript messages, 1–50. Defaults to 10. |

The transcript holds the last user and assistant text messages on the current branch of the target's Pi session, without thinking or tool output. Messages longer than 4,000 characters are cut and marked `truncated`. `hc_read` reads the file named by the `pi-herdr-agents.session-file` label through `hc file read`, so a remote peer works the same way. It accepts only a `.jsonl` file whose header holds the session in the `pi-herdr-agents.session` label.

The screen shows what the transcript does not: approval dialogs, an unsent draft, and a reply in progress. Pi draws a full-screen interface, so the screen holds no scrollback. A history read would only scroll Pi's view, so `hc_read` never requests one.

Every result has `target`, `state`, `status`, and `source`, which names what was read. A transcript result adds `session_file` and `messages`, and a `hint` when the target is `blocked` or in `error`. A screen result adds `text`, and `fallback_reason` when `auto` could not read the transcript.

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

Invoke it with `hc_subagent({ "name": "review-auth", "agent": "reviewer", "task": "Review the authentication changes." })`. The `name` identifies the terminal. The `agent` selects the Markdown definition. Omit `agent` to launch a child with its usual Pi configuration, where the parent's delegation rules permit it. Such a child cannot delegate.

Delegation is opt-in. A child gets `hc_subagent`, `hc_renew`, `hc_read`, `hc_stop`, and `hc_rm` only when its profile's `tools` selects them. A child with no profile, or with a profile that has no `tools`, keeps `hc_send`, `hc_agents`, and `hc_ls`.

| Field | Behavior |
| --- | --- |
| `name`, `description` | Required profile name and optional summary. |
| `models` | Optional comma-separated model IDs and `*` patterns. Pass `model` to `hc_subagent` to select an allowed model. With no selection, the first entry is used. A wildcard default uses the first available Pi model that matches. An omitted or empty list allows any selection. |
| `thinking` | Optional Pi thinking level. Defaults to `off` for a named profile. |
| `systemPrompt` | `append` (default) adds the body to the normal prompt. `replace` substitutes the default prompt and keeps project context. `replace-all` also disables project context. Both replacement modes include a tool list and guidelines from the active tools. |
| `tools` | Optional comma-separated Pi tool list. `subagent` selects the blocking `subagent` tool from `pi-subagents` as well as `hc_subagent`, `hc_renew`, `hc_read`, `hc_stop`, and `hc_rm`. `+subagent` and `-subagent` pass the same modifier to all six tools. A list of plain names can also select the five HC tools by name or `*` pattern. Without such a selection the child gets none of the five. HC includes `hc_send` and `hc_agents` for reporting and coordination. |
| `skills` | Comma-separated names or `*` patterns matched against skills available to the child Pi, including enabled package skills. Only matching skills are advertised in the prompt. |
| `allowedAgents`, `maxDepth` | Optional comma-separated list of profiles available for HC delegation and maximum delegation depth (default `10`). `maxDepth` counts the levels of children below the agent itself, wherever it runs: `0` prevents the named child from delegating, and `1` allows one level. HC descendants inherit these limits and can tighten them but not widen them, so a child three levels below an agent with `maxDepth: 3` cannot delegate, whatever its own profile says. A child at its depth limit, or with no allowed agent left, gets none of the five delegation tools. |
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
- `extensions/hc-transcript.ts` reads a Pi session file through hc for `hc_read`.
- `extensions/hc-inbox.ts` turns incoming messages from children, siblings, and peers into follow-ups while Pi works.
- `tests/` covers Pi package loading and tool behavior.
