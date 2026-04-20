/**
 * Focused smoke test for the new env + userDataDir params on
 * electron_launch. Launches a target Electron app, verifies the echoed
 * userDataDir in the response, reads back the process env via
 * electron_evaluate_main (gated behind
 * ELECTRON_MCP_ALLOW_MAIN_EVALUATE=true), and asserts the tmp dir is
 * cleaned up after electron_close.
 *
 * Not wired into any CI — invoke manually:
 *   bun run tests/smoke-new-launch-params.ts \
 *     --executable=/path/to/app \
 *     --env=FOO_CANARY=hello \
 *     --userDataDir=/tmp/my-udd-smoke
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class McpClient {
  private seq = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  constructor(private readonly proc: ChildProcessByStdio<Writable, Readable, null>) {
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
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(t);
        res(r);
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
    else if (a.startsWith('--args='))
      execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
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

function parseEnvelope(res: JsonRpcResponse | null): unknown {
  if (!res) return null;
  const text = (res.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function check(label: string, cond: boolean, detail = ''): void {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');

  const procEnv: NodeJS.ProcessEnv = { ...process.env };
  procEnv.ELECTRON_MCP_LOG_LEVEL = procEnv.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  procEnv.ELECTRON_MCP_ALLOW_MAIN_EVALUATE = 'true';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env: procEnv, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);

  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-new-launch-params', version: '0.0.1' },
    });

    const launchArgs: Record<string, unknown> = {
      executablePath: args.executable,
      args: args.execArgs,
    };
    if (Object.keys(args.env).length > 0) launchArgs.env = args.env;
    if (args.userDataDir !== undefined) launchArgs.userDataDir = args.userDataDir;

    console.log(`[smoke] launch`, JSON.stringify(launchArgs, null, 2));
    const launched = await client.send(
      'tools/call',
      { name: 'electron_launch', arguments: launchArgs },
      60_000,
    );
    const env = parseEnvelope(launched) as {
      ok?: boolean;
      sessionId?: string;
      userDataDir?: string;
      autoTmp?: boolean;
      replacedLockedDir?: string;
    };
    console.log(`[smoke] launch response`, JSON.stringify(env, null, 2));

    const sessionId = env?.sessionId;
    if (!sessionId) {
      console.error('launch failed', env);
      return;
    }

    check('launch ok', env.ok === true);
    check('userDataDir echoed in response', typeof env.userDataDir === 'string');
    if (args.userDataDir) {
      check(
        'userDataDir matches caller-supplied path (no lock conflict)',
        env.userDataDir === args.userDataDir || env.replacedLockedDir === args.userDataDir,
        `echoed=${env.userDataDir ?? ''}`,
      );
      check('autoTmp reflects whether server minted a dir', typeof env.autoTmp === 'boolean');
    } else {
      check(
        'autoTmp=true when userDataDir omitted',
        env.autoTmp === true,
        `dir=${env.userDataDir ?? '?'}`,
      );
      check(
        'auto-tmp path under os.tmpdir prefix',
        (env.userDataDir ?? '').includes('electron-mcp-userdata-'),
      );
    }

    await client.send(
      'tools/call',
      { name: 'electron_wait_for_window', arguments: { sessionId, index: 0, timeoutMs: 30_000 } },
      35_000,
    );

    // Read back the main-process env to confirm our env keys made it.
    if (Object.keys(args.env).length > 0) {
      const firstKey = Object.keys(args.env)[0]!;
      const evalRes = await client.send(
        'tools/call',
        {
          name: 'electron_evaluate_main',
          arguments: {
            sessionId,
            expression: `return process.env[${JSON.stringify(firstKey)}] ?? null;`,
          },
        },
        10_000,
      );
      const evalEnv = parseEnvelope(evalRes) as { result?: string | null };
      check(
        `env key ${firstKey} reaches main process`,
        evalEnv?.result === args.env[firstKey],
        `expected=${args.env[firstKey] ?? ''} got=${String(evalEnv?.result)}`,
      );
    }

    const launchedUdd = env.userDataDir;
    const autoTmp = env.autoTmp === true;

    await client.send(
      'tools/call',
      { name: 'electron_close', arguments: { sessionId } },
      10_000,
    );

    if (autoTmp && launchedUdd) {
      check(
        'auto-tmp userDataDir cleaned up on close',
        !existsSync(launchedUdd),
        `dir=${launchedUdd}`,
      );
    }
    if (!autoTmp && launchedUdd) {
      check(
        'caller-supplied userDataDir preserved after close',
        existsSync(launchedUdd),
        `dir=${launchedUdd}`,
      );
    }
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
