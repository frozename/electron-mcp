import type { LogLevel } from '../logging/logger.js';

export interface ServerConfig {
  logLevel: LogLevel;
  maxSessions: number;
  launchTimeoutMs: number;
  actionTimeoutMs: number;
  evaluateTimeoutMs: number;
  executableAllowlist: string[];
  allowMainEvaluate: boolean;
  screenshotDir: string;
  transport: 'stdio' | 'http';
  httpHost: string;
  httpPort: number;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseInt10(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const v = (value ?? 'info').toLowerCase() as LogLevel;
  return allowed.includes(v) ? v : 'info';
}

function parseAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseTransport(value: string | undefined): 'stdio' | 'http' {
  return value === 'http' ? 'http' : 'stdio';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    logLevel: parseLogLevel(env.ELECTRON_MCP_LOG_LEVEL),
    maxSessions: parseInt10(env.ELECTRON_MCP_MAX_SESSIONS, 5),
    launchTimeoutMs: parseInt10(env.ELECTRON_MCP_LAUNCH_TIMEOUT, 30_000),
    actionTimeoutMs: parseInt10(env.ELECTRON_MCP_ACTION_TIMEOUT, 15_000),
    evaluateTimeoutMs: parseInt10(env.ELECTRON_MCP_EVALUATE_TIMEOUT, 10_000),
    executableAllowlist: parseAllowlist(env.ELECTRON_MCP_EXECUTABLE_ALLOWLIST),
    allowMainEvaluate: parseBool(env.ELECTRON_MCP_ALLOW_MAIN_EVALUATE, false),
    screenshotDir: env.ELECTRON_MCP_SCREENSHOT_DIR ?? './screenshots',
    transport: parseTransport(env.ELECTRON_MCP_TRANSPORT),
    httpHost: env.ELECTRON_MCP_HTTP_HOST ?? '127.0.0.1',
    httpPort: parseInt10(env.ELECTRON_MCP_HTTP_PORT, 7337),
  };
}
