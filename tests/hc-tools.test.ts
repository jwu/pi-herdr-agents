import { expect, test } from 'bun:test';
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function register(exec: ExtensionAPI['exec'], cwd = workspace) {
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
    tools.get(name)!.execute('test', params, undefined, undefined, { cwd } as ExtensionToolContext);
}

const env =
  process.platform !== 'win32' && process.env.PATH
    ? ['/usr/bin/env', `PATH=${process.env.PATH}`]
    : [];

function stdout(data: unknown) {
  return { stdout: JSON.stringify(data), stderr: '', code: 0, killed: false, truncated: false };
}

test('hc_ls returns the CLI listing and includes finished terminals on request', async () => {
  const finished = { ...unrelated, state: 'finished' };
  const liveListing = { terminals: [unrelated], hidden_finished: 1 };
  const allListing = { terminals: [unrelated, finished], hidden_finished: 0 };
  const calls: string[][] = [];
  const invoke = register(async (command, args) => {
    expect(command).toBe('hc');
    calls.push(args);
    return stdout(args.includes('--all') ? allListing : liveListing);
  });

  expect((await invoke('hc_ls', {})).details).toEqual(liveListing);
  expect((await invoke('hc_ls', { include_finished: false })).details).toEqual(liveListing);
  expect((await invoke('hc_ls', { include_finished: true })).details).toEqual(allListing);
  expect(calls).toEqual([
    ['ls', '--json'],
    ['ls', '--json'],
    ['ls', '--json', '--all'],
  ]);
});

test('hc_subagent launches an interactive child and waits for idle before sending its task', async () => {
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
  const output = await invoke('hc_subagent', {
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
      ...env,
      executable,
      '-e',
      '/package/extensions/index.ts',
      '--hc-agent-profile',
      JSON.stringify({ depth: 1 }),
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

test('hc_subagent resolves an agent in the parent workspace and enables the HC reporting tools', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'hc-profile-'));
  try {
    const agents = join(cwd, '.pi', 'agents');
    await mkdir(agents, { recursive: true });
    const profile = join(agents, 'profile.md');
    await writeFile(
      profile,
      [
        '---',
        'name: hc-test-reviewer',
        'systemPrompt: replace-all',
        'models: test/default, test/model-*',
        'thinking: high',
        'tools: read, subagent',
        'maxDepth: 0',
        '---',
        'Review the changes.',
      ].join('\n'),
    );
    const invoke = register(async (command, args) => {
      if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
      if (args[0] === 'run') {
        const flag = args.indexOf('--hc-agent-profile');
        expect(JSON.parse(args[flag + 1]!)).toMatchObject({
          filePath: profile,
          depth: 1,
          maxDepth: 0,
        });
        expect(args.slice(flag + 2)).toEqual([
          '--exclude-tools',
          'hc_subagent',
          '--no-context-files',
          '--model',
          'test/model-custom',
          '--thinking',
          'high',
          '--tools',
          'read,hc_subagent,hc_renew,hc_read,hc_stop,hc_rm,hc_send,hc_agents',
        ]);
        expect(args[args.indexOf('--cwd') + 1]).toBe(join(cwd, 'child'));
        return stdout(child);
      }
      if (args[0] === 'wait') return stdout({});
      if (args[0] === 'get') return stdout({ ...child, status: { app: 'pi', state: 'idle' } });
      if (args[0] === 'send') return stdout({ started: true, turn: 1 });
      throw new Error(`Unexpected ${args[0]}`);
    }, cwd);
    await expect(
      invoke('hc_subagent', {
        name: 'review',
        agent: 'hc-test-reviewer',
        task: 'Review the change',
        model: 'other/model',
      }),
    ).rejects.toThrow('Model "other/model" is not allowed');
    const output = await invoke('hc_subagent', {
      name: 'review',
      agent: 'hc-test-reviewer',
      model: 'test/model-custom',
      task: 'Review the change',
      cwd: 'child',
    });
    expect(output.details).toMatchObject({ first_message: { sent: true } });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('hc_subagent reports the migration warning for profiles using the old model field', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'hc-profile-'));
  try {
    const agents = join(cwd, '.pi', 'agents');
    await mkdir(agents, { recursive: true });
    const profile = join(agents, 'legacy.md');
    await writeFile(profile, '---\nname: hc-test-legacy\nmodel: test/model\n---\n');
    const invoke = register(async () => {
      throw new Error('Unexpected CLI call');
    }, cwd);
    await expect(
      invoke('hc_subagent', { name: 'review', agent: 'hc-test-legacy', task: 'Review the change' }),
    ).rejects.toThrow(
      `${profile}: The \`model\` field is no longer supported. Please use \`models\` instead.`,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('hc_subagent preserves the child address when startup is blocked', async () => {
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
    (await invoke('hc_subagent', { name: 'review', task: 'Review the change' })).details,
  ).toMatchObject({
    terminal: { address: 't5', status: 'blocked' },
    first_message: { sent: false, reason: expect.stringContaining('hc_read') },
  });
});

test('hc_subagent rejects the reserved agent label before invoking a CLI', async () => {
  const invoke = register(async () => {
    throw new Error('Unexpected CLI call');
  });
  await expect(
    invoke('hc_subagent', {
      name: 'review',
      task: 'Review the change',
      labels: { 'pi-herdr-agents': 'other' },
    }),
  ).rejects.toThrow('Label key "pi-herdr-agents" is reserved.');
});

test('hc_read, hc_stop, and hc_rm act on managed direct children', async () => {
  const finishedChild = { ...child, address: 't6', state: 'finished' };
  const commands: string[][] = [];
  let childState = 'live';
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        if (args.at(-1) === child.address) return stdout({ ...child, state: childState });
        if (args.at(-1) === finishedChild.address) return stdout(finishedChild);
        return stdout(args.at(-1) === self.address ? self : parent);
      case 'kill':
        commands.push(args);
        childState = 'finished';
        return stdout({ ok: true });
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
  childState = 'live';
  await invoke('hc_rm', { target: child.address });
  expect(commands).toEqual([
    ['read', '--json', '--lines', '40', '--', child.address],
    ['read', '--json', '--lines', '0', '--', finishedChild.address],
    ['interrupt', '--json', '--', child.address],
    ['kill', '--json', '--', child.address],
    ['rm', '--json', '--', finishedChild.address],
    ['kill', '--json', '--', child.address],
    ['rm', '--json', '--', child.address],
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
      case 'ls':
        expect(args).toEqual(['ls', '--json', '--all', '--label', 'pi-herdr-agents=agent']);
        return stdout({ terminals });
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

test('hc_subagent places the child in a new, shared, or own tab', async () => {
  const space = { 'herdr.space': 's1' };
  const tabbed = { ...child, address: 't6', labels: { ...space, 'herdr.tab': 'tb-child' } };
  let children = [child];
  const runs: string[][] = [];
  const invoke = register(async (command, args) => {
    if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
    switch (args[0]) {
      case 'get':
        if (args.at(-1) === self.address) {
          return stdout({ ...self, labels: { ...space, 'herdr.tab': 'tb-self' } });
        }
        if (args.at(-1) === tabbed.address) return stdout(tabbed);
        return stdout({ ...child, status: { app: 'pi', state: 'idle' } });
      case 'ls':
        return stdout({ terminals: children });
      case 'run':
        runs.push(args.filter((arg) => arg.startsWith('herdr.')));
        return stdout(child);
      case 'wait':
        return stdout({});
      case 'send':
        return stdout({ started: true, turn: 1 });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });
  await invoke('hc_subagent', { name: 'a', task: 'Work' });
  await invoke('hc_subagent', { name: 'b', task: 'Work', tab: 'new' });
  await invoke('hc_subagent', { name: 'c', task: 'Work', tab: 'shared' });
  children = [child, tabbed];
  await invoke('hc_subagent', { name: 'd', task: 'Work', tab: 'shared' });
  await invoke('hc_subagent', { name: 'e', task: 'Work', tab: 'self' });
  await expect(
    invoke('hc_subagent', { name: 'f', task: 'Work', tab: 'new', labels: { 'herdr.tab': 'x' } }),
  ).rejects.toThrow('conflicts with tab');
  await expect(
    invoke('hc_subagent', { name: 'g', task: 'Work', labels: { 'pi-herdr-agents.session': 'x' } }),
  ).rejects.toThrow('reserved');
  expect(runs).toEqual([
    [],
    ['herdr.space=s1'],
    ['herdr.space=s1'],
    ['herdr.space=s1', 'herdr.tab=tb-child'],
    ['herdr.space=s1', 'herdr.tab=tb-self'],
  ]);
});

test('hc_renew types /new, waits for a new session, and sends the new task', async () => {
  let status = 'done';
  let session: string | undefined = 's1';
  const calls: string[][] = [];
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        if (args.at(-1) === self.address) return stdout(self);
        return stdout({
          ...child,
          labels: session ? { 'pi-herdr-agents.session': session } : {},
          status: { app: 'pi', state: status },
        });
      case 'ls':
        return stdout({ terminals: [child] });
      case 'keys':
        calls.push(args);
        session = 's2';
        return stdout({});
      case 'wait':
        return stdout({});
      case 'send':
        calls.push(args);
        status = 'working';
        return stdout({ started: true, turn: 1 });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });

  status = 'working';
  await expect(invoke('hc_renew', { target: child.address, task: 'Next' })).rejects.toThrow(
    'is working',
  );
  status = 'done';
  session = undefined;
  await expect(invoke('hc_renew', { target: child.address, task: 'Next' })).rejects.toThrow(
    'does not report its session',
  );
  session = 's1';
  status = 'idle';
  const output = await invoke('hc_renew', { target: child.address, task: 'Next unit' });
  expect(output.details).toMatchObject({ first_message: { sent: true } });
  expect(calls).toEqual([
    ['keys', '--json', '--', 't5', '/', 'n', 'e', 'w', 'enter'],
    ['send', '--json', '--if', 'idle', '--', 't5', expect.stringContaining('Next unit')],
  ]);
});
