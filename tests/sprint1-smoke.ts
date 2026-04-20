/**
 * Smoke test for the Sprint 1 tools: wait_for_selector, accessibility_snapshot,
 * console_tail. Launches a target Electron app via MCP, exercises each tool
 * once, prints a compact report, closes the session.
 *
 * Runs against the bundled CI fixture (`tests/fixtures/ci-app/`) which
 * exposes `[data-testid="dashboard-root"]`; point `--executable` +
 * `--args` at your own Electron app if it matches the same conventions.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = '/tmp/electron-mcp-sprint1';

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
        // skip
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
  const log = (msg: string): void => console.log(`[smoke] ${msg}`);

  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'sprint1-smoke', version: '0.0.1' },
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

    await client.send(
      'tools/call',
      { name: 'electron_wait_for_window', arguments: { sessionId, index: 0, timeoutMs: 30_000 } },
      35_000,
    );

    // 1) wait_for_selector — should succeed fast since the dashboard renders immediately.
    log('wait_for_selector [data-testid="dashboard-root"]');
    const waitRes = await client.send(
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
    log('→ ' + JSON.stringify(parseEnvelope(waitRes)));

    // 2) accessibility_snapshot — root-scoped to activity bar.
    log('accessibility_snapshot (root="nav")');
    const a11y = await client.send(
      'tools/call',
      {
        name: 'electron_accessibility_snapshot',
        arguments: { sessionId, root: 'nav', interestingOnly: true, timeout: 10_000 },
      },
      15_000,
    );
    const a11yEnv = parseEnvelope(a11y) as { tree?: unknown };
    log('→ a11y tree sample: ' + JSON.stringify(a11yEnv?.tree).slice(0, 260));

    // 3) console_tail — dashboard loads with some tRPC chatter; 5 entries are plenty.
    log('console_tail limit=5');
    const tail = await client.send(
      'tools/call',
      { name: 'electron_console_tail', arguments: { sessionId, limit: 5 } },
      10_000,
    );
    const tailEnv = parseEnvelope(tail) as { entries?: unknown[]; bufferSize?: number };
    log(`→ bufferSize=${tailEnv?.bufferSize ?? '?'}, returned=${(tailEnv?.entries ?? []).length}`);

    await client.send('tools/call', { name: 'electron_close', arguments: { sessionId } }, 10_000);
    log('done');
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
