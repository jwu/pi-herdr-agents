import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  delegationDepthLimit,
  delegationScopeEvent,
  narrowAllowedAgents,
  parseDelegationScope,
  type DelegationScope,
} from '@johnnywu/pi-agent-profiles';
import { fileURLToPath } from 'node:url';
import { type AgentScope } from './agent-profiles.ts';
import { registerAgentProfile } from './agent-prompt.ts';
import { peerLabel, sessionFileLabelKey, sessionLabelKey } from './hc-client.ts';
import { registerHcHealth } from './hc-health.ts';
import { registerHcInbox } from './hc-inbox.ts';
import { registerHcTools } from './hc-tools.ts';

export default function (pi: ExtensionAPI): void {
  const address = process.env.HC_TERMINAL_ID;
  // pi-subagents children inherit HC_TERMINAL_ID but do not own that terminal.
  if (!address || Number(process.env.PI_SUBAGENT_DEPTH) > 0) return;
  const getLaunch = registerAgentProfile(pi);

  // `pi --agent` (pi-config's custom-agent) announces the allowedAgents and maxDepth of the
  // session's own profile on this event.
  let configured: DelegationScope = {};
  pi.events.on(delegationScopeEvent, (configuration: unknown) => {
    configured = parseDelegationScope(configuration);
  });
  const getScope = (): AgentScope | undefined => {
    const launch = getLaunch();
    const { allowedAgents, maxDepth } = configured;
    if (!allowedAgents && maxDepth === undefined) return launch;
    const depth = launch?.depth ?? 0;
    return {
      ...launch,
      depth,
      maxDepth: delegationDepthLimit(depth, maxDepth, launch?.maxDepth),
      allowedAgents: narrowAllowedAgents(allowedAgents, launch?.allowedAgents),
    };
  };

  registerHcTools(pi, address, fileURLToPath(new URL('./index.ts', import.meta.url)), getScope);
  registerHcInbox(pi, address);
  registerHcHealth(pi, address);

  // Every Pi publishes its session so hc_renew can confirm that /new took effect and hc_read can
  // find the transcript. The peer label lets other root Pi sessions discover this one.
  pi.on('session_start', async (_event, ctx) => {
    await pi.exec(
      'hc',
      [
        'label',
        '--json',
        '--',
        address,
        peerLabel,
        `${sessionLabelKey}=${ctx.sessionManager.getSessionId()}`,
        `${sessionFileLabelKey}=${ctx.sessionManager.getSessionFile() ?? ''}`,
      ],
      { timeout: 5_000 },
    );
  });
}
