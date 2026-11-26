import { sessionFileLabelKey, sessionLabelKey, type HcClient, type Terminal } from './hc-client.ts';

const maxMessageLength = 4_000;
const firstWindow = 100;

interface FileRead {
  text: string;
  first: number;
  last: number;
  lines: number;
}

interface Entry {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  truncated?: true;
}

function parse(line: string): Entry | undefined {
  try {
    return JSON.parse(line) as Entry;
  } catch {
    // Pi may be appending the last line.
    return undefined;
  }
}

function toMessage(entry: Entry): TranscriptMessage | undefined {
  const { role, content } = entry.message ?? {};
  if (entry.type !== 'message' || (role !== 'user' && role !== 'assistant')) return undefined;
  const text = (
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text as string)
            .join('\n')
        : ''
  ).trim();
  if (!text) return undefined;
  if (text.length <= maxMessageLength) return { role, text, timestamp: entry.timestamp };
  return {
    role,
    text: text.slice(0, maxMessageLength),
    timestamp: entry.timestamp,
    truncated: true,
  };
}

/**
 * The last user and assistant messages on the current branch of a Pi session. It reads the file
 * the terminal reports, through hc so a peer on another machine works the same way, and walks
 * back from the newest entry so abandoned /tree branches are skipped.
 */
export async function readTranscript(hc: HcClient, terminal: Terminal, limit: number) {
  const session = terminal.labels?.[sessionLabelKey];
  const file = terminal.labels?.[sessionFileLabelKey];
  if (!session || !file) throw new Error(`${terminal.address} does not report a session file.`);
  // The terminal sets its own labels, so only a .jsonl path that holds its session is read.
  if (!/^(\/|[A-Za-z]:[\\/]).*\.jsonl$/.test(file)) {
    throw new Error(`${terminal.address} reports a path that is not a Pi session file.`);
  }
  const slash = terminal.address.lastIndexOf('/');
  const on = slash === -1 ? [] : ['--on', terminal.address.slice(0, slash)];
  const read = (offset: number, count: number) =>
    hc.command<FileRead>(
      'file',
      ['read', ...on, '--offset', String(offset), '--limit', String(count), '--', file],
      30_000,
      32 * 1024 * 1024,
    );
  // hc returns at most 8 MB per read, so a range may take several.
  const range = async (from: number, to: number) => {
    const lines: string[] = [];
    while (from <= to) {
      const chunk = await read(from, to - from + 1);
      if (chunk.last < chunk.first) break;
      lines.push(...chunk.text.split('\n').slice(0, chunk.last - chunk.first + 1));
      from = chunk.last + 1;
    }
    return lines;
  };

  const head = await read(1, 1);
  const header = parse(head.text);
  if (header?.type !== 'session' || header.id !== session) {
    throw new Error(`${terminal.address}'s session file does not hold its session.`);
  }

  const entries = new Map<string, Entry>();
  let leaf: Entry | undefined;
  let end = head.lines;
  for (let size = firstWindow; ; size *= 4) {
    const from = Math.max(2, head.lines - size + 1);
    for (const entry of (await range(from, end)).map(parse)) {
      if (!entry?.id) continue;
      entries.set(entry.id, entry);
      if (end === head.lines) leaf = entry;
    }
    end = from - 1;

    const messages: TranscriptMessage[] = [];
    let missing = false;
    for (let entry = leaf; entry && messages.length < limit;) {
      const message = toMessage(entry);
      if (message) messages.push(message);
      if (!entry.parentId) break;
      entry = entries.get(entry.parentId);
      missing = !entry;
    }
    if (!missing || from === 2) return { session_file: file, messages: messages.reverse() };
  }
}
