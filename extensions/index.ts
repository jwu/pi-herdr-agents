import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { registerHcTools } from './hc-tools.ts';

export default function (pi: ExtensionAPI): void {
  const address = process.env.HC_TERMINAL_ID;
  if (address) {
    registerHcTools(pi, address, fileURLToPath(new URL('./index.ts', import.meta.url)));
  }
}
