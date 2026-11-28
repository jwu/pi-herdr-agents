import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const agentLabel = 'pi-herdr-agents=agent';
export const sessionLabelKey = 'pi-herdr-agents.session';
export const sessionFileLabelKey = 'pi-herdr-agents.session-file';
/** Marks a Pi that runs this extension. The value is the peer protocol version. */
export const peerLabel = 'pi-herdr-agents.peer=1';

interface ListedTerminal {
  address: string;
  name?: string | null;
  cwd?: string | null;
  where?: string;
  parent?: string | null;
  state: 'live' | 'finished';
  status?: string | null;
  agent?: string;
  exit_code?: number | null;
}

export interface Terminal extends Omit<ListedTerminal, 'status'> {
  created_ms?: number;
  status?: { app?: string; state: string } | null;
  labels?: Record<string, string>;
}

export interface Delivery {
  started?: boolean | null;
  status?: string | null;
  turn: number;
}

export function summarizeTerminal(terminal: Terminal): ListedTerminal {
  const { address, name, cwd, where, parent, state, status, exit_code } = terminal;
  return {
    address,
    name,
    cwd,
    where,
    parent,
    state,
    status: status?.state,
    agent: status?.app,
    exit_code,
  };
}

export class HcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function canReceive(terminal: Terminal) {
  return (
    terminal.state === 'live' &&
    terminal.status?.app === 'pi' &&
    ['idle', 'working', 'done'].includes(terminal.status.state)
  );
}

export class HcClient {
  constructor(
    private readonly exec: ExtensionAPI['exec'],
    private readonly signal?: AbortSignal,
  ) {}

  async command<T = unknown>(
    command: string,
    args: string[],
    timeout = 15_000,
    maxBuffer = 4 * 1024 * 1024,
  ): Promise<T> {
    this.signal?.throwIfAborted();
    const result = await this.exec('hc', [command, '--json', ...args], {
      signal: this.signal,
      timeout,
      maxBuffer,
    });
    this.signal?.throwIfAborted();
    if (result.truncated) throw new Error(`hc ${command} exceeded its output limit.`);
    if (result.killed)
      throw new Error(`hc ${command} timed out. Check the terminal before retrying.`);
    if (result.code !== 0) {
      throw new HcError(
        result.code,
        `hc ${command} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new Error(`hc ${command} did not return JSON.`);
    }
  }

  get(address: string) {
    return this.command<Terminal>('get', ['--', address]);
  }

  run(args: string[]) {
    return this.command<ListedTerminal>('run', args);
  }

  async family(address: string) {
    const self = await this.get(address);
    const list = (label: string) =>
      this.command<{ terminals: ListedTerminal[] }>('ls', ['--all', '--label', label]);
    // Peers are other root Pi sessions, on this machine or a connected one. Only a root has them,
    // so a child cannot reach its own ancestors this way.
    const [{ terminals }, peers] = await Promise.all([
      list(agentLabel),
      self.parent
        ? []
        : list(peerLabel).then(({ terminals }) =>
            terminals.filter((terminal) => !terminal.parent && terminal.address !== self.address),
          ),
    ]);
    const local = terminals.filter((terminal) => !terminal.address.includes('/'));
    const parent =
      self.parent && !self.parent.includes('/') ? await this.getParent(self.parent) : null;
    const children = local.filter((terminal) => terminal.parent === self.address);
    const siblings = self.parent
      ? local.filter(
          (terminal) => terminal.parent === self.parent && terminal.address !== self.address,
        )
      : [];
    return { self: summarizeTerminal(self), parent, children, siblings, peers };
  }

  private async getParent(address: string) {
    try {
      return summarizeTerminal(await this.get(address));
    } catch (error) {
      if (error instanceof HcError && error.code === 3) return null;
      throw error;
    }
  }

  async send(terminal: Terminal, message: string, options: { strictStatus?: boolean } = {}) {
    try {
      return await this.deliver(terminal, message);
    } catch (error) {
      // A status mismatch means hc typed nothing. It is safe to refresh the target once.
      if (options.strictStatus || !(error instanceof HcError) || error.code !== 10) throw error;
      return this.deliver(await this.get(terminal.address), message);
    }
  }

  private deliver(terminal: Terminal, message: string) {
    if (!canReceive(terminal)) {
      const reason = `${terminal.address} is ${terminal.status?.state ?? terminal.state} and is not ready for Pi input. Check its terminal before retrying.`;
      if (
        terminal.state === 'live' &&
        terminal.status?.app === 'pi' &&
        terminal.status.state === 'blocked'
      ) {
        throw new HcError(9, reason);
      }
      throw new Error(reason);
    }
    // hc can atomically guard against a status change for these two states.
    const state = terminal.status?.state;
    const guard = state === 'idle' || state === 'working' ? ['--if', state] : [];
    return this.command<Delivery>('send', [...guard, '--', terminal.address, message], 90_000);
  }
}
