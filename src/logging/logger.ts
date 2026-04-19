/**
 * Structured logger emitting JSON to stderr.
 *
 * stderr is used intentionally because stdout is reserved for the MCP
 * transport when running in stdio mode. Every log line is a single
 * JSON object so downstream log processors can parse without regexes.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
  level: LogLevel;
}

class JsonLogger implements Logger {
  public level: LogLevel;
  private context: Record<string, unknown>;

  constructor(level: LogLevel, context: Record<string, unknown> = {}) {
    this.level = level;
    this.context = context;
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      msg,
      ...this.context,
      ...(fields ?? {}),
    };
    try {
      process.stderr.write(`${JSON.stringify(record)}\n`);
    } catch {
      // Never crash on a logging failure.
    }
  }

  trace(msg: string, fields?: Record<string, unknown>): void {
    this.emit('trace', msg, fields);
  }
  debug(msg: string, fields?: Record<string, unknown>): void {
    this.emit('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.emit('error', msg, fields);
  }
  fatal(msg: string, fields?: Record<string, unknown>): void {
    this.emit('fatal', msg, fields);
  }

  child(context: Record<string, unknown>): Logger {
    return new JsonLogger(this.level, { ...this.context, ...context });
  }
}

let rootLogger: Logger | null = null;

export function createLogger(level: LogLevel = 'info'): Logger {
  return new JsonLogger(level);
}

export function initLogger(level: LogLevel): Logger {
  rootLogger = new JsonLogger(level);
  return rootLogger;
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = createLogger('info');
  }
  return rootLogger;
}

/**
 * Helper: run an async function and log its duration with context.
 */
export async function withTiming<T>(
  logger: Logger,
  op: string,
  fn: () => Promise<T>,
  fields?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.debug(`${op} completed`, { ...fields, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    logger.error(`${op} failed`, {
      ...fields,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
