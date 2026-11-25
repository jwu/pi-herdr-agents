import { expect, test } from 'bun:test';
import { hcSender, registerHcInbox } from '../extensions/hc-inbox.ts';

test('hcSender reads the hc envelope first, then the message prefix', () => {
  expect(hcSender('<hc from="t5">HC agent message from t5:\n\nDone</hc>')).toBe('t5');
  expect(hcSender('<hc from="t5 review">HC agent message from t1:\n\nDone</hc>')).toBe('t5');
  expect(hcSender('HC agent message from t5:\n\nDone')).toBe('t5');
  expect(hcSender('<hc from="t5">Fix the tests</hc>')).toBeUndefined();
  expect(hcSender('Please look at HC agent message from t5: later')).toBeUndefined();
});

test('incoming HC messages steer only when they come from the parent', async () => {
  let handler: (event: { text: string; streamingBehavior?: string }) => Promise<unknown>;
  const followUps: unknown[][] = [];
  let lookups = 0;
  registerHcInbox(
    {
      exec: async () => {
        lookups++;
        return { stdout: '{"parent":"t1"}', stderr: '', code: 0, killed: false, truncated: false };
      },
      on: ((_event: string, fn: typeof handler) => (handler = fn)) as never,
      sendUserMessage: (...args: unknown[]) => void followUps.push(args),
    },
    't2',
  );
  const child = '<hc from="t5">HC agent message from t5:\n\nDone</hc>';
  const parent = '<hc from="t1">HC agent message from t1:\n\nChange course</hc>';

  expect(await handler!({ text: child, streamingBehavior: 'steer' })).toEqual({
    action: 'handled',
  });
  expect(await handler!({ text: parent, streamingBehavior: 'steer' })).toBeUndefined();
  expect(await handler!({ text: child })).toBeUndefined();
  expect(await handler!({ text: child, streamingBehavior: 'followUp' })).toBeUndefined();
  expect(await handler!({ text: 'Fix it', streamingBehavior: 'steer' })).toBeUndefined();
  expect(followUps).toEqual([[child, { deliverAs: 'followUp' }]]);
  expect(lookups).toBe(1);
});
