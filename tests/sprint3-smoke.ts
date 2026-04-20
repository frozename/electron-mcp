/**
 * Sprint 3 smoke: network_tail, trace_start/stop. wait_for_new_window is
 * covered by the type checker; the bundled CI fixture doesn't open
 * popups so there's nothing meaningful to wait for in this smoke.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = '/tmp/electron-mcp-sprint3';

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
  async call(tool: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.seq++;
    const res = await new Promise<JsonRpcResponse>((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectP(new Error(`timeout ${tool}`));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolveP(r);
      });
      this.proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }) + '\n',
      );
    });
    if (res.error) throw new Error(`${tool} → ${res.error.message}`);
    const text = (res.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  initialize(): Promise<JsonRpcResponse> {
    const id = this.seq++;
    return new Promise((resolveP) => {
      this.pending.set(id, (r) => resolveP(r));
      this.proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'sprint3-smoke', version: '0.0.1' },
          },
        }) + '\n',
      );
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
  const log = (msg: string): void => console.log(`[smoke3] ${msg}`);

  try {
    await client.initialize();
    const launchArgs: Record<string, unknown> = {
      executablePath: args.executable,
      args: args.execArgs,
    };
    if (Object.keys(args.env).length > 0) launchArgs.env = args.env;
    if (args.userDataDir !== undefined) launchArgs.userDataDir = args.userDataDir;
    const launch = (await client.call('electron_launch', launchArgs, 60_000)) as {
      sessionId?: string;
    };
    const sessionId = launch.sessionId;
    if (!sessionId) throw new Error('launch failed');

    await client.call('electron_wait_for_window', { sessionId, index: 0, timeoutMs: 30_000 });

    // Start tracing before we drive the app.
    log('trace_start');
    const ts = (await client.call('electron_trace_start', {
      sessionId,
      title: 'sprint3-smoke',
    })) as { tracing: boolean };
    log(`  tracing=${ts.tracing}`);

    // Trigger a few network requests by navigating between modules.
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="dashboard-root"]',
      state: 'visible',
      timeout: 10_000,
    });
    for (const aria of ['Nodes', 'Models', 'Cost']) {
      await client.call('electron_click', {
        sessionId,
        selector: `button[aria-label="${aria}"]`,
      });
      await client.call('electron_wait_for_selector', {
        sessionId,
        selector: `[data-testid="${aria.toLowerCase()}-root"]`,
        state: 'visible',
        timeout: 8_000,
      });
    }

    log('network_tail');
    const nt = (await client.call('electron_network_tail', {
      sessionId,
      limit: 20,
    })) as { entries: Array<{ method: string; url: string; status?: number }>; bufferSize: number };
    log(`  bufferSize=${nt.bufferSize}, returned=${nt.entries.length}`);
    for (const e of nt.entries.slice(-5)) {
      log(`    ${e.method} ${e.status ?? '-'} ${e.url.slice(0, 100)}`);
    }

    log('trace_stop');
    const tstop = (await client.call('electron_trace_stop', {
      sessionId,
      path: `${OUT_DIR}/trace.zip`,
    })) as { path: string; byteLength: number };
    log(`  wrote ${tstop.path} (${tstop.byteLength} bytes)`);

    await client.call('electron_close', { sessionId });
    log('done');
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('smoke3 crashed:', err);
  process.exit(1);
});
