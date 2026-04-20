/**
 * Tool-level tests for electron_launch's new userDataDir + env behavior.
 * Stubs the ElectronAdapter so we can assert on what gets passed to the
 * underlying Playwright call without actually spawning a browser.
 */
import { describe, expect, test, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronLaunch } from '../src/tools/lifecycle.js';
import { SessionManager } from '../src/session/session-manager.js';
import { createLogger } from '../src/logging/logger.js';
import type { ServerConfig } from '../src/utils/config.js';
import type { LaunchParams } from '../src/electron/electron-adapter.js';
import type { ToolContext } from '../src/tools/types.js';

interface FakeApp {
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  windows(): unknown[];
  close(): Promise<void>;
}

function fakeApp(): FakeApp {
  return {
    on() {},
    off() {},
    windows() {
      return [];
    },
    async close() {},
  };
}

interface AdapterStub {
  launch(params: LaunchParams): Promise<FakeApp>;
  lastParams?: LaunchParams;
}

function adapterStub(): AdapterStub {
  const stub: AdapterStub = {
    async launch(params: LaunchParams): Promise<FakeApp> {
      stub.lastParams = params;
      return fakeApp();
    },
  };
  return stub;
}

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

function makeCtx(): { ctx: ToolContext; adapter: AdapterStub; sessions: SessionManager } {
  const logger = createLogger('error');
  const sessions = new SessionManager({ maxSessions: 3, logger });
  const adapter = adapterStub();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: ToolContext = { config: BASE_CONFIG, logger, sessions, adapter: adapter as any };
  return { ctx, adapter, sessions };
}

const created = new Set<string>();
function track(dir: string): string {
  created.add(dir);
  return dir;
}
afterEach(() => {
  for (const d of created) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  created.clear();
});

describe('electronLaunch — userDataDir + env', () => {
  test('no userDataDir → mints tmp + autoTmp=true, passes to adapter', async () => {
    const { ctx, adapter, sessions } = makeCtx();
    const res = await electronLaunch({ executablePath: '/x', args: [] } as never, ctx);

    expect(res.autoTmp).toBe(true);
    expect(res.userDataDir).toContain('electron-mcp-userdata-');
    expect(res.replacedLockedDir).toBeUndefined();
    expect(adapter.lastParams?.userDataDir).toBe(res.userDataDir);
    track(res.userDataDir);

    // Session tracks auto-tmp so close can clean up.
    const session = sessions.get(res.sessionId);
    expect(session.autoTmpUserDataDir).toBe(true);
    expect(session.userDataDir).toBe(res.userDataDir);
  });

  test('explicit userDataDir → passed through, autoTmp=false', async () => {
    const base = track(mkdtempSync(join(tmpdir(), 'udd-life-')));
    const { ctx, adapter } = makeCtx();
    const res = await electronLaunch(
      { executablePath: '/x', args: [], userDataDir: base } as never,
      ctx,
    );

    expect(res.userDataDir).toBe(base);
    expect(res.autoTmp).toBe(false);
    expect(res.replacedLockedDir).toBeUndefined();
    expect(adapter.lastParams?.userDataDir).toBe(base);
  });

  test('env flows into adapter.launch params unchanged', async () => {
    const { ctx, adapter } = makeCtx();
    const env = { FOO: 'bar', HELLO: 'world' };
    const res = await electronLaunch(
      { executablePath: '/x', args: [], env } as never,
      ctx,
    );
    track(res.userDataDir);

    expect(adapter.lastParams?.env).toEqual(env);
    // The handler must not mutate the caller's env object.
    expect(env).toEqual({ FOO: 'bar', HELLO: 'world' });
  });

  test('lock-conflict (alive pid) → auto-tmp + replacedLockedDir echoed', async () => {
    const base = track(mkdtempSync(join(tmpdir(), 'udd-conflict-')));
    symlinkSync(`${hostname()}-${process.pid}`, join(base, 'SingletonLock'));

    const { ctx, adapter } = makeCtx();
    const res = await electronLaunch(
      { executablePath: '/x', args: [], userDataDir: base } as never,
      ctx,
    );
    track(res.userDataDir);

    expect(res.autoTmp).toBe(true);
    expect(res.replacedLockedDir).toBe(base);
    expect(res.userDataDir).not.toBe(base);
    expect(res.userDataDir).toContain('electron-mcp-userdata-');
    expect(adapter.lastParams?.userDataDir).toBe(res.userDataDir);
  });

  test('lock-conflict + strictUserDataDir=true → throws LaunchError', async () => {
    const base = track(mkdtempSync(join(tmpdir(), 'udd-strict-')));
    symlinkSync(`${hostname()}-${process.pid}`, join(base, 'SingletonLock'));

    const { ctx } = makeCtx();
    await expect(
      electronLaunch(
        {
          executablePath: '/x',
          args: [],
          userDataDir: base,
          strictUserDataDir: true,
        } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'launch_error' });
  });

  test('auto-tmp dir is cleaned up when session is removed', async () => {
    const { ctx, sessions } = makeCtx();
    const res = await electronLaunch({ executablePath: '/x', args: [] } as never, ctx);
    const tmpPath = res.userDataDir;
    expect(existsSync(tmpPath)).toBe(true);

    sessions.remove(res.sessionId);
    expect(existsSync(tmpPath)).toBe(false);
  });

  test('caller-supplied dir is NOT cleaned up on remove', async () => {
    const base = track(mkdtempSync(join(tmpdir(), 'udd-keep-')));
    const { ctx, sessions } = makeCtx();
    const res = await electronLaunch(
      { executablePath: '/x', args: [], userDataDir: base } as never,
      ctx,
    );

    sessions.remove(res.sessionId);
    expect(existsSync(base)).toBe(true);
  });
});
