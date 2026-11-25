import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const messagePrefix = 'HC agent message from';

/**
 * The sender of an hc_send message, or undefined for other input. hc wraps delivered text in
 * `<hc from="<address>[ <name>]">…</hc>` unless its notes are off, and that address is set by hc,
 * so it takes precedence over the address in the message prefix.
 */
export function hcSender(input: string) {
  const envelope = /^<hc from="([^"\s]+)[^"]*">([\s\S]*)<\/hc>$/.exec(input.trim());
  const body = envelope ? envelope[2]! : input.trim();
  const prefix = new RegExp(`^${messagePrefix} ([a-zA-Z0-9_/-]+):`).exec(body);
  if (!prefix) return undefined;
  return envelope ? envelope[1]! : prefix[1]!;
}

/**
 * While Pi works, Enter queues input as steering. Messages from the parent stay steering so its
 * corrections land quickly. Reports from children and messages from siblings become follow-ups,
 * which wait until the current run ends instead of interrupting it.
 */
export function registerHcInbox(
  pi: Pick<ExtensionAPI, 'exec' | 'on' | 'sendUserMessage'>,
  address: string,
) {
  let parent: Promise<string | null> | undefined;
  const parentOf = () =>
    (parent ??= pi
      .exec('hc', ['get', '--json', '--', address], { timeout: 5_000 })
      .then(({ code, stdout }) => (code === 0 ? (JSON.parse(stdout).parent ?? null) : null))
      .catch(() => null));

  pi.on('input', async (event) => {
    if (event.streamingBehavior !== 'steer') return;
    const sender = hcSender(event.text);
    if (!sender || sender === (await parentOf())) return;
    pi.sendUserMessage(event.text, { deliverAs: 'followUp' });
    return { action: 'handled' };
  });
}
