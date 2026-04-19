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
