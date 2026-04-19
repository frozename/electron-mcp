import {
  ElectronNetworkTailInputSchema,
  ElectronNetworkTailOutputSchema,
  type ElectronNetworkTailInput,
  type ElectronNetworkTailOutput,
  type NetworkEntry,
} from '../schemas/index.js';

import type { ToolHandler } from './types.js';

function statusOk(entry: NetworkEntry, statuses: readonly number[] | undefined): boolean {
  if (!statuses || statuses.length === 0) return true;
  return entry.status !== undefined && statuses.includes(entry.status);
}

function failureOk(entry: NetworkEntry, onlyFailures: boolean): boolean {
  if (!onlyFailures) return true;
  if (entry.failed) return true;
  return entry.status !== undefined && entry.status >= 400;
}

function urlOk(entry: NetworkEntry, pattern: RegExp | null): boolean {
  if (!pattern) return true;
  return pattern.test(entry.url);
}

function safeRegex(input: string | undefined): RegExp | null {
  if (!input) return null;
  try {
    return new RegExp(input);
  } catch {
    return null;
  }
}

export const electronNetworkTail: ToolHandler<
  ElectronNetworkTailInput,
  ElectronNetworkTailOutput
> = async (rawInput, ctx) => {
  const input = ElectronNetworkTailInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const buffer = session.networkBuffer;
  const pattern = safeRegex(input.urlPattern);

  const filtered = buffer.entries.filter(
    (entry) =>
      urlOk(entry, pattern) && statusOk(entry, input.status) && failureOk(entry, input.onlyFailures),
  );
  const sliceStart = Math.max(0, filtered.length - input.limit);
  const selected = filtered.slice(sliceStart);

  if (input.drain) {
    const toDrop = new Set(selected);
    buffer.entries = buffer.entries.filter((entry) => !toDrop.has(entry));
  }

  ctx.sessions.touch(session);

  return ElectronNetworkTailOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    entries: selected,
    dropped: buffer.dropped,
    bufferSize: buffer.entries.length,
  });
};
