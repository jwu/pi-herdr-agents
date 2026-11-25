import { parseAgentProfile, type AgentProfile } from '@johnnywu/pi-agent-profiles';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const agentFlag = 'hc-agent-profile';

export interface AgentScope {
  depth: number;
  maxDepth?: number;
  allowedAgents?: string[];
}

export interface AgentLaunch extends AgentScope {
  filePath?: string;
  digest?: string;
}

export async function readLaunchedAgent(filePath: string, digest: string | undefined) {
  const source = await readFile(filePath, 'utf8');
  if (profileDigest(source) !== digest) {
    throw new Error(
      'The agent definition changed after launch. Start a new child with the updated definition.',
    );
  }
  return parseAgentProfile(source, filePath);
}

function profileDigest(source: string) {
  return createHash('sha256').update(source).digest('hex');
}

async function launchDigest(agent: AgentProfile) {
  const source = await readFile(agent.filePath, 'utf8');
  if (
    JSON.stringify(parseAgentProfile(source, agent.filePath, agent.source)) !==
    JSON.stringify(agent)
  ) {
    throw new Error(
      'The agent definition changed during launch. Retry with the updated definition.',
    );
  }
  return profileDigest(source);
}

export async function childPiArgs(
  agent: AgentProfile | undefined,
  scope?: AgentScope,
  model?: string,
) {
  // Every child gets the launch flag, which also marks it as started by hc_subagent.
  const allowed = agent?.allowedAgents?.length ? agent.allowedAgents : undefined;
  const inherited = scope?.allowedAgents;
  const launch: AgentLaunch = {
    filePath: agent?.filePath,
    // Hash the same file contents used for argument selection.
    digest: agent ? await launchDigest(agent) : undefined,
    depth: (scope?.depth ?? 0) + 1,
    maxDepth: agent ? Math.min(agent.maxDepth, scope?.maxDepth ?? agent.maxDepth) : scope?.maxDepth,
    allowedAgents:
      inherited && allowed
        ? allowed.filter((name) => inherited.includes(name))
        : (inherited ?? allowed),
  };
  const args = [`--${agentFlag}`, JSON.stringify(launch)];
  if (launch.maxDepth !== undefined && launch.depth > launch.maxDepth) {
    args.push('--exclude-tools', 'hc_subagent');
  }
  if (agent?.systemPromptMode === 'replace-all') args.push('--no-context-files');
  if (model) args.push('--model', model);
  if (agent) args.push('--thinking', agent.thinking);
  if (agent?.tools.length) {
    const tools = agent.tools.map((tool) => tool.replace(/^([+-]?)subagent$/, '$1hc_subagent'));
    const essential = ['hc_send', 'hc_agents'];
    if (tools.every((tool) => /^[+-]/.test(tool))) {
      tools.push(...essential.map((tool) => `+${tool}`));
    } else {
      tools.push(...essential);
    }
    args.push('--tools', tools.join(','));
  }
  return args;
}
