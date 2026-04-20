/**
 * Sprint 3 flow test — chains network_tail, wait_for_new_window, and
 * trace_start/stop with assertions on observable side effects.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = '/tmp/electron-mcp-sprint3-flow';

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
    const envelope = res.result as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    const text = envelope?.content?.[0]?.text ?? '';
    // MCP surfaces tool failures as result.isError=true with the error
    // payload embedded in content. Promote these to thrown errors so the
    // test author can `try/catch` a failing tool call uniformly.
    if (envelope?.isError) {
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string };
        throw new Error(`${tool} → ${parsed.message ?? text}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith(`${tool} → `)) throw err;
        throw new Error(`${tool} → ${text}`);
      }
    }
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
            clientInfo: { name: 'sprint3-flow', version: '0.0.1' },
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

interface DriverArgs {
  executable: string;
  execArgs: string[];
  env: Record<string, string>;
  userDataDir?: string;
}

function parseArgs(argv: string[]): DriverArgs {
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
  const out: DriverArgs = { executable, execArgs, env };
  if (userDataDir !== undefined) out.userDataDir = userDataDir;
  return out;
}

function check(label: string, cond: boolean, detail = ''): void {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  mkdirSync(OUT_DIR, { recursive: true });
  const tracePath = `${OUT_DIR}/trace.zip`;
  if (existsSync(tracePath)) unlinkSync(tracePath);

  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);

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
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="dashboard-root"]',
      state: 'visible',
      timeout: 10_000,
    });

    /* -------- 1. trace_start → tracingActive true -------- */
    const ts = (await client.call('electron_trace_start', {
      sessionId,
      title: 'sprint3-flow',
      sources: false,
    })) as { tracing: boolean };
    check('trace_start reports active', ts.tracing === true);

    /* -------- 2. Drive network activity by navigating modules -------- */
    for (const aria of ['Nodes', 'Chat', 'Bench', 'Presets', 'Dashboard']) {
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

    /* -------- 3. network_tail — filter for localhost (llama-server probes) -------- */
    const tailAll = (await client.call('electron_network_tail', {
      sessionId,
      limit: 200,
    })) as { entries: Array<{ method: string; url: string; status?: number }>; bufferSize: number };
    check(
      'network_tail captured requests during navigation',
      tailAll.entries.length > 0,
      `bufferSize=${tailAll.bufferSize}, returned=${tailAll.entries.length}`,
    );

    // Filter for anything over HTTP (tRPC, llama-server probe, HF cache checks).
    const tailHttp = (await client.call('electron_network_tail', {
      sessionId,
      limit: 50,
      urlPattern: '^https?://',
    })) as { entries: Array<{ method: string; url: string; status?: number }> };
    console.log(`[info] HTTP requests captured: ${tailHttp.entries.length}`);
    for (const e of tailHttp.entries.slice(-5)) {
      console.log(`   ${e.method} ${e.status ?? '-'} ${e.url.slice(0, 100)}`);
    }

    // onlyFailures filter shouldn't explode even when there are none.
    const failures = (await client.call('electron_network_tail', {
      sessionId,
      limit: 20,
      onlyFailures: true,
    })) as { entries: unknown[] };
    check('onlyFailures filter returns a list', Array.isArray(failures.entries));

    /* -------- 4. wait_for_new_window — open a popup via evaluate_renderer -------- */
    // Kick off the window-open inside a setTimeout so we register the waiter first.
    const newWinPromise = client
      .call(
        'electron_wait_for_new_window',
        { sessionId, timeout: 10_000 },
        15_000,
      )
      .catch((err: Error) => ({ error: err.message }));
    // Tiny delay to let the waiter arm.
    await new Promise((r) => setTimeout(r, 100));
    await client.call('electron_evaluate_renderer', {
      sessionId,
      expression: 'window.open("about:blank", "_blank", "width=200,height=200")',
    });
    const newWin = (await newWinPromise) as {
      window?: { index: number; url: string; title: string };
      error?: string;
    };
    check(
      'wait_for_new_window resolved with popup',
      newWin.window !== undefined,
      newWin.error ? `err: ${newWin.error}` : `idx=${newWin.window?.index} url=${newWin.window?.url}`,
    );

    // Close the popup we just opened — keep the session tidy.
    if (newWin.window) {
      await client.call(
        'electron_evaluate_main',
        {
          sessionId,
          expression: `return app.windows().map(w => ({ id: w.id, url: w.webContents?.getURL?.() ?? '' }))`,
        },
        5_000,
      ).catch(() => null);
    }

    /* -------- 5. trace_stop → .zip written -------- */
    const tstop = (await client.call('electron_trace_stop', {
      sessionId,
      path: tracePath,
    })) as { path: string; byteLength: number };
    const exists = existsSync(tracePath);
    const size = exists ? statSync(tracePath).size : 0;
    check(
      'trace_stop wrote a non-empty .zip',
      exists && size > 10_000,
      `path=${tstop.path} bytes=${size}`,
    );

    /* -------- 6. trace_stop twice should error (not silently no-op) -------- */
    let secondStopErr: string | null = null;
    try {
      await client.call('electron_trace_stop', { sessionId, path: tracePath });
    } catch (err) {
      secondStopErr = (err as Error).message;
    }
    check(
      'trace_stop rejects when no trace is active',
      secondStopErr !== null && /not active/i.test(secondStopErr),
      secondStopErr ?? '<no error>',
    );

    await client.call('electron_close', { sessionId });
    console.log(process.exitCode === 1 ? 'FAIL — see above' : 'PASS — all flow checks green');
  } catch (err) {
    console.error('flow crashed:', err);
    process.exitCode = 1;
  } finally {
    client.kill();
  }
}

main();
