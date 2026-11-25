import { afterEach, expect, test } from 'bun:test';
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import extension from '../extensions/index.ts';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function load() {
  const tools = new Map<string, ToolDefinition>();
  const listeners = new Map<string, (data: unknown) => void>();
  extension({
    exec: async () => {
      throw new Error('Unexpected CLI call');
    },
    events: { on: (name: string, fn: (data: unknown) => void) => listeners.set(name, fn) },
    getFlag: () => undefined,
    on: () => undefined,
    registerFlag: () => undefined,
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI);
  return { tools, listeners };
}

test('the extension stays out of pi-subagents children that inherit the hc terminal', () => {
  process.env.HC_TERMINAL_ID = 't2';
  process.env.PI_SUBAGENT_DEPTH = '1';
  expect(load().tools.size).toBe(0);
  process.env.PI_SUBAGENT_DEPTH = '0';
  expect(load().tools.has('hc_subagent')).toBe(true);
});

test('allowedAgents from pi --agent restrict hc_subagent', async () => {
  process.env.HC_TERMINAL_ID = 't2';
  delete process.env.PI_SUBAGENT_DEPTH;
  const { tools, listeners } = load();
  const invoke = (agent: string) =>
    tools
      .get('hc_subagent')!
      .execute('test', { name: 'a', agent, task: 'Work' }, undefined, undefined, {
        cwd: process.cwd(),
      } as ExtensionToolContext);

  listeners.get('pi-subagents:configure')!({ allowedAgents: ['scout'] });
  await expect(invoke('worker')).rejects.toThrow('Choose an allowed HC agent: scout.');
  listeners.get('pi-subagents:configure')!({ allowedAgents: undefined });
  await expect(invoke('hc-test-missing')).rejects.toThrow('Unknown HC agent: hc-test-missing');
});
