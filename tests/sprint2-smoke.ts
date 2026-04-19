/**
 * Sprint 2 smoke: hover, press, select_option, dialog_policy.
 * Exercises each new tool once against the llamactl app and reports a
 * compact status line per check. Not hermetic — relies on the live app.
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

function parseArgs(argv: string[]): { executable: string; execArgs: string[] } {
  let executable: string | undefined;
  let execArgs: string[] = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith('--executable=')) executable = a.slice('--executable='.length);
    else if (a.startsWith('--args=')) execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
  }
  if (!executable) throw new Error('--executable required');
  return { executable, execArgs };
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

    const launched = await client.send(
      'tools/call',
      {
        name: 'electron_launch',
        arguments: { executablePath: args.executable, args: args.execArgs },
      },
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
