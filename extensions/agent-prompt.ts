import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { applyAgentProfile, type AgentProfile } from '@johnnywu/pi-agent-profiles';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentFlag, readLaunchedAgent, type AgentLaunch } from './agent-profiles.ts';

export function registerAgentProfile(pi: ExtensionAPI) {
  pi.registerFlag(agentFlag, {
    type: 'string',
    description: 'Agent profile selected by hc_subagent',
  });
  let launch: AgentLaunch | undefined;
  let agent: AgentProfile | undefined;
  let startupError: string | undefined;
  const warnedSkills = new Set<string>();

  pi.on('session_start', async (_event, ctx) => {
    const flag = pi.getFlag(agentFlag);
    if (typeof flag !== 'string') return;
    try {
      launch = JSON.parse(flag) as AgentLaunch;
      agent = launch.filePath ? await readLaunchedAgent(launch.filePath, launch.digest) : undefined;
      startupError = undefined;
    } catch (error) {
      startupError = `Could not load HC agent profile: ${String(error)}`;
      ctx.ui.notify(startupError, 'error');
    }
  });

  pi.on('before_agent_start', async (event, ctx) => {
    if (startupError) {
      ctx.ui.notify(startupError, 'error');
      ctx.abort();
      return;
    }
    if (!agent) return;
    const { missingSkills } = applyAgentProfile(agent, event.systemPromptOptions);
    for (const name of missingSkills) {
      if (warnedSkills.has(name)) continue;
      warnedSkills.add(name);
      ctx.ui.notify(`HC agent skill not found: ${name}`, 'warning');
    }

    if (agent.debug) {
      await writeFile(join(ctx.cwd, 'debug-system-prompt.md'), event.systemPrompt, { mode: 0o600 });
    }
  });

  return () => {
    if (startupError) throw new Error(startupError);
    return launch;
  };
}
