import { expect, spyOn, test } from 'bun:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HcClient } from '../extensions/hc-client.ts';
import { inboxLabelKey, registerHcMailbox, sendToParent } from '../extensions/hc-mailbox.ts';

async function withMailbox(run: (mailbox: Awaited<ReturnType<typeof load>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'hc-mailbox-'));
  const mailbox = load(root);
  try {
    await mailbox.emit('session_start', {});
    await run(mailbox);
  } finally {
    await mailbox.emit('session_shutdown', { reason: 'quit' });
    await rm(root, { recursive: true, force: true });
  }
}

function load(root: string) {
  const parent = {
    address: 't1',
    created_ms: 123,
    state: 'live' as const,
    status: { app: 'pi', state: 'blocked' },
    labels: { [inboxLabelKey]: '1' },
  };
  const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
  const submissions: unknown[][] = [];
  const notifications: string[] = [];
  const labels: string[] = [];
  const exec: ExtensionAPI['exec'] = async (_command, args) => {
    if (args[0] === 'send') throw new Error('The blocked Pi must never receive terminal input');
    if (args[0] === 'label') labels.push(args.at(-1)!);
    return { stdout: JSON.stringify(parent), stderr: '', code: 0, killed: false, truncated: false };
  };
  registerHcMailbox(
    {
      exec,
      on: (name: string, handler: (event: unknown, context: unknown) => unknown) => {
        handlers.set(name, handler);
      },
      sendUserMessage: (...args: unknown[]) => submissions.push(args),
    } as unknown as ExtensionAPI,
    parent.address,
    root,
  );
  const hc = new HcClient(exec);
  return {
    submissions,
    notifications,
    labels,
    dir: join(root, 't1-123'),
    setStatus: (state: string) => {
      parent.status.state = state;
    },
    queue: (report: string) =>
      sendToParent(hc, { ...parent, status: { app: 'pi', state: 'blocked' } }, report, root),
    emit: (name: string, event: unknown = {}) =>
      handlers.get(name)?.(event, {
        hasUI: true,
        isIdle: () => true,
        hasPendingMessages: () => false,
        ui: { notify: (message: string) => notifications.push(message) },
      }),
  };
}

async function until(assert: () => boolean | Promise<boolean>, timeout = 1_000) {
  const deadline = performance.now() + timeout;
  do {
    if (await assert()) return;
    await Bun.sleep(10);
  } while (performance.now() < deadline);
  throw new Error('The mailbox did not reach the expected state in time');
}

test('a blocked parent batches reports in order and removes them after Pi receives the batch', async () => {
  await withMailbox(async ({ emit, setStatus, queue, dir, submissions }) => {
    await emit('ui_prompt_start');
    expect(await queue('First child report')).toEqual({ sent: false, queued: true });
    await queue('Second child report');
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    if (process.platform !== 'win32') {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dir, files[0]!))).mode & 0o777).toBe(0o600);
    }

    setStatus('working');
    await emit('agent_settled');
    expect(submissions).toEqual([]);
    await writeFile(join(dir, 'unfinished.tmp'), 'Partial data');
    await emit('ui_prompt_end');
    await until(() => submissions.length === 1);
    const batch = 'First child report\n\nSecond child report';
    expect(submissions).toEqual([[batch, { deliverAs: 'followUp' }]]);
    expect(await readdir(dir)).toHaveLength(3);
    await emit('message_end', {
      message: { role: 'user', content: [{ type: 'text', text: batch }] },
    });
    await until(async () => (await readdir(dir)).length === 1);
    expect(await readdir(dir)).toEqual(['unfinished.tmp']);
  });
});

test('a report written after the prompt closes still wakes the parent', async () => {
  await withMailbox(async ({ emit, setStatus, queue, submissions }) => {
    await emit('ui_prompt_start');
    await emit('ui_prompt_end');
    // A stale blocked status is enough for the sender to queue during this window.
    setStatus('done');
    await queue('Late report');
    await until(() => submissions.length === 1);
    expect(submissions).toEqual([['Late report', { deliverAs: 'followUp' }]]);
  });
});

test('an unreceived report survives /new and waits for a native dialog to clear', async () => {
  await withMailbox(async ({ emit, setStatus, queue, submissions, labels }) => {
    await queue('Report across sessions');
    await emit('session_shutdown', { reason: 'new' });
    expect(labels).toEqual([`${inboxLabelKey}=1`]);
    await emit('session_start', { reason: 'new' });
    await Bun.sleep(40);
    expect(submissions).toEqual([]);
    setStatus('idle');
    await until(() => submissions.length === 1, 3_000);
    expect(submissions).toEqual([['Report across sessions', { deliverAs: 'followUp' }]]);
  });
});

test('an unconfirmed batch retries once and leaves later reports free to deliver', async () => {
  const clock = spyOn(Date, 'now');
  let time = Date.now();
  clock.mockImplementation(() => time);
  try {
    await withMailbox(async ({ emit, setStatus, queue, dir, submissions, notifications }) => {
      await queue('Unconfirmed report');
      setStatus('idle');
      await emit('agent_settled');
      await until(() => submissions.length === 1);
      await queue('Later report');

      time += 31_000;
      await emit('agent_settled');
      await until(() => submissions.length === 2);
      expect(submissions.map(([text]) => text)).toEqual([
        'Unconfirmed report',
        'Unconfirmed report',
      ]);

      time += 31_000;
      await emit('agent_settled');
      await until(() => submissions.length === 3);
      expect(submissions[2]?.[0]).toBe('Later report');
      expect(notifications).toEqual([expect.stringContaining('not confirmed after retrying')]);
      await emit('message_end', { message: { role: 'user', content: 'Later report' } });
      await until(async () => (await readdir(dir)).length === 1);
      const [file] = await readdir(dir);
      expect(file).toEndWith('.unconfirmed');
      expect(await readFile(join(dir, file!), 'utf8')).toBe('Unconfirmed report');
    });
  } finally {
    clock.mockRestore();
  }
});

test('a persistent scan failure warns once and quitting clears the inbox label', async () => {
  await withMailbox(async ({ emit, dir, queue, notifications, labels }) => {
    const moved = `${dir}-moved`;
    await queue('Unreceived report');
    await rename(dir, moved);
    await emit('agent_settled');
    await until(() => notifications.length === 1);
    await emit('agent_settled');
    await Bun.sleep(30);
    expect(notifications).toEqual([expect.stringContaining('Could not process the HC inbox')]);
    await rename(moved, dir);
    await emit('session_shutdown', { reason: 'quit' });
    expect(labels).toEqual([`${inboxLabelKey}=1`, `${inboxLabelKey}=`]);
    await expect(stat(dir)).rejects.toHaveProperty('code', 'ENOENT');
  });
});
