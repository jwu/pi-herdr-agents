# Changelog

## 0.9.0

- Save child reports and automatic notices for a blocked local parent and deliver them when Pi can take input again.
- Keep sender addresses on queued reports, deliver at most four reports at a time, and retry each unconfirmed batch once before setting it aside with a warning.
- Check blocked terminals less often during native dialogs and clean up inboxes for closed terminals at startup.
- `hc_send` without a target now fails with a clear error when the parent is on another machine, instead of reporting that it has no reachable parent.

## 0.8.0

- A child now tells its parent on its own when a run ends in an error after Pi's retries, with the error text, and when Pi waits on a dialog.
- `hc_send` tells the parent when a message to a sibling cannot be delivered.
- `hc_subagent` and `hc_renew` wait up to 90 seconds for a slow Pi to become idle and retry the first task after a status mismatch, without sending it twice. `first_message.attempts` counts the tries.

## 0.7.1

- Fix shared tab placement for concurrent child launches.

## 0.7.0

- Store child sessions in an `hc-children` subdirectory so they stay out of `/resume`.

## 0.6.0

- Add peers: other root Pi sessions that run this extension, on this machine or a connected one. A root terminal lists them in `hc_agents`, messages them with `hc_send`, and reads them with `hc_read`. A message to a remote peer names the sender by its Herdr Core ID so the peer can reply.
- Label every Pi, roots included, with `pi-herdr-agents.peer=1`, its session ID, and its session file at each session start.
- **Breaking:** Replace `hc_read`'s `lines` with `source` (`auto`, `transcript`, or `screen`) and `limit`. `auto` reads the last messages of the target's Pi session and falls back to the screen. Results now include the target's `state` and `status`. History reads are gone, since Pi's full-screen interface has no scrollback.

## 0.5.0

- Count a profile's `maxDepth` from the agent's own level instead of from the lead, matching `pi-subagents`. A profile with `maxDepth: 1` can now delegate one level wherever it runs. The limit still passes down the chain, and a descendant can tighten it but not widen it.
- Apply the `maxDepth` that `pi --agent` announces on `pi-subagents:configure` to the lead, so `maxDepth: 0` stops the lead from delegating and `maxDepth: 1` stops its children.
- Use the delegation scope event, depth rule, and agent list narrowing from `@johnnywu/pi-agent-profiles@0.4.1`. A profile with an unknown frontmatter field is now rejected instead of having that field ignored.

## 0.4.0

- **Breaking:** Make delegation opt-in for children. A child gets `hc_subagent`, `hc_renew`, `hc_read`, `hc_stop`, and `hc_rm` only when its profile's `tools` selects them, with `subagent`, `+subagent`, or the tool names. A child launched without `agent`, or with a profile that has no `tools`, no longer gets them.
- Withhold all five delegation tools, instead of `hc_subagent` alone, from a child at its depth limit or with no allowed agent left.

## 0.3.2

- Keep the blocking `subagent` tool from `pi-subagents` alongside the five HC child management tools when a profile selects `subagent`. Pass `+subagent` and `-subagent` through to Pi with the same modifier on all six tools.

## 0.3.1

- Do not register the HC tools in `pi-subagents` children, which inherit `HC_TERMINAL_ID` from the lead.
- Restrict `hc_subagent` with the `allowedAgents` that `pi --agent` announces on `pi-subagents:configure`.
- Map a profile's `subagent` tool to all child management tools (`hc_subagent`, `hc_renew`, `hc_read`, `hc_stop`, `hc_rm`) through `herdrAgentTools` from `@johnnywu/pi-agent-profiles`.

## 0.3.0

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
