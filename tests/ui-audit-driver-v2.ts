/**
 * UI audit driver, v2 — uses the Sprint 1 MCP tools
 * (wait_for_selector, accessibility_snapshot, console_tail) instead of
 * the hand-rolled evaluate + sleep approach in v1. Tracks per-module
 * timings so we can diff against the original.
 *
 * The driver is library-generic: callers supply the module list via
 * `--modules=<path-to-json>` and an output directory via
 * `--out-dir=<path>` (default `/tmp/electron-mcp-ui-audit-v2`). The JSON
 * file is an array of `{ id, label }` entries; for each entry the driver
 * clicks `button[aria-label="<label>"]`, waits for
 * `[data-testid="<id>-root"]`, and records a screenshot + a11y summary.
 *
 * Optional pixel-regression gate: pass `--baselines=<dir>` to compare
 * each module's post-nav screenshot against
 * `<dir>/<module-id>.png` via the `screenshot_diff` MCP tool. Seed the
 * baselines once with `--updateBaselines`; subsequent runs fail-hard
 * (exit 1) when any module breaches the ratio/per-pixel threshold.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_OUT_DIR = '/tmp/electron-mcp-ui-audit-v2';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface Module {
  id: string;
  label: string;
}

export interface Options {
  executable: string;
  execArgs: string[];
  env: Record<string, string>;
  userDataDir?: string;
  modulesPath: string;
  outDir: string;
  baselinesDir?: string;
  updateBaselines: boolean;
  threshold: number;
  pixelThreshold: number;
  diffDir?: string;
}

const DEFAULT_THRESHOLD = 0.01;
const DEFAULT_PIXEL_THRESHOLD = 0;

/**
 * Load and validate the modules JSON file. Expects an array of
 * `{ id, label }` entries with non-empty string fields. Throws clearly
 * on any deviation so typos in the caller's config fail fast.
 */
export function loadModules(path: string): Module[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `failed to read --modules=${path}: ${(err as NodeJS.ErrnoException).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `failed to parse --modules=${path} as JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`--modules=${path} must contain a JSON array of { id, label } entries`);
  }
  const out: Module[] = [];
  parsed.forEach((entry, idx) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`--modules=${path}[${idx}] is not an object`);
    }
    const e = entry as { id?: unknown; label?: unknown };
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new Error(`--modules=${path}[${idx}].id must be a non-empty string`);
    }
    if (typeof e.label !== 'string' || e.label.length === 0) {
      throw new Error(`--modules=${path}[${idx}].label must be a non-empty string`);
    }
    out.push({ id: e.id, label: e.label });
  });
  if (out.length === 0) {
    throw new Error(`--modules=${path} contained an empty array (need at least one module)`);
  }
  return out;
}

function parseNumber(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} requires a finite number, got: ${raw}`);
  }
  return n;
}

export function parseArgs(argv: string[]): Options {
  let executable: string | undefined;
  let execArgs: string[] = [];
  const env: Record<string, string> = {};
  let userDataDir: string | undefined;
  let modulesPath: string | undefined;
  let outDir: string = DEFAULT_OUT_DIR;
  let baselinesDir: string | undefined;
  let updateBaselines = false;
  let threshold = DEFAULT_THRESHOLD;
  let pixelThreshold = DEFAULT_PIXEL_THRESHOLD;
  let diffDir: string | undefined;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--executable=')) executable = a.slice('--executable='.length);
    else if (a.startsWith('--args=')) execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
    else if (a.startsWith('--env=')) {
      const kv = a.slice('--env='.length);
      const eq = kv.indexOf('=');
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a.startsWith('--userDataDir=')) {
      userDataDir = a.slice('--userDataDir='.length);
    } else if (a.startsWith('--modules=')) {
      modulesPath = a.slice('--modules='.length);
    } else if (a.startsWith('--out-dir=')) {
      outDir = a.slice('--out-dir='.length);
    } else if (a.startsWith('--baselines=')) {
      baselinesDir = a.slice('--baselines='.length);
    } else if (a === '--updateBaselines') {
      updateBaselines = true;
    } else if (a.startsWith('--threshold=')) {
      threshold = parseNumber('--threshold', a.slice('--threshold='.length));
    } else if (a.startsWith('--pixelThreshold=')) {
      pixelThreshold = parseNumber('--pixelThreshold', a.slice('--pixelThreshold='.length));
    } else if (a.startsWith('--diffDir=')) {
      diffDir = a.slice('--diffDir='.length);
    }
  }
  if (!executable) throw new Error('--executable required');
  if (!modulesPath) {
    throw new Error(
      '--modules=<path-to-json> required; JSON must be an array of { id, label } entries',
    );
  }
  if (updateBaselines && !baselinesDir) {
    throw new Error('--updateBaselines requires --baselines=<dir>');
  }
  const out: Options = {
    executable,
    execArgs,
    env,
    modulesPath,
    outDir,
    updateBaselines,
    threshold,
    pixelThreshold,
  };
  if (userDataDir !== undefined) out.userDataDir = userDataDir;
  if (baselinesDir !== undefined) out.baselinesDir = baselinesDir;
  if (diffDir !== undefined) out.diffDir = diffDir;
  return out;
}

class McpClient {
  private seq = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>;
  constructor(proc: ChildProcessByStdio<Writable, Readable, null>) {
    this.proc = proc;
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const frame = JSON.parse(line) as JsonRpcResponse;
        const cb = this.pending.get(frame.id as number);
        if (cb) {
          this.pending.delete(frame.id as number);
          cb(frame);
        }
      } catch {
        /* skip */
      }
    });
  }
  send(method: string, params?: unknown, timeoutMs = 30_000): Promise<JsonRpcResponse> {
    const id = this.seq++;
    return new Promise((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectP(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolveP(res);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  kill(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

function parseEnvelope(res: JsonRpcResponse | null): unknown {
  if (!res) return null;
  const text = (res.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface A11yNode {
  role: string;
  name?: string;
  value?: string | number;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  children?: A11yNode[];
}

function walk(node: A11yNode | null | undefined, fn: (n: A11yNode) => void): void {
  if (!node) return;
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

function summarizeA11y(tree: A11yNode | null): {
  heading: string | null;
  buttons: Array<{ name: string; disabled: boolean | undefined }>;
  roles: Record<string, number>;
} {
  let heading: string | null = null;
  const buttons: Array<{ name: string; disabled: boolean | undefined }> = [];
  const roles: Record<string, number> = {};
  walk(tree, (n) => {
    roles[n.role] = (roles[n.role] ?? 0) + 1;
    if (!heading && (n.role === 'heading' || n.role === 'HeaderAsNonLandmark')) {
      heading = n.name ?? null;
    }
    if (n.role === 'button') {
      buttons.push({ name: n.name ?? '', disabled: n.disabled });
    }
  });
  return { heading, buttons, roles };
}

export interface DiffReport {
  moduleId: string;
  baselineExists: boolean;
  diffRatio: number;
  thresholdBreached: boolean;
  diffPixels: number;
  totalPixels: number;
  diffPath?: string;
  wroteBaseline?: string;
  currentPath?: string;
  message?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const modules = loadModules(args.modulesPath);
  mkdirSync(args.outDir, { recursive: true });
  // In update mode the baselines dir may not exist yet — that's the seed
  // case. In diff mode we intentionally DON'T create it so a missing dir
  // surfaces as explicit per-module "baseline missing" failures rather
  // than being silently auto-created and then always failing.
  if (args.updateBaselines && args.baselinesDir) {
    mkdirSync(args.baselinesDir, { recursive: true });
  }
  if (args.diffDir) {
    mkdirSync(args.diffDir, { recursive: true });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);
  const log = (msg: string): void => console.log(`[audit-v2] ${msg}`);

  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ui-audit-v2', version: '0.1.0' },
    });

    log(`launch ${args.executable}`);
    const launchArgs: Record<string, unknown> = {
      executablePath: args.executable,
      args: args.execArgs,
    };
    if (Object.keys(args.env).length > 0) launchArgs.env = args.env;
    if (args.userDataDir !== undefined) launchArgs.userDataDir = args.userDataDir;
    const launched = await client.send(
      'tools/call',
      { name: 'electron_launch', arguments: launchArgs },
      60_000,
    );
    const launchEnv = parseEnvelope(launched) as { ok?: boolean; sessionId?: string };
    const sessionId = launchEnv?.sessionId;
    if (!sessionId) {
      console.error('launch failed', launchEnv);
      return;
    }
    log(`session ${sessionId}`);

    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_window',
        arguments: { sessionId, index: 0, timeoutMs: 30_000 },
      },
      35_000,
    );

    // Safety + post-mortem wiring BEFORE first interaction so every
    // module's work is recorded.
    await client.send(
      'tools/call',
      { name: 'electron_dialog_policy', arguments: { sessionId, policy: 'auto' } },
      5_000,
    );
    await client.send(
      'tools/call',
      {
        name: 'electron_trace_start',
        arguments: { sessionId, title: 'ui-audit-v2', sources: false },
      },
      5_000,
    );

    // Wait for first-render instead of sleeping. Use the first module's
    // root selector as the "app is ready" signal — the module list is
    // caller-supplied, so there's no baked-in assumption about which
    // module lands first.
    const firstModule = modules[0]!;
    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_selector',
        arguments: {
          sessionId,
          selector: `[data-testid="${firstModule.id}-root"]`,
          state: 'visible',
          timeout: 10_000,
        },
      },
      12_000,
    );

    interface Result {
      module: string;
      label: string;
      clickOk: boolean;
      durationMs: number;
      heading: string | null;
      buttonCount: number;
      buttons: Array<{ name: string; disabled: boolean | undefined }>;
      roles: Record<string, number>;
      consoleDelta: number;
      networkDelta: number;
      screenshotPath: string;
    }
    const results: Result[] = [];
    const diffs: DiffReport[] = [];
    let priorConsoleSize = 0;
    let priorNetworkSize = 0;

    for (const mod of modules) {
      const start = Date.now();
      log(`→ ${mod.label}`);

      const clickRes = await client.send('tools/call', {
        name: 'electron_click',
        arguments: { sessionId, selector: `button[aria-label="${mod.label}"]` },
      });
      const clickOk =
        clickRes.error === undefined && (parseEnvelope(clickRes) as { ok?: boolean })?.ok !== false;

      const rootSelector = `[data-testid="${mod.id}-root"]`;
      await client.send(
        'tools/call',
        {
          name: 'electron_wait_for_selector',
          arguments: { sessionId, selector: rootSelector, state: 'visible', timeout: 8_000 },
        },
        10_000,
      );

      const a11y = await client.send(
        'tools/call',
        {
          name: 'electron_accessibility_snapshot',
          arguments: { sessionId, root: rootSelector, interestingOnly: true, timeout: 8_000 },
        },
        10_000,
      );
      const tree = (parseEnvelope(a11y) as { tree?: A11yNode | null })?.tree ?? null;
      const summary = summarizeA11y(tree);

      const screenshotPath = `${args.outDir}/${String(results.length + 1).padStart(2, '0')}-${mod.id}.png`;
      await client.send(
        'tools/call',
        {
          name: 'electron_screenshot',
          arguments: { sessionId, path: screenshotPath, fullPage: false },
        },
        10_000,
      );

      // Pixel-regression gate: caller opts in with --baselines=<dir>.
      // Preserve current behavior (no extra MCP calls) when the flag is
      // unset.
      if (args.baselinesDir) {
        const baselinePath = join(args.baselinesDir, `${mod.id}.png`);
        const diffPath = args.diffDir ? join(args.diffDir, `${mod.id}.png`) : undefined;
        const diffArgs: Record<string, unknown> = {
          sessionId,
          baselinePath,
          updateBaseline: args.updateBaselines,
          threshold: args.threshold,
          pixelThreshold: args.pixelThreshold,
        };
        if (diffPath !== undefined) diffArgs.diffPath = diffPath;
        const diffRes = await client.send(
          'tools/call',
          { name: 'screenshot_diff', arguments: diffArgs },
          30_000,
        );
        const diffEnv = parseEnvelope(diffRes) as {
          ok?: boolean;
          baselineExists?: boolean;
          diffPixels?: number;
          totalPixels?: number;
          diffRatio?: number;
          thresholdBreached?: boolean;
          wroteBaseline?: string;
          wroteDiff?: string;
          currentPath?: string;
          message?: string;
        } | null;
        const entry: DiffReport = {
          moduleId: mod.id,
          baselineExists: diffEnv?.baselineExists === true,
          diffRatio: diffEnv?.diffRatio ?? 0,
          thresholdBreached: diffEnv?.thresholdBreached === true,
          diffPixels: diffEnv?.diffPixels ?? 0,
          totalPixels: diffEnv?.totalPixels ?? 0,
        };
        if (diffEnv?.wroteDiff !== undefined) entry.diffPath = diffEnv.wroteDiff;
        if (diffEnv?.wroteBaseline !== undefined) entry.wroteBaseline = diffEnv.wroteBaseline;
        if (diffEnv?.currentPath !== undefined) entry.currentPath = diffEnv.currentPath;
        if (diffEnv?.message !== undefined) entry.message = diffEnv.message;
        diffs.push(entry);
      }

      // Capture per-module deltas for the two ring buffers so flaky
      // behavior (unexpected request spike, console error) is pinned to
      // the module that triggered it.
      const cRes = await client.send(
        'tools/call',
        { name: 'electron_console_tail', arguments: { sessionId, limit: 1 } },
        5_000,
      );
      const cSize =
        (parseEnvelope(cRes) as { bufferSize?: number })?.bufferSize ?? priorConsoleSize;
      const consoleDelta = Math.max(0, cSize - priorConsoleSize);
      priorConsoleSize = cSize;

      const nRes = await client.send(
        'tools/call',
        { name: 'electron_network_tail', arguments: { sessionId, limit: 1 } },
        5_000,
      );
      const nSize =
        (parseEnvelope(nRes) as { bufferSize?: number })?.bufferSize ?? priorNetworkSize;
      const networkDelta = Math.max(0, nSize - priorNetworkSize);
      priorNetworkSize = nSize;

      results.push({
        module: mod.id,
        label: mod.label,
        clickOk,
        durationMs: Date.now() - start,
        heading: summary.heading,
        buttonCount: summary.buttons.length,
        buttons: summary.buttons,
        roles: summary.roles,
        consoleDelta,
        networkDelta,
        screenshotPath,
      });
    }

    // Drain console + network ring buffers into the final report so
    // everything is one JSON file per run.
    const tail = await client.send(
      'tools/call',
      { name: 'electron_console_tail', arguments: { sessionId, limit: 200, drain: true } },
      10_000,
    );
    const tailEnv = parseEnvelope(tail) as { entries?: unknown[]; bufferSize?: number; dropped?: number };

    const netAll = await client.send(
      'tools/call',
      { name: 'electron_network_tail', arguments: { sessionId, limit: 500, drain: true } },
      10_000,
    );
    const netEnv = parseEnvelope(netAll) as {
      entries?: Array<{ method: string; url: string; status?: number; resourceType?: string }>;
      dropped?: number;
    };
    const netEntries = netEnv?.entries ?? [];
    const byStatus = netEntries.reduce<Record<string, number>>((acc, e) => {
      const key = e.status !== undefined ? String(e.status) : 'pending';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const byResource = netEntries.reduce<Record<string, number>>((acc, e) => {
      const key = e.resourceType ?? 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const failures = netEntries.filter(
      (e) => (e.status !== undefined && e.status >= 400),
    );

    // Stop tracing LAST so the trace captures every navigation and the
    // ring-buffer drains. Writes a .zip that can be replayed in
    // `playwright show-trace`.
    const tracePath = `${args.outDir}/trace.zip`;
    const traceRes = await client.send(
      'tools/call',
      { name: 'electron_trace_stop', arguments: { sessionId, path: tracePath } },
      30_000,
    );
    const traceEnv = parseEnvelope(traceRes) as { path?: string; byteLength?: number };

    const diffsTotalBreached = diffs.filter((d) => d.thresholdBreached).length;

    writeFileSync(
      `${args.outDir}/report.json`,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          executable: args.executable,
          driver: 'v2-sprint1+3',
          modulesTested: results.length,
          totalMs: results.reduce((a, r) => a + r.durationMs, 0),
          trace: {
            path: traceEnv?.path ?? tracePath,
            byteLength: traceEnv?.byteLength ?? 0,
          },
          network: {
            total: netEntries.length,
            dropped: netEnv?.dropped ?? 0,
            byStatus,
            byResource,
            failureCount: failures.length,
            failures: failures.slice(0, 20),
          },
          console: {
            dropped: tailEnv?.dropped ?? 0,
            count: (tailEnv?.entries ?? []).length,
            entries: tailEnv?.entries ?? [],
          },
          summary: {
            diffsTotalBreached,
            updateBaselines: args.updateBaselines,
          },
          diffs,
          results,
        },
        null,
        2,
      ),
    );
    log(`wrote ${args.outDir}/report.json + trace.zip (${traceEnv?.byteLength ?? 0} bytes)`);

    await client.send('tools/call', { name: 'electron_close', arguments: { sessionId } }, 10_000);

    // Exit-code contract (see file header):
    //   0 — all modules passed diff, OR update mode, OR no --baselines
    //   1 — at least one module breached (diff mode only)
    //   2 — driver error; handled by the `main().catch` below
    if (!args.updateBaselines && args.baselinesDir && diffsTotalBreached > 0) {
      log(`diff gate FAILED: ${diffsTotalBreached} module(s) breached threshold`);
      process.exitCode = 1;
    }
  } finally {
    client.kill();
  }
}

// Only run when invoked directly (e.g. `tsx tests/ui-audit-driver-v2.ts`).
// Guards against tests importing this module purely for `parseArgs`.
const invokedDirectly = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error('audit v2 crashed:', err);
    process.exit(2);
  });
}
