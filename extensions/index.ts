import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { agentFlag, type AgentScope } from './agent-profiles.ts';
import { registerAgentProfile } from './agent-prompt.ts';
import { sessionLabelKey } from './hc-client.ts';
import { registerHcInbox } from './hc-inbox.ts';
import { registerHcTools } from './hc-tools.ts';

export default function (pi: ExtensionAPI): void {
  const address = process.env.HC_TERMINAL_ID;
  // pi-subagents children inherit HC_TERMINAL_ID but do not own that terminal.
  if (!address || Number(process.env.PI_SUBAGENT_DEPTH) > 0) return;
  const getLaunch = registerAgentProfile(pi);

  // `pi --agent` (pi-config's custom-agent) announces its allowedAgents on this event.
  let configured: string[] | undefined;
  pi.events.on('pi-subagents:configure', (configuration: unknown) => {
    const allowed = (configuration as { allowedAgents?: unknown } | undefined)?.allowedAgents;
    configured = Array.isArray(allowed) ? allowed.map(String) : undefined;
  });
  const getScope = (): AgentScope | undefined => {
    const launch = getLaunch();
    if (!configured) return launch;
    const inherited = launch?.allowedAgents;
    return {
      ...launch,
      depth: launch?.depth ?? 0,
      allowedAgents: inherited ? configured.filter((name) => inherited.includes(name)) : configured,
    };
  };

  registerHcTools(pi, address, fileURLToPath(new URL('./index.ts', import.meta.url)), getScope);
  registerHcInbox(pi, address);

  // A child publishes its session ID so hc_renew can confirm that /new took effect.
  pi.on('session_start', async (_event, ctx) => {
    if (typeof pi.getFlag(agentFlag) !== 'string') return;
    await pi.exec(
      'hc',
      ['label', '--json', '--', address, `${sessionLabelKey}=${ctx.sessionManager.getSessionId()}`],
      { timeout: 5_000 },
    );
  });
}
