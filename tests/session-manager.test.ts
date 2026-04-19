import { describe, expect, test } from 'vitest';
import { SessionManager } from '../src/session/session-manager.js';
import { PermissionDeniedError, SessionNotFoundError } from '../src/errors/index.js';
import { createLogger } from '../src/logging/logger.js';

interface FakeApp {
  _handlers: Record<string, (() => void)[]>;
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  windows(): unknown[];
  close(): Promise<void>;
}

function fakeApp(): FakeApp {
  return {
    _handlers: {},
    on(event, fn) {
      this._handlers[event] ??= [];
      this._handlers[event].push(fn);
    },
    off(event, fn) {
      this._handlers[event] = (this._handlers[event] ?? []).filter((h: () => void) => h !== fn);
    },
    windows() {
      return [];
    },
    async close() {
      /* noop */
    },
  };
}

describe('SessionManager', () => {
  const logger = createLogger('error');

  test('registers and retrieves a session', () => {
    const sm = new SessionManager({ maxSessions: 2, logger });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sm.register({ app: fakeApp() as any, executablePath: '/x', args: [] });
    expect(sm.get(session.id)).toBe(session);
  });

  test('enforces max sessions cap', () => {
    const sm = new SessionManager({ maxSessions: 1, logger });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sm.register({ app: fakeApp() as any, executablePath: '/a', args: [] });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sm.register({ app: fakeApp() as any, executablePath: '/b', args: [] }),
    ).toThrow(PermissionDeniedError);
  });

  test('get throws on unknown session id', () => {
    const sm = new SessionManager({ maxSessions: 1, logger });
    expect(() => sm.get('nope')).toThrow(SessionNotFoundError);
  });

  test('list() returns a snapshot', () => {
    const sm = new SessionManager({ maxSessions: 3, logger });
    const s = sm.register({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: fakeApp() as any,
      executablePath: '/a',
      args: [],
      label: 'x',
    });
    const snaps = sm.list();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.sessionId).toBe(s.id);
    expect(snaps[0]?.label).toBe('x');
  });
});
