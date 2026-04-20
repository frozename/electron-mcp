import {
  ElectronCloseInputSchema,
  ElectronLaunchInputSchema,
  ElectronListSessionsOutputSchema,
  ElectronRestartInputSchema,
  type ElectronCloseInput,
  type ElectronCloseOutput,
  type ElectronLaunchInput,
  type ElectronLaunchOutput,
  type ElectronListSessionsOutput,
  type ElectronRestartInput,
} from '../schemas/index.js';
import { LaunchError, normalizeError } from '../errors/index.js';
import {
  cleanupUserDataDir,
  redactEnvForLog,
  resolveUserDataDir,
} from '../utils/user-data-dir.js';

import type { ToolContext, ToolHandler } from './types.js';

export const electronLaunch: ToolHandler<ElectronLaunchInput, ElectronLaunchOutput> = async (
  rawInput,
  ctx,
) => {
  const input = ElectronLaunchInputSchema.parse(rawInput);
  const logger = ctx.logger.child({ tool: 'electron_launch' });

  // Resolve userDataDir BEFORE launching so we can fail fast on a locked
  // dir in strict mode + surface auto-tmp behavior in the response.
  let resolved;
  try {
    resolved = resolveUserDataDir({
      ...(input.userDataDir !== undefined ? { userDataDir: input.userDataDir } : {}),
      strict: input.strictUserDataDir,
    });
  } catch (err) {
    // SingletonLock + strict mode — map to launch_error so agents see a
    // categorized error code rather than internal_error.
    throw new LaunchError(err instanceof Error ? err.message : String(err), {
      ...(input.userDataDir !== undefined ? { userDataDir: input.userDataDir } : {}),
    });
  }

  logger.info('launching electron app', {
    executablePath: input.executablePath,
    label: input.label,
    userDataDir: resolved.dir,
    autoTmp: resolved.autoTmp,
    ...(resolved.replacedLockedDir ? { replacedLockedDir: resolved.replacedLockedDir } : {}),
    // Secret-shaped keys are redacted; we never log raw values.
    ...(input.env ? { env: redactEnvForLog(input.env) } : {}),
  });

  const timeoutMs = input.timeout ?? ctx.config.launchTimeoutMs;

  const launchParams: Parameters<typeof ctx.adapter.launch>[0] = {
    executablePath: input.executablePath,
    args: input.args,
    userDataDir: resolved.dir,
    timeoutMs,
  };
  if (input.cwd) launchParams.cwd = input.cwd;
  if (input.env) launchParams.env = input.env;
  if (input.recordVideoDir) launchParams.recordVideoDir = input.recordVideoDir;
  if (input.colorScheme) launchParams.colorScheme = input.colorScheme;

  let app;
  try {
    app = await ctx.adapter.launch(launchParams);
  } catch (err) {
    // Launch failed — if WE minted the tmp dir, it's our mess to clean up.
    if (resolved.autoTmp) cleanupUserDataDir(resolved.dir);
    throw err;
  }

  let session;
  try {
    const registerInput: Parameters<typeof ctx.sessions.register>[0] = {
      app,
      executablePath: input.executablePath,
      args: input.args,
      userDataDir: resolved.dir,
      autoTmpUserDataDir: resolved.autoTmp,
    };
    if (input.label !== undefined) registerInput.label = input.label;
    session = ctx.sessions.register(registerInput);
  } catch (err) {
    // If we can't register (e.g. cap reached), close the app we just launched.
    await app.close().catch(() => undefined);
    if (resolved.autoTmp) cleanupUserDataDir(resolved.dir);
    throw normalizeError(err);
  }

  return {
    ok: true,
    sessionId: session.id,
    ...(session.label !== undefined ? { label: session.label } : {}),
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    windowCount: session.lastKnownWindowCount,
    userDataDir: resolved.dir,
    autoTmp: resolved.autoTmp,
    ...(resolved.replacedLockedDir ? { replacedLockedDir: resolved.replacedLockedDir } : {}),
  };
};

export const electronClose: ToolHandler<ElectronCloseInput, ElectronCloseOutput> = async (
  rawInput,
  ctx,
) => {
  const input = ElectronCloseInputSchema.parse(rawInput);
  const logger = ctx.logger.child({ tool: 'electron_close', sessionId: input.sessionId });
  const session = ctx.sessions.get(input.sessionId);

  ctx.sessions.setStatus(session.id, 'closing');

  try {
    if (input.force) {
      await Promise.race([
        session.app.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      const proc = session.app.process?.();
      try {
        proc?.kill('SIGKILL');
      } catch {
        // already gone
      }
    } else {
      await session.app.close();
    }
  } catch (err) {
    logger.warn('close errored — treating as closed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    ctx.sessions.remove(input.sessionId);
  }

  return {
    ok: true,
    sessionId: input.sessionId,
    closed: true,
  };
};

export const electronRestart: ToolHandler<ElectronRestartInput, ElectronLaunchOutput> = async (
  rawInput,
  ctx,
) => {
  const input = ElectronRestartInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const logger = ctx.logger.child({ tool: 'electron_restart', sessionId: input.sessionId });

  logger.info('restarting session', { executablePath: session.executablePath });

  const originalArgs = [...session.args];
  const originalPath = session.executablePath;
  const originalLabel = session.label;

  try {
    await session.app.close();
  } catch (err) {
    logger.warn('close during restart errored', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  ctx.sessions.remove(input.sessionId);

  // Note: restarts always produce a fresh userDataDir resolution. If the
  // caller originally passed a dir, they should call electron_launch
  // directly with the same dir to re-use state. Auto-tmp sessions get a
  // brand-new tmp dir — that's the right hermetic default.
  const launchInput: ElectronLaunchInput = {
    executablePath: originalPath,
    args: originalArgs,
    strictUserDataDir: false,
    ...(originalLabel !== undefined ? { label: originalLabel } : {}),
    ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
  };
  return electronLaunch(launchInput, ctx);
};

export const electronListSessions: ToolHandler<void, ElectronListSessionsOutput> = (
  _input,
  ctx: ToolContext,
) => {
  const sessions = ctx.sessions.list();
  const output: ElectronListSessionsOutput = {
    ok: true,
    sessions,
  };
  return Promise.resolve(ElectronListSessionsOutputSchema.parse(output));
};
