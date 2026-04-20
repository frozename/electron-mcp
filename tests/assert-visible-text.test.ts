/**
 * Tests for `assert_visible_text`. The tool wraps Playwright's
 * `locator.waitFor({ state: 'visible', ... })` primitive, so the
 * important behaviors to cover are:
 *
 *  1. Success: locator resolves → ok:true + matchedText + locator path.
 *  2. Timeout: waitFor rejects → ok:false + nearestMatches populated.
 *  3. Regex mode: text treated as a RegExp.
 *  4. Invalid regex: returns ok:false with a helpful message.
 *  5. includeHidden: waits on `attached` instead of `visible`.
 *
 * To test without a real browser we pass a stub adapter whose
 * `resolveWindow` returns a fake Page/Locator tree — enough surface
 * area for the handler under test.
 */
import { describe, expect, test } from 'vitest';

import { electronAssertVisibleText } from '../src/tools/assert-visible-text.js';
import { SessionManager } from '../src/session/session-manager.js';
import { createLogger } from '../src/logging/logger.js';
import type { ServerConfig } from '../src/utils/config.js';
import type { ToolContext } from '../src/tools/types.js';

const BASE_CONFIG: ServerConfig = {
  logLevel: 'error',
  maxSessions: 3,
  launchTimeoutMs: 30_000,
  actionTimeoutMs: 15_000,
  evaluateTimeoutMs: 10_000,
  executableAllowlist: [],
  allowMainEvaluate: false,
  screenshotDir: './screenshots',
  transport: 'stdio',
  httpHost: '127.0.0.1',
  httpPort: 7337,
};

type WaitState = 'visible' | 'attached';

interface LocatorBehavior {
  /** If true, waitFor resolves. Otherwise it rejects with a timeout error. */
  found: boolean;
  textContent?: string;
  locatorPath?: string;
  /** Records the last state waitFor was called with. */
  lastWaitState?: WaitState;
}

interface FakeLocator {
  first(): FakeLocator;
  filter(opts: { hasText: string | RegExp }): FakeLocator;
  waitFor(opts: { state: WaitState; timeout: number }): Promise<void>;
  textContent(): Promise<string | null>;
  evaluate<T>(fn: (el: unknown) => T): Promise<T>;
  elementHandle(): Promise<null>;
  __behavior: LocatorBehavior;
  __lastFilter?: string | RegExp;
}

interface FakePage {
  getByText(matcher: string | RegExp): FakeLocator;
  locator(selector: string): FakeLocator;
  evaluate<T>(fn: (arg: unknown) => T, arg: unknown): Promise<T>;
  __candidates: Array<{ text: string; locator: string }>;
}

function buildLocator(behavior: LocatorBehavior): FakeLocator {
  const self: FakeLocator = {
    __behavior: behavior,
    first() {
      return self;
    },
    filter(opts) {
      self.__lastFilter = opts.hasText;
      return self;
    },
    async waitFor(opts) {
      behavior.lastWaitState = opts.state;
      if (behavior.found) {
        return;
      }
      // Simulate a small polling delay that respects timeout.
      await new Promise((resolve) => setTimeout(resolve, Math.min(opts.timeout, 5)));
      throw new Error(`Timeout ${opts.timeout}ms exceeded waiting for ${opts.state}`);
    },
    async textContent() {
      return behavior.textContent ?? null;
    },
    async evaluate<T>(_fn: (el: unknown) => T): Promise<T> {
      return (behavior.locatorPath ?? '') as unknown as T;
    },
    async elementHandle() {
      return null;
    },
  };
  return self;
}

function buildPage(
  behavior: LocatorBehavior,
  candidates: Array<{ text: string; locator: string }> = [],
): FakePage {
  const page: FakePage = {
    __candidates: candidates,
    getByText(_matcher) {
      return buildLocator(behavior);
    },
    locator(_selector) {
      return buildLocator(behavior);
    },
    async evaluate<T>(_fn: (arg: unknown) => T, _arg: unknown): Promise<T> {
      return candidates as unknown as T;
    },
  };
  return page;
}

interface Ctx {
  ctx: ToolContext;
  sessions: SessionManager;
  session: ReturnType<SessionManager['register']>;
  page: FakePage;
}

function makeCtx(
  behavior: LocatorBehavior,
  candidates: Array<{ text: string; locator: string }> = [],
): Ctx {
  const logger = createLogger('error');
  const sessions = new SessionManager({ maxSessions: 3, logger });
  const page = buildPage(behavior, candidates);
  const adapter = {
    async resolveWindow(_app: unknown, _ref?: unknown) {
      return page;
    },
  };
  const fakeApp = {
    on() {},
    off() {},
    windows() {
      return [];
    },
    async close() {},
  };
  const session = sessions.register({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app: fakeApp as any,
    executablePath: '/x',
    args: [],
  });
  const ctx: ToolContext = {
    config: BASE_CONFIG,
    logger,
    sessions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: adapter as any,
  };
  return { ctx, sessions, session, page };
}

describe('assert_visible_text', () => {
  test('text found → ok:true + matchedText + locator', async () => {
    const behavior: LocatorBehavior = {
      found: true,
      textContent: 'Uninstall',
      locatorPath: 'button#uninstall',
    };
    const { ctx, session } = makeCtx(behavior);

    const res = await electronAssertVisibleText(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, text: 'Uninstall' } as any,
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.matchedText).toBe('Uninstall');
    expect(res.locator).toBe('button#uninstall');
    expect(behavior.lastWaitState).toBe('visible');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('text missing → ok:false with nearestMatches', async () => {
    const behavior: LocatorBehavior = { found: false };
    const candidates = [
      { text: 'Uninstall now', locator: 'button' },
      { text: 'Update available', locator: 'span' },
      { text: 'Completely unrelated', locator: 'p' },
      { text: 'Another extra entry', locator: 'div' },
    ];
    const { ctx, session } = makeCtx(behavior, candidates);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: 'Uninstall',
        timeoutMs: 10,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );

    expect(res.ok).toBe(false);
    expect(res.nearestMatches).toBeDefined();
    expect(res.nearestMatches?.length).toBeLessThanOrEqual(3);
    expect(res.nearestMatches?.length).toBeGreaterThan(0);
    // First nearest should be the strongest match.
    expect(res.nearestMatches?.[0]?.text).toBe('Uninstall now');
    expect(res.message).toMatch(/within 10ms/);
    expect(behavior.lastWaitState).toBe('visible');
  });

  test('regex:true routes via RegExp matcher', async () => {
    const behavior: LocatorBehavior = {
      found: true,
      textContent: 'Uninstall extension',
      locatorPath: 'button',
    };
    const { ctx, session } = makeCtx(behavior);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: '^\\s*Uninstall',
        regex: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.matchedText).toBe('Uninstall extension');
  });

  test('regex:true with invalid regex → ok:false with helpful message', async () => {
    const behavior: LocatorBehavior = { found: true };
    const { ctx, session } = makeCtx(behavior);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: '[invalid(',
        regex: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Invalid regex/i);
  });

  test('includeHidden:true waits on attached state', async () => {
    const behavior: LocatorBehavior = {
      found: true,
      textContent: 'Hidden text',
      locatorPath: 'div',
    };
    const { ctx, session } = makeCtx(behavior);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: 'Hidden text',
        includeHidden: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(behavior.lastWaitState).toBe('attached');
  });

  test('selector scopes the locator and filters by hasText', async () => {
    const behavior: LocatorBehavior = {
      found: true,
      textContent: 'Uninstall',
      locatorPath: 'div.card > button',
    };
    const { ctx, session } = makeCtx(behavior);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: 'Uninstall',
        selector: 'div.card',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.locator).toBe('div.card > button');
  });

  test('includeHidden + missing text still returns nearestMatches', async () => {
    const behavior: LocatorBehavior = { found: false };
    const candidates = [
      { text: 'Uninstall', locator: 'button' },
      { text: 'Install', locator: 'button' },
    ];
    const { ctx, session } = makeCtx(behavior, candidates);

    const res = await electronAssertVisibleText(
      {
        sessionId: session.id,
        text: 'Uninstall',
        includeHidden: true,
        timeoutMs: 10,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/);
    expect(behavior.lastWaitState).toBe('attached');
    expect(res.nearestMatches?.[0]?.text).toBe('Uninstall');
  });
});
