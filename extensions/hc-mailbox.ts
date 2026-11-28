import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canReceive, HcClient, HcError, type Terminal } from './hc-client.ts';

export const inboxLabelKey = 'pi-herdr-agents.inbox';
const inboxRoot = join(homedir(), '.pi', 'herdr-inbox');
const scanInterval = 2_000;
const retryAfter = 30_000;

function inboxPath(root: string, { address, created_ms }: Terminal) {
  if (!/^[a-zA-Z0-9_-]+$/.test(address) || !Number.isSafeInteger(created_ms)) return;
  return join(root, `${address}-${created_ms}`);
}

export async function sendToParent(
  hc: HcClient,
  parent: Terminal,
  message: string,
  root = inboxRoot,
  signal?: AbortSignal,
) {
  try {
    return await hc.send(parent, message);
  } catch (error) {
    // hc typed nothing on code 9 (blocked, from hc or the local status check) or code 10
    // (status mismatch), so the report can be queued instead.
    if (!(error instanceof HcError) || ![9, 10].includes(error.code)) throw error;
    const dir = inboxPath(root, parent);
    if (
      parent.state !== 'live' ||
      parent.status?.app !== 'pi' ||
      !dir ||
      parent.labels?.[inboxLabelKey] !== '1'
    ) {
      throw error;
    }
    if (error.code === 10) {
      // hc.send already retried once. Both mismatches guarantee that hc typed nothing.
      const current = await hc.get(parent.address);
      if (
        current.created_ms !== parent.created_ms ||
        current.state !== 'live' ||
        current.status?.app !== 'pi' ||
        current.status.state !== 'blocked'
      )
        throw error;
    }
    signal?.throwIfAborted();
    const id = `${(performance.timeOrigin + performance.now()).toFixed(3)}-${randomUUID()}`;
    const temporary = join(dir, `${id}.tmp`);
    try {
      await writeFile(temporary, message, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, join(dir, `${id}.message`));
    } catch (writeError) {
      await rm(temporary, { force: true }).catch(() => {});
      throw new Error(
        `Could not queue a message for ${parent.address}: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
      );
    }
    return { queued: true, sent: false } as const;
  }
}

/** Receive queued reports in the Pi that owns the terminal, across session replacements. */
export function registerHcMailbox(
  pi: Pick<ExtensionAPI, 'exec' | 'on' | 'sendUserMessage'>,
  address: string,
  root = inboxRoot,
) {
  const hc = new HcClient(pi.exec.bind(pi));
  let prompts = 0;
  let mailbox:
    | {
        scan: () => Promise<void>;
        acknowledge: (text: string) => void;
        close: (quit: boolean) => Promise<void>;
      }
    | undefined;

  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const dir = inboxPath(root, await hc.get(address));
    if (!dir) return;
    await mkdir(dir, { recursive: true, mode: 0o700 });

    let closed = false;
    let running: Promise<void> | undefined;
    let scanAgain = false;
    let pending:
      { text: string; files: string[]; submitted: number; accepted: boolean } | undefined;
    const unavailable = () => closed || prompts > 0;
    const waitingForReceipt = () =>
      pending &&
      (pending.accepted ||
        Date.now() - pending.submitted < retryAfter ||
        !ctx.isIdle() ||
        ctx.hasPendingMessages());
    const drain = async () => {
      // sendUserMessage returns void. Keep the files until Pi confirms the user message arrived.
      if (pending?.accepted) {
        await Promise.all(pending.files.map((file) => rm(file, { force: true })));
        pending = undefined;
      }
      if (unavailable() || waitingForReceipt()) return;
      const files = (await readdir(dir))
        .filter((file) => file.endsWith('.message'))
        .sort()
        .map((file) => join(dir, file));
      if (!files.length || unavailable()) return;
      const messages = await Promise.all(files.map((file) => readFile(file, 'utf8')));
      const current = await hc.get(address);
      if (
        unavailable() ||
        waitingForReceipt() ||
        !canReceive(current) ||
        inboxPath(root, current) !== dir
      )
        return;
      const text = messages.join('\n\n');
      pending = { text, files, submitted: Date.now(), accepted: false };
      pi.sendUserMessage(text, { deliverAs: 'followUp' });
    };
    const scan = () => {
      if (closed) return Promise.resolve();
      if (running) {
        scanAgain = true;
        return running;
      }
      running = drain()
        .catch(() => {})
        .finally(() => {
          running = undefined;
          if (scanAgain) {
            scanAgain = false;
            void scan();
          }
        });
      return running;
    };
    // Periodic scans cover native Pi dialogs and missed file notifications. Empty scans don't call hc.
    let watcher: FSWatcher | undefined;
    try {
      watcher = watch(dir, { persistent: false }, (_event, file) => {
        if (!file || file.endsWith('.message')) void scan();
      });
      watcher.on('error', () => watcher?.close());
    } catch {
      // The periodic scan also works on file systems without a watcher.
    }
    const timer = setInterval(() => void scan(), scanInterval).unref();
    mailbox = {
      scan,
      acknowledge(text) {
        if (pending?.text !== text) return;
        pending.accepted = true;
        void scan();
      },
      async close(quit) {
        closed = true;
        clearInterval(timer);
        watcher?.close();
        if (pending?.accepted || quit) {
          await running;
          if (quit) await rm(dir, { recursive: true, force: true });
          else if (pending?.accepted)
            await Promise.all(pending.files.map((file) => rm(file, { force: true })));
        }
      },
    };
    await hc.command('label', ['--', address, `${inboxLabelKey}=1`]);
    void scan();
  });

  pi.on('ui_prompt_start', () => {
    prompts++;
  });
  pi.on('ui_prompt_end', () => {
    prompts = Math.max(0, prompts - 1);
    void mailbox?.scan();
  });
  pi.on('agent_settled', () => {
    void mailbox?.scan();
  });
  pi.on('message_end', ({ message }) => {
    if (message.role !== 'user') return;
    const content = message.content;
    mailbox?.acknowledge(
      typeof content === 'string'
        ? content
        : content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
    );
  });
  pi.on('session_shutdown', async ({ reason }) => {
    const previous = mailbox;
    mailbox = undefined;
    prompts = 0;
    await previous?.close(reason === 'quit');
  });
}
