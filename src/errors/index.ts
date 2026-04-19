/**
 * Structured error categories surfaced to MCP clients.
 *
 * Every error raised by a tool handler is normalized into one of these
 * categories. Agents can dispatch on `code` without parsing human-readable
 * messages.
 */
export type ErrorCode =
  | 'validation_error'
  | 'launch_error'
  | 'session_not_found'
  | 'window_not_found'
  | 'selector_error'
  | 'timeout'
  | 'evaluation_error'
  | 'permission_denied'
  | 'internal_error';

export interface SerializedError {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class ElectronMcpError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ElectronMcpError';
    this.code = code;
    this.details = details;
  }

  toJSON(): SerializedError {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class ValidationError extends ElectronMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('validation_error', message, details);
    this.name = 'ValidationError';
  }
}

export class LaunchError extends ElectronMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('launch_error', message, details);
    this.name = 'LaunchError';
  }
}

export class SessionNotFoundError extends ElectronMcpError {
  constructor(sessionId: string) {
    super('session_not_found', `No active session with id: ${sessionId}`, { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

export class WindowNotFoundError extends ElectronMcpError {
  constructor(windowRef: string | number, sessionId?: string) {
    super('window_not_found', `No window matching: ${String(windowRef)}`, {
      windowRef,
      sessionId,
    });
    this.name = 'WindowNotFoundError';
  }
}

export class SelectorError extends ElectronMcpError {
  constructor(selector: string, cause?: string) {
    super('selector_error', `Selector failed: ${selector}${cause ? ` (${cause})` : ''}`, {
      selector,
      cause,
    });
    this.name = 'SelectorError';
  }
}

export class TimeoutError extends ElectronMcpError {
  constructor(operation: string, timeoutMs: number) {
    super('timeout', `Operation timed out after ${timeoutMs}ms: ${operation}`, {
      operation,
      timeoutMs,
    });
    this.name = 'TimeoutError';
  }
}

export class EvaluationError extends ElectronMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('evaluation_error', message, details);
    this.name = 'EvaluationError';
  }
}

export class PermissionDeniedError extends ElectronMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('permission_denied', message, details);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Normalize any thrown value into an ElectronMcpError. Unknown errors
 * become `internal_error` so the client always receives a structured payload.
 */
export function normalizeError(err: unknown): ElectronMcpError {
  if (err instanceof ElectronMcpError) {
    return err;
  }
  if (err instanceof Error) {
    const message = err.message || 'Unknown error';
    if (/timeout/i.test(message)) {
      return new TimeoutError(err.name || 'operation', 0);
    }
    return new ElectronMcpError('internal_error', message, {
      name: err.name,
      stack: err.stack,
    });
  }
  return new ElectronMcpError('internal_error', String(err));
}
