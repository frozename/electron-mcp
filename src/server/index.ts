#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { initLogger } from '../logging/logger.js';
import { loadConfig } from '../utils/config.js';

import { createElectronMcpServer } from './mcp-server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initLogger(config.logLevel);

  logger.info('electron-mcp starting', {
    version: '0.1.0',
    transport: config.transport,
    node: process.version,
    maxSessions: config.maxSessions,
    allowMainEvaluate: config.allowMainEvaluate,
    allowlistEntries: config.executableAllowlist.length,
  });

  const { server, shutdown } = createElectronMcpServer(config, logger);

  if (config.transport !== 'stdio') {
    logger.error('transport not implemented', { transport: config.transport });
    process.exit(2);
  }

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const onExit = async (signal: string, code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('received shutdown signal', { signal });
    try {
      await shutdown();
    } finally {
      process.exit(code);
    }
  };

  process.on('SIGINT', () => {
    void onExit('SIGINT', 130);
  });
  process.on('SIGTERM', () => {
    void onExit('SIGTERM', 143);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal('uncaughtException', { error: err.message, stack: err.stack });
    void onExit('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal('unhandledRejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  try {
    await server.connect(transport);
    logger.info('electron-mcp ready', { transport: 'stdio' });
  } catch (err) {
    logger.fatal('failed to connect transport', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: 'fatal',
      msg: 'startup failed',
      error: err instanceof Error ? err.message : String(err),
    })}\n`,
  );
  process.exit(1);
});
