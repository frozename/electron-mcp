/**
 * Tests for `screenshot_diff` tool. The tool's only Playwright touchpoint
 * is `adapter.resolveWindow()` + `page.screenshot()` / `locator.screenshot()`.
 * We stub the adapter with a fake window whose `screenshot()` writes a
 * pre-built PNG to the requested path — this lets us exercise the full
 * pixelmatch path against real PNG data without spawning a browser.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import { electronScreenshotDiff } from '../src/tools/screenshot-diff.js';
import { SessionManager } from '../src/session/session-manager.js';
import { createLogger } from '../src/logging/logger.js';
import type { ServerConfig } from '../src/utils/config.js';
import type { ToolContext } from '../src/tools/types.js';
import type { Session } from '../src/session/types.js';

/** Build a solid-color PNG buffer of the given dimensions. */
function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

/** Build a near-solid PNG where 1 pixel differs from `base`. */
function almostSolidPng(
  width: number,
  height: number,
  base: [number, number, number, number],
  diffPixelCount: number,
): Buffer {
  const png = new PNG({ width, height });
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const idx = i << 2;
    const isDiff = i < diffPixelCount;
    png.data[idx] = isDiff ? 255 - base[0] : base[0];
    png.data[idx + 1] = isDiff ? 255 - base[1] : base[1];
    png.data[idx + 2] = isDiff ? 255 - base[2] : base[2];
    png.data[idx + 3] = base[3];
  }
  return PNG.sync.write(png);
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

interface AdapterStub {
  resolveWindow: (_app: unknown, _ref?: unknown) => Promise<FakePage>;
  __nextCapture: Buffer;
  __lastSelectorScreenshot?: string;
  __lastFullPage?: boolean;
}

interface FakePage {
  screenshot(opts: { path?: string; type?: string; fullPage?: boolean; timeout?: number }): Promise<Buffer>;
  locator(selector: string): FakeLocator;
}

interface FakeLocator {
  screenshot(opts: { path?: string; type?: string; timeout?: number }): Promise<Buffer>;
}

function buildStub(bytes: Buffer): AdapterStub {
  const stub: AdapterStub = {
    __nextCapture: bytes,
    async resolveWindow(_app, _ref) {
      const page: FakePage = {
        async screenshot(opts) {
          stub.__lastFullPage = opts.fullPage;
          if (opts.path) writeFileSync(opts.path, stub.__nextCapture);
          return stub.__nextCapture;
        },
        locator(selector: string) {
          stub.__lastSelectorScreenshot = selector;
          return {
            async screenshot(opts) {
              if (opts.path) writeFileSync(opts.path, stub.__nextCapture);
              return stub.__nextCapture;
            },
          };
        },
      };
      return page;
    },
  };
  return stub;
}

interface Ctx {
  ctx: ToolContext;
  sessions: SessionManager;
  adapter: AdapterStub;
  session: Session;
}

function makeCtx(capture: Buffer): Ctx {
  const logger = createLogger('error');
  const sessions = new SessionManager({ maxSessions: 3, logger });
  const adapter = buildStub(capture);
  const fakeApp = {
    on() {},
    off() {},
    windows() {
      return [];
    },
    async close() {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = sessions.register({ app: fakeApp as any, executablePath: '/x', args: [] });
  const ctx: ToolContext = {
    config: BASE_CONFIG,
    logger,
    sessions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: adapter as any,
  };
  return { ctx, sessions, adapter, session };
}

const trashDirs: string[] = [];
function mkTmpDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `sdiff-${label}-`));
  trashDirs.push(d);
  return d;
}
beforeEach(() => {
  while (trashDirs.length) {
    const d = trashDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('screenshot_diff', () => {
  test('updateBaseline=true seeds the baseline and returns ok:true', async () => {
    const captured = solidPng(10, 10, [255, 0, 0, 255]);
    const { ctx, session } = makeCtx(captured);
    const dir = mkTmpDir('seed');
    const baselinePath = join(dir, 'baseline.png');

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, updateBaseline: true } as any,
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.baselineExists).toBe(false); // before write
    expect(res.wroteBaseline).toBe(baselinePath);
    expect(existsSync(baselinePath)).toBe(true);
    expect(readFileSync(baselinePath).equals(captured)).toBe(true);
    trashDirs.push(dir);
  });

  test('missing baseline + updateBaseline=false returns ok:false + helpful message', async () => {
    const captured = solidPng(5, 5, [0, 255, 0, 255]);
    const { ctx, session } = makeCtx(captured);
    const dir = mkTmpDir('missing');
    const baselinePath = join(dir, 'baseline.png');

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath } as any,
      ctx,
    );

    expect(res.ok).toBe(false);
    expect(res.baselineExists).toBe(false);
    expect(res.thresholdBreached).toBe(false);
    expect(res.message).toMatch(/updateBaseline:true/);
    // The current capture is still written somewhere so the operator can inspect.
    expect(existsSync(res.currentPath)).toBe(true);
    trashDirs.push(dir);
  });

  test('identical baseline vs current → ok:true, diffPixels=0', async () => {
    const image = solidPng(8, 8, [128, 128, 128, 255]);
    const { ctx, session } = makeCtx(image);
    const dir = mkTmpDir('identical');
    const baselinePath = join(dir, 'baseline.png');
    writeFileSync(baselinePath, image);

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath } as any,
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.baselineExists).toBe(true);
    expect(res.diffPixels).toBe(0);
    expect(res.totalPixels).toBe(64);
    expect(res.diffRatio).toBe(0);
    expect(res.thresholdBreached).toBe(false);
    trashDirs.push(dir);
  });

  test('diff under threshold → ok:true, thresholdBreached=false', async () => {
    // 1 diff pixel in a 10x10 = 1%; default threshold is 1% (0.01).
    const baseline = solidPng(10, 10, [0, 0, 0, 255]);
    const current = almostSolidPng(10, 10, [0, 0, 0, 255], 1);
    const { ctx, session } = makeCtx(current);
    const dir = mkTmpDir('under');
    const baselinePath = join(dir, 'baseline.png');
    writeFileSync(baselinePath, baseline);

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, threshold: 0.02 } as any,
      ctx,
    );
    expect(res.diffPixels).toBeGreaterThan(0);
    expect(res.thresholdBreached).toBe(false);
    expect(res.ok).toBe(true);
    trashDirs.push(dir);
  });

  test('diff over threshold → ok:false, thresholdBreached=true + writes diff image', async () => {
    const baseline = solidPng(10, 10, [0, 0, 0, 255]);
    // 30 differing pixels in a 10x10 = 30% — vastly over the default 1%.
    const current = almostSolidPng(10, 10, [0, 0, 0, 255], 30);
    const { ctx, session } = makeCtx(current);
    const dir = mkTmpDir('over');
    const baselinePath = join(dir, 'baseline.png');
    const diffPath = join(dir, 'diff.png');
    writeFileSync(baselinePath, baseline);

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, diffPath } as any,
      ctx,
    );

    expect(res.ok).toBe(false);
    expect(res.thresholdBreached).toBe(true);
    expect(res.diffPixels).toBeGreaterThan(0);
    expect(res.wroteDiff).toBe(diffPath);
    expect(existsSync(diffPath)).toBe(true);
    trashDirs.push(dir);
  });

  test('dimension mismatch → ok:false with a descriptive message', async () => {
    const baseline = solidPng(10, 10, [0, 0, 0, 255]);
    const current = solidPng(12, 10, [0, 0, 0, 255]);
    const { ctx, session } = makeCtx(current);
    const dir = mkTmpDir('mismatch');
    const baselinePath = join(dir, 'baseline.png');
    writeFileSync(baselinePath, baseline);

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath } as any,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.thresholdBreached).toBe(true);
    expect(res.message).toMatch(/mismatch/i);
    trashDirs.push(dir);
  });

  test('selector present → uses locator.screenshot', async () => {
    const img = solidPng(6, 6, [10, 20, 30, 255]);
    const { ctx, session, adapter } = makeCtx(img);
    const dir = mkTmpDir('selector');
    const baselinePath = join(dir, 'baseline.png');
    writeFileSync(baselinePath, img);

    await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, selector: 'div.panel' } as any,
      ctx,
    );
    expect(adapter.__lastSelectorScreenshot).toBe('div.panel');
    trashDirs.push(dir);
  });

  test('no selector + fullPage:true → page.screenshot called with fullPage', async () => {
    const img = solidPng(4, 4, [5, 5, 5, 255]);
    const { ctx, session, adapter } = makeCtx(img);
    const dir = mkTmpDir('fullpage');
    const baselinePath = join(dir, 'baseline.png');
    writeFileSync(baselinePath, img);

    await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, fullPage: true } as any,
      ctx,
    );
    expect(adapter.__lastFullPage).toBe(true);
    trashDirs.push(dir);
  });

  test('currentPath honored when supplied', async () => {
    const img = solidPng(4, 4, [9, 9, 9, 255]);
    const { ctx, session } = makeCtx(img);
    const dir = mkTmpDir('currentpath');
    const baselinePath = join(dir, 'baseline.png');
    const currentPath = join(dir, 'current.png');
    writeFileSync(baselinePath, img);

    const res = await electronScreenshotDiff(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sessionId: session.id, baselinePath, currentPath } as any,
      ctx,
    );
    expect(res.currentPath).toBe(currentPath);
    expect(existsSync(currentPath)).toBe(true);
    trashDirs.push(dir);
  });
});
