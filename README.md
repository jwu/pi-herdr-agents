# pi-herdr-agents

Launch interactive Pi subagents in Herdr Core, delegate tasks, exchange messages, and manage child terminals.

## Installation

You need Herdr Core (`hc`) 0.1.21 or later and Pi 1.6 or later. Make sure `hc` and `pi` are on Pi's `PATH`, and configure a model in Pi before starting the parent agent.

```sh
pi install git:github.com/jwu/pi-herdr-agents
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
| `hc_run` | Pass `name`, `task`, and an optional `cwd` to launch a child agent from the current terminal. The first task is delivered once Pi is idle. |
| `hc_agents` | List the hc addresses and statuses of the current agent, its parent, its direct children, and its siblings. Set `include_finished` to include finished children and siblings. |
| `hc_send` | Pass a `message`. Omit `target` to send it to the parent, or provide the address of a direct child or sibling. If Pi is working, it receives the message as a steering message. |
| `hc_wait` | Wait for a specific `target`, or set `children` to `"any"` or `"all"` to wait for direct child terminals reported by hc. An incoming message or a timeout can end the wait early. |
| `hc_manage` | Use `read`, `interrupt`, `kill`, or `rm` on a direct child agent you launched. `rm` only removes finished terminals. |

For example, ask the parent agent to delegate code review and testing to two subagents. They can find each other with `hc_agents`, exchange findings with `hc_send`, and report back to the parent when they finish or get blocked. You can open any terminal with `hc attach <address>`.

Herdr Core delivers messages through Pi's input area. A successful send means hc delivered the message. The `started` field indicates whether hc observed a new turn. If `hc_run` returns `first_message.sent` as `false` or `null`, or `started` is `false`, inspect the terminal at the returned address. Respond to any approval prompt shown at startup. If the tool is canceled during delivery, use `hc_agents` to find the launched terminal by name.

By default, child agents exit when the program in their parent terminal exits. The tools operate within a single Herdr Core instance.

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
