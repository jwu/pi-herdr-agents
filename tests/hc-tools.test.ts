import { expect, test } from 'bun:test';
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { parseAgentProfile } from '@johnnywu/pi-agent-profiles';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { childPiArgs } from '../extensions/agent-profiles.ts';
import { childSessionDir, registerHcTools } from '../extensions/hc-tools.ts';

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
const delegationTools = 'hc_subagent,hc_renew,hc_read,hc_stop,hc_rm';
const childSessionSlug = (cwd: string) =>
  `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;

function register(exec: ExtensionAPI['exec'], cwd = workspace, sessionDir = '') {
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
    tools.get(name)!.execute('test', params, undefined, undefined, {
      cwd,
      sessionManager: { getSessionDir: () => sessionDir },
    } as unknown as ExtensionToolContext);
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
      '--exclude-tools',
      delegationTools,
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

test.each([
  ['the default layout', '/sessions/--lead--', join('/sessions/--lead-child--/hc-children')],
  [
    'a child in the default layout',
    '/sessions/--lead--/hc-children',
    join('/sessions/--lead-child--/hc-children'),
  ],
  ['a custom directory', '/custom', join('/custom/hc-children')],
  ['a child in a custom directory', '/custom/hc-children', join('/custom/hc-children')],
])('childSessionDir keeps children out of /resume from %s', (_case, parentDir, expected) => {
  expect(childSessionDir(parentDir, '/lead', '/lead/child')).toBe(expected);
});

test('childSessionDir leaves the session directory alone when the parent does not persist sessions', () => {
  expect(childSessionDir('', '/lead', '/lead/child')).toBeUndefined();
});

test('hc_subagent passes the child session directory to the child', async () => {
  const leadCwd = resolve('/lead');
  const parentDir = join(resolve('/sessions'), childSessionSlug(leadCwd));
  const runs: string[][] = [];
  const invoke = register(
    async (command, args) => {
      if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
      if (args[0] === 'run') {
        runs.push(args);
        return stdout(child);
      }
      if (args[0] === 'wait') return stdout({});
      if (args[0] === 'get') return stdout({ ...child, status: { app: 'pi', state: 'idle' } });
      if (args[0] === 'send') return stdout({ started: true });
      throw new Error(`Unexpected ${args[0]}`);
    },
    leadCwd,
    parentDir,
  );

  await invoke('hc_subagent', { name: 'review', task: 'Review this', cwd: 'child workspace' });
  const args = runs[0]!;
  expect(args.slice(args.indexOf('--') + 1)).toEqual([
    ...env,
    executable,
    '-e',
    '/package/extensions/index.ts',
    '--hc-agent-profile',
    JSON.stringify({ depth: 1 }),
    '--exclude-tools',
    delegationTools,
    '--session-dir',
    join(resolve('/sessions'), childSessionSlug(join(leadCwd, 'child workspace')), 'hc-children'),
  ]);
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
          delegationTools,
          '--no-context-files',
          '--model',
          'test/model-custom',
          '--thinking',
          'high',
          '--tools',
          'read,subagent,hc_subagent,hc_renew,hc_read,hc_stop,hc_rm,hc_send,hc_agents',
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

test.each(['+', '-'])(
  'hc_subagent applies %ssubagent to both blocking and HC delegation tools',
  async (prefix) => {
    const cwd = await mkdtemp(join(tmpdir(), 'hc-profile-'));
    try {
      const profile = join(cwd, 'profile.md');
      const source = `---\nname: hc-test-reviewer\ntools: ${prefix}subagent\n---\n`;
      await writeFile(profile, source);
      const args = await childPiArgs(parseAgentProfile(source, profile));
      expect(args.includes('--exclude-tools')).toBe(prefix === '-');
      expect(args.slice(-2)).toEqual([
        '--tools',
        ['subagent', 'hc_subagent', 'hc_renew', 'hc_read', 'hc_stop', 'hc_rm']
          .map((tool) => `${prefix}${tool}`)
          .concat('+hc_send', '+hc_agents')
          .join(','),
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.each([
  ['has no tools', [], undefined, delegationTools],
  ['adds other tools', ['tools: +codemode'], undefined, delegationTools],
  ['lists them by pattern', ['tools: read, hc_*'], undefined, undefined],
  [
    'has no agent left to delegate to',
    ['tools: read, subagent', 'allowedAgents: scout'],
    { depth: 0, allowedAgents: ['worker'] },
    delegationTools,
  ],
])(
  'hc_subagent decides the delegation tools of a child whose profile %s',
  async (_case, fields, scope, excluded) => {
    const cwd = await mkdtemp(join(tmpdir(), 'hc-profile-'));
    try {
      const profile = join(cwd, 'profile.md');
      const source = ['---', 'name: hc-test-reviewer', ...fields, '---', ''].join('\n');
      await writeFile(profile, source);
      const args = await childPiArgs(parseAgentProfile(source, profile), scope);
      const flag = args.indexOf('--exclude-tools');
      expect(flag < 0 ? undefined : args[flag + 1]).toBe(excluded);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test('hc_subagent counts maxDepth from each agent and passes the tightest limit down', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'hc-profile-'));
  try {
    const load = async (name: string, maxDepth: number) => {
      const file = join(cwd, `${name}.md`);
      const source = [
        '---',
        `name: ${name}`,
        'tools: read, subagent',
        `maxDepth: ${maxDepth}`,
        '---',
        '',
      ].join('\n');
      await writeFile(file, source);
      return parseAgentProfile(source, file);
    };
    const launch = async (
      profile: Awaited<ReturnType<typeof load>>,
      scope?: Parameters<typeof childPiArgs>[1],
    ) => {
      const args = await childPiArgs(profile, scope);
      const { depth, maxDepth } = JSON.parse(args[1]!);
      return { depth, maxDepth, delegates: !args.includes('--exclude-tools') };
    };

    // a, b, c, and d each declare maxDepth: 3. The budget of a runs out at d.
    const three = await load('three', 3);
    const chain = [await launch(three)];
    for (let level = 1; level < 4; level++) chain.push(await launch(three, chain[level - 1]));
    expect(chain).toEqual([
      { depth: 1, maxDepth: 3, delegates: true },
      { depth: 2, maxDepth: 3, delegates: true },
      { depth: 3, maxDepth: 3, delegates: true },
      { depth: 4, maxDepth: 3, delegates: false },
    ]);

    // maxDepth: 1 allows one level of children wherever the agent runs.
    const one = await load('one', 1);
    const nested = await launch(one, { depth: 1, maxDepth: 10 });
    expect(nested).toEqual({ depth: 2, maxDepth: 2, delegates: true });
    expect(await launch(three, nested)).toEqual({ depth: 3, maxDepth: 2, delegates: false });
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
  await invoke('hc_read', { target: finishedChild.address, source: 'screen' });
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
    ['read', '--json', '--lines', '0', '--', child.address],
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
  await expect(invoke('hc_send', { target: 't4', message: 'Outside' })).rejects.toThrow(
    'not your parent',
  );
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
    ['herdr.space=s1', expect.stringMatching(/^herdr\.tab=.+/)],
    ['herdr.space=s1', expect.stringMatching(/^herdr\.tab=.+/)],
    ['herdr.space=s1', 'herdr.tab=tb-child'],
    ['herdr.space=s1', 'herdr.tab=tb-self'],
  ]);
  expect(runs[1]![1]).not.toBe(runs[2]![1]);
});

test.each(['sequential', 'concurrent'])(
  'hc_subagent shares a tab across %s launches and replaces it after children leave',
  async (mode) => {
    const terminals: Array<typeof child & { labels: Record<string, string> }> = [];
    const invoke = register(async (command, args) => {
      if (command !== 'hc') return { ...stdout(null), stdout: executable + '\n' };
      switch (args[0]) {
        case 'get':
          if (args.at(-1) === self.address) {
            return stdout({ ...self, labels: { 'herdr.space': 's1', 'herdr.tab': 'self' } });
          }
          return stdout({
            ...terminals.find(({ address }) => address === args.at(-1)),
            status: { app: 'pi', state: 'idle' },
          });
        case 'ls':
          return stdout({ terminals: [...terminals] });
        case 'run': {
          const labels: Record<string, string> = {};
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '--label') {
              const [key, value] = args[++i]!.split('=', 2);
              labels[key!] = value!;
            }
          }
          const terminal = { ...child, address: `t${terminals.length + 10}`, labels };
          terminals.push(terminal);
          return stdout(terminal);
        }
        case 'wait':
          return stdout({});
        case 'send':
          return stdout({ started: true });
        default:
          throw new Error(`Unexpected ${args[0]}`);
      }
    });
    const launch = (name: string, tab: string) =>
      invoke('hc_subagent', { name, task: 'Work', tab });
    if (mode === 'concurrent') {
      await Promise.all([launch('a', 'shared'), launch('b', 'shared')]);
    } else {
      await launch('a', 'shared');
      await launch('b', 'shared');
    }
    const shared = terminals[0]!.labels['herdr.tab'];
    expect(shared).toBeTruthy();
    expect(terminals[1]!.labels['herdr.tab']).toBe(shared);
    await launch('c', 'new');
    await launch('d', 'new');
    expect(terminals[2]!.labels['herdr.tab']).toBeTruthy();
    expect(terminals[3]!.labels['herdr.tab']).toBeTruthy();
    expect(
      new Set([shared, terminals[2]!.labels['herdr.tab'], terminals[3]!.labels['herdr.tab']]).size,
    ).toBe(3);
    terminals.length = 0;
    await launch('e', 'shared');
    expect(terminals[0]!.labels['herdr.tab']).toBeTruthy();
    expect(terminals[0]!.labels['herdr.tab']).not.toBe(shared);
  },
);

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

const root = { address: 't2', parent: null, state: 'live' };
const peerLabel = 'pi-herdr-agents.peer=1';

test('a root lists peers on any machine and messages remote peers with its global address', async () => {
  const localPeer = { address: 't7', parent: null, state: 'live', agent: 'pi', status: 'done' };
  const remotePeer = { address: 'm5/t3', parent: null, state: 'live', agent: 'pi', status: 'idle' };
  const remoteChild = { address: 'm5/t4', parent: 't3', state: 'live' };
  const sends: string[][] = [];
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        switch (args.at(-1)) {
          case root.address:
            return stdout(root);
          case localPeer.address:
            return stdout({ ...localPeer, status: { app: 'pi', state: 'done' } });
          case remotePeer.address:
          case 'core-m5/t3':
            return stdout({ ...remotePeer, status: { app: 'pi', state: 'idle' } });
          default:
            return { ...stdout(null), code: 3, stderr: '{"error":{"kind":"not_found"}}' };
        }
      case 'ls':
        return stdout({
          terminals: args.at(-1) === peerLabel ? [root, localPeer, remotePeer, remoteChild] : [],
        });
      case 'server':
        expect(args).toEqual(['server', '--json', 'status']);
        return stdout({ core: { id: 'core-m4', name: 'm4' } });
      case 'send':
        sends.push(args);
        return stdout({ started: true, turn: 1 });
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });

  expect((await invoke('hc_agents', {})).details).toMatchObject({
    parent: null,
    peers: [{ address: 't7' }, { address: 'm5/t3' }],
  });
  // A reply uses the address from the hc envelope, which names the machine by its core ID.
  await invoke('hc_send', { target: 'core-m5/t3', message: 'Remote' });
  await invoke('hc_send', { target: 't7', message: 'Local' });
  await expect(invoke('hc_send', { target: 'm5/t4', message: 'Not a root' })).rejects.toThrow(
    'not your parent',
  );
  await expect(invoke('hc_send', { target: 'm6/t1', message: 'Unknown' })).rejects.toThrow(
    'not your parent',
  );
  expect(sends).toEqual([
    [
      'send',
      '--json',
      '--if',
      'idle',
      '--',
      'm5/t3',
      'HC agent message from core-m4/t2:\n\nRemote',
    ],
    ['send', '--json', '--', 't7', 'HC agent message from t2:\n\nLocal'],
  ]);
});

function sessionFile(lines: object[]) {
  return [{ type: 'session', version: 3, id: 's1' }, ...lines].map((line) => JSON.stringify(line));
}

function readPeer(options: {
  lines: string[];
  labels?: Record<string, string>;
  status?: string;
  address?: string;
}) {
  const address = options.address ?? 'm5/t3';
  const peer = {
    address,
    parent: null,
    state: 'live',
    status: { app: 'pi', state: options.status ?? 'done' },
    labels: options.labels ?? {
      'pi-herdr-agents.session': 's1',
      'pi-herdr-agents.session-file': '/home/u/.pi/agent/sessions/--x--/s1.jsonl',
    },
  };
  const reads: string[][] = [];
  const invoke = register(async (_command, args) => {
    switch (args[0]) {
      case 'get':
        return stdout(args.at(-1) === root.address ? root : peer);
      case 'ls':
        return stdout({ terminals: args.at(-1) === peerLabel ? [root, peer] : [] });
      case 'read':
        reads.push(args);
        return stdout({ text: 'screen text', complete: true, how: 'screen' });
      case 'file': {
        reads.push(args);
        const offset = Number(args[args.indexOf('--offset') + 1]);
        const limit = Number(args[args.indexOf('--limit') + 1]);
        // Like hc's 8 MB cap, a read may stop before the requested last line.
        const last = Math.min(offset + limit - 1, offset + 59, options.lines.length);
        const text = options.lines.slice(offset - 1, last).join('\n') + '\n';
        return stdout({ text, first: offset, last, lines: options.lines.length });
      }
      default:
        throw new Error(`Unexpected ${args[0]}`);
    }
  });
  return { invoke, reads };
}

test('hc_read returns the current branch of a peer transcript', async () => {
  const { invoke, reads } = readPeer({
    lines: sessionFile([
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'First' } },
      {
        type: 'message',
        id: 'b',
        parentId: 'a',
        timestamp: 't-b',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Answer one' }] },
      },
      {
        type: 'message',
        id: 'c',
        parentId: 'b',
        message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] },
      },
      { type: 'message', id: 'd', parentId: 'c', message: { role: 'toolResult', content: [] } },
      { type: 'message', id: 'x', parentId: 'b', message: { role: 'user', content: 'Abandoned' } },
      { type: 'message', id: 'e', parentId: 'd', message: { role: 'user', content: 'Second' } },
      {
        type: 'message',
        id: 'f',
        parentId: 'e',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hidden' },
            { type: 'text', text: 'y'.repeat(4_500) },
          ],
        },
      },
    ]),
  });

  const output = await invoke('hc_read', { target: 'm5/t3' });
  expect(output.details).toEqual({
    target: 'm5/t3',
    state: 'live',
    status: 'done',
    source: 'transcript',
    session_file: '/home/u/.pi/agent/sessions/--x--/s1.jsonl',
    messages: [
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'Answer one', timestamp: 't-b' },
      { role: 'user', text: 'Second' },
      { role: 'assistant', text: 'y'.repeat(4_000), truncated: true },
    ],
  });
  expect(reads[0]).toEqual([
    'file',
    '--json',
    'read',
    '--on',
    'm5',
    '--offset',
    '1',
    '--limit',
    '1',
    '--',
    '/home/u/.pi/agent/sessions/--x--/s1.jsonl',
  ]);
});

test('hc_read reads further back, in pieces, until it reaches enough messages', async () => {
  const filler = Array.from({ length: 150 }, (_, index) => ({
    type: 'custom',
    id: `c${index}`,
    parentId: index ? `c${index - 1}` : 'a',
  }));
  const { invoke, reads } = readPeer({
    address: 't9',
    lines: sessionFile([
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'First' } },
      ...filler,
      { type: 'message', id: 'z', parentId: 'c149', message: { role: 'user', content: 'Last' } },
    ]),
  });

  expect((await invoke('hc_read', { target: 't9', limit: 2 })).details).toMatchObject({
    messages: [
      { role: 'user', text: 'First' },
      { role: 'user', text: 'Last' },
    ],
  });
  // The header, the last 100 lines in two pieces, then the remaining lines.
  expect(reads.map((args) => args.slice(args.indexOf('--offset') + 1, -2))).toEqual([
    ['1', '--limit', '1'],
    ['54', '--limit', '100'],
    ['114', '--limit', '40'],
    ['2', '--limit', '52'],
  ]);
  expect(reads[0]).not.toContain('--on');
});

test('hc_read falls back to the screen in auto mode and reports why', async () => {
  const noFile = readPeer({ lines: [], labels: {} });
  expect((await noFile.invoke('hc_read', { target: 'm5/t3' })).details).toEqual({
    target: 'm5/t3',
    state: 'live',
    status: 'done',
    source: 'screen',
    fallback_reason: 'm5/t3 does not report a session file.',
    text: 'screen text',
  });
  await expect(noFile.invoke('hc_read', { target: 'm5/t3', source: 'transcript' })).rejects.toThrow(
    'does not report a session file',
  );

  const spoofed = readPeer({
    lines: [],
    labels: { 'pi-herdr-agents.session': 's1', 'pi-herdr-agents.session-file': '/home/u/.ssh/id' },
  });
  await expect(
    spoofed.invoke('hc_read', { target: 'm5/t3', source: 'transcript' }),
  ).rejects.toThrow('not a Pi session file');
  expect(spoofed.reads).toEqual([]);

  const other = readPeer({ lines: [JSON.stringify({ type: 'session', id: 's0' })] });
  await expect(other.invoke('hc_read', { target: 'm5/t3', source: 'transcript' })).rejects.toThrow(
    'does not hold its session',
  );

  const blocked = readPeer({ lines: sessionFile([]), status: 'blocked' });
  expect((await blocked.invoke('hc_read', { target: 'm5/t3' })).details).toMatchObject({
    source: 'transcript',
    status: 'blocked',
    messages: [],
    hint: 'It is blocked. Read source "screen" to see why.',
  });
  expect(
    (await blocked.invoke('hc_read', { target: 'm5/t3', source: 'screen' })).details,
  ).toMatchObject({ source: 'screen', text: 'screen text' });
});
