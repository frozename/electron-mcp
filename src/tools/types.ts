import type { ElectronAdapter } from '../electron/electron-adapter.js';
import type { Logger } from '../logging/logger.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ServerConfig } from '../utils/config.js';

export interface ToolContext {
  config: ServerConfig;
  logger: Logger;
  sessions: SessionManager;
  adapter: ElectronAdapter;
}

export interface ToolHandler<Input, Output> {
  (input: Input, ctx: ToolContext): Promise<Output>;
}

/**
 * Adapt a synchronous tool body to the async `ToolHandler` contract. The body
 * runs synchronously, as it would inside an `async` function, and anything it
 * throws becomes a rejected promise rather than a synchronous throw.
 */
export function syncToolHandler<Input, Output>(
  body: (input: Input, ctx: ToolContext) => Output,
): ToolHandler<Input, Output> {
  return (input, ctx) => new Promise((resolve) => resolve(body(input, ctx)));
}
