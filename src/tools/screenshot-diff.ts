/**
 * screenshot_diff — pixel regression via baseline compare.
 *
 * Captures the current window (optionally scoped by selector), compares it
 * against a caller-supplied baseline PNG using pixelmatch, and returns a
 * structured verdict. The baseline path is ALWAYS caller-supplied — we
 * never default to a shared location that could leak between sessions.
 *
 * `pixelmatch` and `pngjs` are imported lazily so the MCP server startup
 * cost stays unchanged for callers that never diff.
 */
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ScreenshotDiffInputSchema,
  ScreenshotDiffOutputSchema,
  type ScreenshotDiffInput,
  type ScreenshotDiffOutput,
} from '../schemas/index.js';
import { EvaluationError } from '../errors/index.js';

import type { ToolHandler } from './types.js';

async function mintTmpPngPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'electron-mcp-diff-'));
  return path.join(dir, 'current.png');
}

async function writeFileMkdir(target: string, data: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture either the full page or a locator's bounding box into a PNG and
 * write it to `targetPath`. Returns the captured bytes.
 */
async function captureScreenshot(
  ctx: Parameters<ToolHandler<ScreenshotDiffInput, ScreenshotDiffOutput>>[1],
  input: ScreenshotDiffInput,
  targetPath: string,
  timeoutMs: number,
): Promise<Buffer> {
  const session = ctx.sessions.get(input.sessionId);
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    if (input.selector) {
      const locator = page.locator(input.selector);
      const buffer = await locator.screenshot({
        path: targetPath,
        type: 'png',
        timeout: timeoutMs,
      });
      ctx.sessions.touch(session);
      return buffer;
    }
    const buffer = await page.screenshot({
      path: targetPath,
      type: 'png',
      fullPage: input.fullPage,
      timeout: timeoutMs,
    });
    ctx.sessions.touch(session);
    return buffer;
  } catch (err) {
    throw new EvaluationError(
      `screenshot_diff: capture failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export const electronScreenshotDiff: ToolHandler<
  ScreenshotDiffInput,
  ScreenshotDiffOutput
> = async (rawInput, ctx) => {
  const input = ScreenshotDiffInputSchema.parse(rawInput);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const currentPath = input.currentPath
    ? path.resolve(input.currentPath)
    : await mintTmpPngPath();

  const session = ctx.sessions.get(input.sessionId);

  // Capture first — useful regardless of whether we diff or seed a baseline.
  await captureScreenshot(ctx, input, currentPath, timeoutMs);

  const baselinePath = path.resolve(input.baselinePath);
  const baselinePresentBefore = await exists(baselinePath);

  // Seeding mode: overwrite / create the baseline from the current capture.
  if (input.updateBaseline) {
    const currentBytes = await fs.readFile(currentPath);
    await writeFileMkdir(baselinePath, currentBytes);
    return ScreenshotDiffOutputSchema.parse({
      ok: true,
      sessionId: session.id,
      baselineExists: false,
      diffPixels: 0,
      totalPixels: 0,
      diffRatio: 0,
      thresholdBreached: false,
      wroteBaseline: baselinePath,
      currentPath,
    } satisfies ScreenshotDiffOutput);
  }

  if (!baselinePresentBefore) {
    return ScreenshotDiffOutputSchema.parse({
      ok: false,
      sessionId: session.id,
      baselineExists: false,
      diffPixels: 0,
      totalPixels: 0,
      diffRatio: 0,
      thresholdBreached: false,
      currentPath,
      message:
        `Baseline not found at ${baselinePath}. Pass updateBaseline:true to seed it from the current view.`,
    } satisfies ScreenshotDiffOutput);
  }

  // Lazy-import pixelmatch + pngjs so the MCP server start-up stays cheap.
  const [{ default: pixelmatch }, { PNG }] = await Promise.all([
    import('pixelmatch'),
    import('pngjs'),
  ]);

  const [baselineBytes, currentBytes] = await Promise.all([
    fs.readFile(baselinePath),
    fs.readFile(currentPath),
  ]);

  const baselinePng = PNG.sync.read(baselineBytes);
  const currentPng = PNG.sync.read(currentBytes);

  const sizeMismatch =
    baselinePng.width !== currentPng.width || baselinePng.height !== currentPng.height;
  if (sizeMismatch) {
    return ScreenshotDiffOutputSchema.parse({
      ok: false,
      sessionId: session.id,
      baselineExists: true,
      diffPixels: 0,
      totalPixels: 0,
      diffRatio: 0,
      thresholdBreached: true,
      currentPath,
      message:
        `Dimension mismatch: baseline=${baselinePng.width}x${baselinePng.height}, ` +
        `current=${currentPng.width}x${currentPng.height}. ` +
        `Re-seed baseline with updateBaseline:true after confirming the new layout.`,
    } satisfies ScreenshotDiffOutput);
  }

  const width = baselinePng.width;
  const height = baselinePng.height;
  const totalPixels = width * height;

  const writeDiff = Boolean(input.diffPath);
  const diffPng = writeDiff ? new PNG({ width, height }) : null;

  // pixelmatch threshold is normalized 0..1 relative to max color distance.
  const normalizedThreshold = input.pixelThreshold / 255;

  const diffPixels = diffPng
    ? pixelmatch(baselinePng.data, currentPng.data, diffPng.data, width, height, {
        threshold: normalizedThreshold,
      })
    : pixelmatch(baselinePng.data, currentPng.data, undefined, width, height, {
        threshold: normalizedThreshold,
      });

  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const thresholdBreached = diffRatio > input.threshold;
  let wroteDiff: string | undefined;
  if (diffPng && diffPixels > 0 && input.diffPath) {
    const diffTarget = path.resolve(input.diffPath);
    await writeFileMkdir(diffTarget, PNG.sync.write(diffPng));
    wroteDiff = diffTarget;
  }

  return ScreenshotDiffOutputSchema.parse({
    ok: !thresholdBreached,
    sessionId: session.id,
    baselineExists: true,
    diffPixels,
    totalPixels,
    diffRatio,
    thresholdBreached,
    currentPath,
    ...(wroteDiff ? { wroteDiff } : {}),
  } satisfies ScreenshotDiffOutput);
};
