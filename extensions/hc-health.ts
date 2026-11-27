import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { HcClient } from './hc-client.ts';
import { messagePrefix } from './hc-inbox.ts';

const maxErrorLength = 2_000;

interface RunMessage {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

/** The error that ended a run, or undefined when its last assistant message did not fail. */
export function runError(messages: readonly unknown[]) {
  const last = [...messages]
    .reverse()
    .find((message) => (message as RunMessage | undefined)?.role === 'assistant') as
    RunMessage | undefined;
  if (last?.stopReason !== 'error') return undefined;
  const error = last.errorMessage?.trim() || 'The model request failed without an error message.';
  return error.length > maxErrorLength ? `${error.slice(0, maxErrorLength)}…` : error;
}

/**
 * A child whose model fails cannot report with hc_send, and its parent does not poll. The
 * extension still runs, so it tells the parent when a run ends in an error or Pi waits on a
 * dialog. A root has no parent and reports nothing.
 */
export function registerHcHealth(pi: Pick<ExtensionAPI, 'exec' | 'on'>, address: string) {
  const hc = new HcClient(pi.exec.bind(pi));
  let self: Promise<{ name: string; parent: string } | null> | undefined;
  const lookup = () =>
    (self ??= hc
      .get(address)
      .then(({ name, parent }) =>
        parent && !parent.includes('/') ? { name: name ?? address, parent } : null,
      )
      .catch(() => {
        self = undefined;
        return null;
      }));

  async function report(news: string) {
    const me = await lookup();
    if (!me) return;
    const label = me.name === address ? address : `${address} (${me.name})`;
    try {
      await hc.send(
        await hc.get(me.parent),
        `${messagePrefix} ${address}:\n\n[Automatic notice from the pi-herdr-agents extension] ${label} ${news}`,
      );
    } catch {
      // The parent is gone or cannot take input. hc still shows the child's status.
    }
  }

  let lastRun: readonly unknown[] = [];
  pi.on('agent_start', () => {
    lastRun = [];
  });
  pi.on('agent_end', (event) => {
    lastRun = event.messages;
  });
  // agent_settled follows Pi's own retries, so a reported error is final.
  pi.on('agent_settled', async (event) => {
    const error = event.aborted ? undefined : runError(lastRun);
    lastRun = [];
    if (error) await report(`stopped with an error and cannot report on its own:\n\n${error}`);
  });
  // Not awaited, so the dialog opens without waiting for hc.
  pi.on('ui_prompt_start', (event) => {
    const title = event.title ? `: ${event.title}` : '';
    void report(`is blocked on a ${event.kind} dialog${title}. Read its screen with hc_read.`);
  });
}
