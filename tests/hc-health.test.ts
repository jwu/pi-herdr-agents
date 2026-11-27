import { expect, test } from 'bun:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHcHealth, runError } from '../extensions/hc-health.ts';

function stdout(data: unknown) {
  return { stdout: JSON.stringify(data), stderr: '', code: 0, killed: false, truncated: false };
}

function load(self: { address: string; name?: string; parent?: string | null }) {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const sends: string[][] = [];
  registerHcHealth(
    {
      exec: async (_command: string, args: string[]) => {
        if (args[0] === 'get') {
          return stdout(
            args.at(-1) === self.address
              ? { ...self, state: 'live' }
              : { address: 't1', state: 'live', status: { app: 'pi', state: 'working' } },
          );
        }
        sends.push(args);
        return stdout({ started: true, turn: 3 });
      },
      on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler),
    } as unknown as Pick<ExtensionAPI, 'exec' | 'on'>,
    self.address,
  );
  const emit = async (name: string, event: unknown = {}) => {
    await handlers.get(name)?.(event);
    // ui_prompt_start reports without blocking the dialog.
    await new Promise((done) => setTimeout(done, 0));
  };
  return { emit, sends };
}

const failed = {
  role: 'assistant',
  stopReason: 'error',
  errorMessage: 'content_filter: the model refused',
};

test('runError reads the last assistant message of a run', () => {
  expect(runError([{ role: 'user' }, failed])).toBe('content_filter: the model refused');
  expect(runError([failed, { role: 'assistant', stopReason: 'stop' }])).toBeUndefined();
  expect(runError([{ role: 'assistant', stopReason: 'error' }])).toContain('without an error');
  expect(runError([])).toBeUndefined();
});

test('a child tells its parent when its settled run ended in an error', async () => {
  const { emit, sends } = load({ address: 't5', name: 'reviewer', parent: 't1' });
  await emit('agent_start');
  await emit('agent_end', { messages: [{ role: 'user' }, failed] });
  await emit('agent_settled', { aborted: false });
  expect(sends).toHaveLength(1);
  expect(sends[0]!.slice(0, 6)).toEqual(['send', '--json', '--if', 'working', '--', 't1']);
  expect(sends[0]!.at(-1)).toStartWith('HC agent message from t5:\n\n');
  expect(sends[0]!.at(-1)).toContain('t5 (reviewer) stopped with an error');
  expect(sends[0]!.at(-1)).toContain('content_filter: the model refused');

  // A successful run and an aborted run stay quiet.
  await emit('agent_start');
  await emit('agent_end', { messages: [{ role: 'assistant', stopReason: 'stop' }] });
  await emit('agent_settled', { aborted: false });
  await emit('agent_start');
  await emit('agent_end', { messages: [failed] });
  await emit('agent_settled', { aborted: true });
  expect(sends).toHaveLength(1);
});

test('a child tells its parent when it waits on a dialog', async () => {
  const { emit, sends } = load({ address: 't5', name: 't5', parent: 't1' });
  await emit('ui_prompt_start', { kind: 'confirm', title: 'Trust this project?' });
  expect(sends[0]!.at(-1)).toContain('t5 is blocked on a confirm dialog: Trust this project?');
});

test('a root and a child of a remote parent report nothing', async () => {
  for (const parent of [null, 'machine/t1']) {
    const { emit, sends } = load({ address: 't5', parent });
    await emit('agent_end', { messages: [failed] });
    await emit('agent_settled', { aborted: false });
    expect(sends).toHaveLength(0);
  }
});
