import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { agentFlag } from './agent-profiles.ts';
import { registerAgentProfile } from './agent-prompt.ts';
import { sessionLabelKey } from './hc-client.ts';
import { registerHcInbox } from './hc-inbox.ts';
import { registerHcTools } from './hc-tools.ts';

export default function (pi: ExtensionAPI): void {
  const address = process.env.HC_TERMINAL_ID;
  if (!address) return;
  const getScope = registerAgentProfile(pi);
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
