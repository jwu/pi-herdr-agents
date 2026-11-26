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

test('maxDepth from pi --agent limits hc_subagent', async () => {
  process.env.HC_TERMINAL_ID = 't2';
  delete process.env.PI_SUBAGENT_DEPTH;
  const { tools, listeners } = load();
  const invoke = () =>
    tools
      .get('hc_subagent')!
      .execute(
        'test',
        { name: 'a', agent: 'hc-test-missing', task: 'Work' },
        undefined,
        undefined,
        {
          cwd: process.cwd(),
        } as ExtensionToolContext,
      );

  listeners.get('pi-subagents:configure')!({ maxDepth: 0 });
  await expect(invoke()).rejects.toThrow('reached its delegation depth limit');
  // With maxDepth: 1 the lead passes the depth check and fails on the unknown agent instead.
  listeners.get('pi-subagents:configure')!({ maxDepth: 1 });
  await expect(invoke()).rejects.toThrow('Unknown HC agent: hc-test-missing');
});

test('every Pi, a root included, publishes its peer label and session on session start', async () => {
  process.env.HC_TERMINAL_ID = 't2';
  delete process.env.PI_SUBAGENT_DEPTH;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const calls: string[][] = [];
  extension({
    exec: async (_command: string, args: string[]) => {
      calls.push(args);
      return { stdout: '{}', stderr: '', code: 0, killed: false };
    },
    events: { on: () => undefined },
    getFlag: () => undefined,
    on: (name: string, fn: (event: unknown, ctx: unknown) => Promise<void>) => {
      if (name === 'session_start') handlers.set(name, fn);
    },
    registerFlag: () => undefined,
    registerTool: () => undefined,
  } as unknown as ExtensionAPI);

  const start = (file: string | undefined) =>
    handlers.get('session_start')!(
      {},
      { sessionManager: { getSessionId: () => 's1', getSessionFile: () => file } },
    );
  await start('/sessions/s1.jsonl');
  // An ephemeral session removes the file label.
  await start(undefined);
  expect(calls).toEqual(
    ['/sessions/s1.jsonl', ''].map((file) => [
      'label',
      '--json',
      '--',
      't2',
      'pi-herdr-agents.peer=1',
      'pi-herdr-agents.session=s1',
      `pi-herdr-agents.session-file=${file}`,
    ]),
  );
});
