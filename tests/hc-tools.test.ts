import { expect, test } from 'bun:test';
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { registerHcTools } from '../extensions/hc-tools.ts';

const workspace = process.cwd();
const executable = process.execPath;
const self = { address: 't2', parent: 't1', state: 'live' };
const parent = {
  address: 't1',
  state: 'live',
  status: { app: 'pi', state: 'working' },
};
const sibling = { ...self, address: 't3', agent: 'pi', status: 'done' };
const unrelated = { ...sibling, address: 't4', parent: 't8' };
const child = { ...self, address: 't5', parent: self.address };

function register(exec: ExtensionAPI['exec']) {
  const tools = new Map<string, ToolDefinition>();
  registerHcTools(
    {
      exec,
      registerTool(tool) {
        tools.set(tool.name, tool as ToolDefinition);
      },
    },
    self.address,
    '/package/extensions/index.ts',
  );
  return (name: string, params: Record<string, unknown>) =>
    tools
      .get(name)!
      .execute('test', params, undefined, undefined, { cwd: workspace } as ExtensionToolContext);
}

function stdout(data: unknown) {
  return { stdout: JSON.stringify(data), stderr: '', code: 0, killed: false, truncated: false };
}

test('hc_run launches an interactive child and waits for idle before sending its task', async () => {
  const calls: string[][] = [];
  const invoke = register(async (command, args) => {
    if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
    calls.push(args);
    switch (args[0]) {
      case 'run':
        return stdout(child);
      case 'wait':
        return stdout({ reason: 'status', status: 'idle' });
      case 'get':
        return stdout({ ...child, status: { app: 'pi', state: 'idle' } });
      case 'send':
        return stdout({ started: true, turn: 0 });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });
  const output = await invoke('hc_run', {
    name: 'review',
    task: '-p @notes\nReview this',
    labels: { role: 'reviewer', scope: 'file=a b.ts' },
  });
  expect(calls).toEqual([
    [
      'run',
      '--json',
      '--bg',
      '--no-notify',
      '--name',
      'review',
      '--cwd',
      workspace,
      '--label',
      'pi-herdr-agents=agent',
      '--label',
      'role=reviewer',
      '--label',
      'scope=file=a b.ts',
      '--parent',
      't2',
      '--',
      executable,
      '-e',
      '/package/extensions/index.ts',
    ],
    ['wait', '--json', '--timeout', '30', '--', 't5'],
    ['get', '--json', '--', 't5'],
    [
      'send',
      '--json',
      '--if',
      'idle',
      '--',
      't5',
      expect.stringContaining('-p @notes\nReview this'),
    ],
  ]);
  expect(output.details).toMatchObject({
    terminal: { address: 't5' },
    first_message: { sent: true, started: true },
  });
});

test('hc_run preserves the child address when startup is blocked', async () => {
  const invoke = register(async (command, args) => {
    if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
    switch (args[0]) {
      case 'run':
        return stdout(child);
      case 'wait':
        return stdout({ reason: 'status', status: 'blocked' });
      case 'get':
        return stdout({ ...child, status: { app: 'pi', state: 'blocked' } });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });
  expect(
    (await invoke('hc_run', { name: 'review', task: 'Review the change' })).details,
  ).toMatchObject({
    terminal: { address: 't5', status: 'blocked' },
    first_message: { sent: false, reason: expect.stringContaining('hc_read') },
  });
});

test('hc_run rejects the reserved agent label before invoking a CLI', async () => {
  const invoke = register(async () => {
    throw new Error('Unexpected CLI call');
  });
  await expect(
    invoke('hc_run', {
      name: 'review',
      task: 'Review the change',
      labels: { 'pi-herdr-agents': 'other' },
    }),
  ).rejects.toThrow('Label key "pi-herdr-agents" is reserved.');
});

test('hc_read, hc_stop, and hc_rm act on managed direct children', async () => {
  const finishedChild = { ...child, address: 't6', state: 'finished' };
  const commands: string[][] = [];
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        return stdout(args.at(-1) === self.address ? self : parent);
      case 'ls':
        return stdout({ terminals: [sibling, child, finishedChild] });
      default:
        commands.push(args);
        return stdout({ ok: true });
    }
  });

  await invoke('hc_read', { target: child.address });
  await invoke('hc_read', { target: finishedChild.address, lines: 0 });
  await invoke('hc_stop', { target: child.address, action: 'interrupt' });
  await invoke('hc_stop', { target: child.address, action: 'kill' });
  await invoke('hc_rm', { target: finishedChild.address });
  await expect(invoke('hc_read', { target: sibling.address })).rejects.toThrow('direct child');
  await expect(invoke('hc_stop', { target: sibling.address, action: 'kill' })).rejects.toThrow(
    'direct child',
  );
  await expect(invoke('hc_rm', { target: sibling.address })).rejects.toThrow('direct child');
  await expect(invoke('hc_rm', { target: child.address })).rejects.toThrow(
    'Only finished terminals can be removed.',
  );
  expect(commands).toEqual([
    ['read', '--json', '--lines', '40', '--', child.address],
    ['read', '--json', '--lines', '0', '--', finishedChild.address],
    ['interrupt', '--json', '--', child.address],
    ['kill', '--json', '--', child.address],
    ['rm', '--json', '--', finishedChild.address],
  ]);
});

test('hc_send routes to the parent and managed peers, and rejects unrelated terminals', async () => {
  const sends: string[][] = [];
  const newChild = { ...child, address: 't6' };
  const terminals = [self, sibling, unrelated, child, newChild];
  let siblingState = 'working';
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        if (args.at(-1) === parent.address) return stdout(parent);
        if (args.at(-1) === sibling.address) {
          return stdout({ ...sibling, status: { app: 'pi', state: siblingState } });
        }
        return stdout(terminals.find((terminal) => terminal.address === args.at(-1)));
      case 'ls': {
        const label = args.at(-1);
        expect(args.slice(0, -1)).toEqual(['ls', '--json', '--all', '--label']);
        if (label === 'pi-herdr-agents=agent')
          return stdout({ terminals: [self, child, newChild] });
        if (label === 'pi-herdr-core=agent')
          return stdout({ terminals: [sibling, unrelated, child] });
        throw new Error(`Unexpected label ${label}`);
      }
      case 'send':
        sends.push(args);
        if (args.at(-2) === 't3' && args.includes('--if')) {
          siblingState = 'done';
          return { ...stdout(null), code: 10, stderr: '{"error":{"kind":"status_mismatch"}}' };
        }
        return stdout({ started: true, turn: 1 });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });
  const family = await invoke('hc_agents', {});
  expect(family.details).toMatchObject({
    parent: { address: 't1' },
    children: [{ address: 't5' }, { address: 't6' }],
    siblings: [{ address: 't3' }],
  });
  await invoke('hc_send', { message: 'Report to parent' });
  await invoke('hc_send', { target: 't3', message: 'Coordinate with sibling' });
  await expect(invoke('hc_send', { target: 't4', message: 'Outside' })).rejects.toThrow('outside');
  expect(sends).toEqual([
    [
      'send',
      '--json',
      '--if',
      'working',
      '--',
      't1',
      'HC agent message from t2:\n\nReport to parent',
    ],
    [
      'send',
      '--json',
      '--if',
      'working',
      '--',
      't3',
      'HC agent message from t2:\n\nCoordinate with sibling',
    ],
    ['send', '--json', '--', 't3', 'HC agent message from t2:\n\nCoordinate with sibling'],
  ]);
});
