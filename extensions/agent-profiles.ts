import {
  delegationDepthLimit,
  herdrAgentTools,
  herdrDelegationTools,
  narrowAllowedAgents,
  parseAgentProfile,
  type AgentProfile,
} from '@johnnywu/pi-agent-profiles';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const agentFlag = 'hc-agent-profile';

export interface AgentScope {
  depth: number;
  /** Deepest level that may still delegate. An agent at `depth` delegates while depth <= maxDepth. */
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
  const depth = (scope?.depth ?? 0) + 1;
  const launch: AgentLaunch = {
    filePath: agent?.filePath,
    // Hash the same file contents used for argument selection.
    digest: agent ? await launchDigest(agent) : undefined,
    depth,
    maxDepth: delegationDepthLimit(depth, agent?.maxDepth, scope?.maxDepth),
    allowedAgents: narrowAllowedAgents(allowed, scope?.allowedAgents),
  };
  const tools = agent?.tools.length ? herdrAgentTools(agent.tools, { keepSubagent: true }) : [];
  const atLimit =
    (launch.maxDepth !== undefined && launch.depth > launch.maxDepth) ||
    launch.allowedAgents?.length === 0;
  // Delegation is opt-in. An allowlist names the tools it wants. Otherwise the child keeps only
  // the delegation tools its profile adds with `+`.
  const listed = tools.length > 0 && !/^[+-]/.test(tools[0]!);
  const withheld = herdrDelegationTools.filter(
    (tool) => atLimit || (!listed && !tools.includes(`+${tool}`)),
  );
  const args = [`--${agentFlag}`, JSON.stringify(launch)];
  if (withheld.length) args.push('--exclude-tools', withheld.join(','));
  if (agent?.systemPromptMode === 'replace-all') args.push('--no-context-files');
  if (model) args.push('--model', model);
  if (agent) args.push('--thinking', agent.thinking);
  if (tools.length) args.push('--tools', tools.join(','));
  return args;
}
