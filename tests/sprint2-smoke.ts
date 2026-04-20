/**
 * Sprint 2 smoke: hover, press, select_option, dialog_policy.
 * Exercises each new tool once against a target Electron app and reports
 * a compact status line per check. Runs against the bundled CI fixture
 * (`tests/fixtures/ci-app/`) which exposes `dashboard-root` + `presets-root`
 * with a `<select>` inside Presets.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = '/tmp/electron-mcp-sprint2';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
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

interface SmokeArgs {
  executable: string;
  execArgs: string[];
  env: Record<string, string>;
  userDataDir?: string;
}

function parseArgs(argv: string[]): SmokeArgs {
  let executable: string | undefined;
  let execArgs: string[] = [];
  const env: Record<string, string> = {};
  let userDataDir: string | undefined;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--executable=')) executable = a.slice('--executable='.length);
    else if (a.startsWith('--args=')) execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
    else if (a.startsWith('--env=')) {
      const kv = a.slice('--env='.length);
      const eq = kv.indexOf('=');
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a.startsWith('--userDataDir=')) {
      userDataDir = a.slice('--userDataDir='.length);
    }
  }
  if (!executable) throw new Error('--executable required');
  const out: SmokeArgs = { executable, execArgs, env };
  if (userDataDir !== undefined) out.userDataDir = userDataDir;
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  mkdirSync(OUT_DIR, { recursive: true });
  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);
  const log = (msg: string): void => console.log(`[smoke2] ${msg}`);

  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'sprint2-smoke', version: '0.0.1' },
    });

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
      { name: 'electron_wait_for_window', arguments: { sessionId, index: 0, timeoutMs: 30_000 } },
      35_000,
    );
    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_selector',
        arguments: {
          sessionId,
          selector: '[data-testid="dashboard-root"]',
          state: 'visible',
          timeout: 10_000,
        },
      },
      15_000,
    );

    // 1) dialog_policy
    log('dialog_policy → auto');
    const dp = await client.send(
      'tools/call',
      { name: 'electron_dialog_policy', arguments: { sessionId, policy: 'auto' } },
      5_000,
    );
    log('→ ' + JSON.stringify(parseEnvelope(dp)));

    // 2) hover — first activity-bar button should surface a tooltip/title
    log('hover → first activity bar button');
    const hov = await client.send(
      'tools/call',
      {
        name: 'electron_hover',
        arguments: { sessionId, selector: 'button[aria-label="Dashboard"]', timeout: 5_000 },
      },
      8_000,
    );
    log('→ ' + JSON.stringify(parseEnvelope(hov)));

    // 3) press — Escape (safe no-op for most views) then Tab.
    log('press → Escape');
    const p1 = await client.send(
      'tools/call',
      { name: 'electron_press', arguments: { sessionId, key: 'Escape' } },
      5_000,
    );
    log('→ ' + JSON.stringify(parseEnvelope(p1)));
    log('press → Tab');
    const p2 = await client.send(
      'tools/call',
      { name: 'electron_press', arguments: { sessionId, key: 'Tab' } },
      5_000,
    );
    log('→ ' + JSON.stringify(parseEnvelope(p2)));

    // 4) select_option — nav to Presets (has a "class" filter <select>) then pick by value.
    log('click Presets');
    await client.send(
      'tools/call',
      { name: 'electron_click', arguments: { sessionId, selector: 'button[aria-label="Presets"]' } },
      8_000,
    );
    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_selector',
        arguments: {
          sessionId,
          selector: '[data-testid="presets-root"]',
          state: 'visible',
          timeout: 8_000,
        },
      },
      10_000,
    );
    log('select_option → class=reasoning');
    const sel = await client.send(
      'tools/call',
      {
        name: 'electron_select_option',
        arguments: {
          sessionId,
          // The class filter <select> — first (and only) <select> on the Presets page.
          selector: '[data-testid="presets-root"] select',
          value: 'reasoning',
          timeout: 5_000,
        },
      },
      8_000,
    );
    log('→ ' + JSON.stringify(parseEnvelope(sel)));

    await client.send('tools/call', { name: 'electron_close', arguments: { sessionId } }, 10_000);
    log('done');
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('smoke2 crashed:', err);
  process.exit(1);
});
