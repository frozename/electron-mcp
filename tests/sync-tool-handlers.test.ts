import { describe, expect, test } from 'vitest';
import { SessionNotFoundError } from '../src/errors/index.js';
import { createLogger } from '../src/logging/logger.js';
import { SessionManager } from '../src/session/session-manager.js';
import { electronConsoleTail } from '../src/tools/console.js';
import { electronDialogPolicy } from '../src/tools/dialogs.js';
import { electronNetworkTail } from '../src/tools/network.js';
import type { ToolContext, ToolHandler } from '../src/tools/types.js';

const logger = createLogger('error');

function fakeApp() {
  return {
    on() {},
    off() {},
    windows() {
      return [];
    },
    async close() {},
  };
}

function setup(): { ctx: ToolContext; sessionId: string } {
  const sessions = new SessionManager({ maxSessions: 2, logger });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = sessions.register({ app: fakeApp() as any, executablePath: '/x', args: [] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = { logger, sessions } as any as ToolContext;
  return { ctx, sessionId: session.id };
}

const handlers: [string, ToolHandler<unknown, unknown>, Record<string, unknown>][] = [
  ['electronConsoleTail', electronConsoleTail as ToolHandler<unknown, unknown>, {}],
  ['electronNetworkTail', electronNetworkTail as ToolHandler<unknown, unknown>, {}],
  [
    'electronDialogPolicy',
    electronDialogPolicy as ToolHandler<unknown, unknown>,
    { policy: 'dismiss' },
  ],
];

describe.each(handlers)('%s async contract', (_name, handler, extra) => {
  test('resolves with ok output for a known session', async () => {
    const { ctx, sessionId } = setup();
    const result = handler({ sessionId, ...extra }, ctx);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toMatchObject({ ok: true, sessionId });
  });

  test('rejects instead of throwing for an unknown session', async () => {
    const { ctx } = setup();
    let result: Promise<unknown> | undefined;
    expect(() => {
      result = handler({ sessionId: 'missing-session', ...extra }, ctx);
    }).not.toThrow();
    await expect(result).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  test('rejects instead of throwing for invalid input', async () => {
    const { ctx } = setup();
    let result: Promise<unknown> | undefined;
    expect(() => {
      result = handler({ sessionId: 42 }, ctx);
    }).not.toThrow();
    await expect(result).rejects.toThrow();
  });
});
