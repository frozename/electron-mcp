import type { ElectronApplication } from 'playwright';

import { PermissionDeniedError, SessionNotFoundError } from '../errors/index.js';
import type { Logger } from '../logging/logger.js';
import { newSessionId } from '../utils/ids.js';
import { cleanupUserDataDir } from '../utils/user-data-dir.js';

import { createConsoleBuffer, instrumentSession } from './console-buffer.js';
import { createDialogState, instrumentSessionForDialogs } from './dialog-policy.js';
import { createNetworkBuffer, instrumentSessionForNetwork } from './network-buffer.js';
import type { Session, SessionSnapshot, SessionStatus } from './types.js';
import { serializeSession } from './types.js';

export interface SessionManagerOptions {
  maxSessions: number;
  logger: Logger;
}

export interface CreateSessionInput {
  app: ElectronApplication;
  executablePath: string;
  args: readonly string[];
  label?: string;
  userDataDir?: string;
  autoTmpUserDataDir?: boolean;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly maxSessions: number;
  private readonly logger: Logger;

  constructor(options: SessionManagerOptions) {
    this.maxSessions = options.maxSessions;
    this.logger = options.logger.child({ component: 'session-manager' });
  }

  /**
   * Register a newly launched Electron application. Throws if the concurrent
   * session cap has been reached — callers should close the app if this fires.
   */
  register(input: CreateSessionInput): Session {
    if (this.sessions.size >= this.maxSessions) {
      throw new PermissionDeniedError(`Maximum concurrent sessions reached (${this.maxSessions})`, {
        current: this.sessions.size,
        max: this.maxSessions,
      });
    }
    const id = newSessionId();
    const now = new Date();
    const session: Session = {
      id,
      ...(input.label !== undefined ? { label: input.label } : {}),
      executablePath: input.executablePath,
      args: input.args,
      status: 'active',
      app: input.app,
      startedAt: now,
      lastUsedAt: now,
      lastKnownWindowCount: input.app.windows().length,
      consoleBuffer: createConsoleBuffer(),
      dialog: createDialogState(),
      networkBuffer: createNetworkBuffer(),
      tracingActive: false,
      ...(input.userDataDir !== undefined ? { userDataDir: input.userDataDir } : {}),
      ...(input.autoTmpUserDataDir !== undefined
        ? { autoTmpUserDataDir: input.autoTmpUserDataDir }
        : {}),
    };
    this.sessions.set(id, session);

    instrumentSession(session);
    instrumentSessionForDialogs(session);
    instrumentSessionForNetwork(session);

    input.app.on('close', () => {
      const current = this.sessions.get(id);
      if (current && current.status !== 'closed') {
        this.logger.info('electron app closed externally', { sessionId: id });
        current.status = 'closed';
      }
    });

    this.logger.info('session registered', {
      sessionId: id,
      label: input.label,
      executablePath: input.executablePath,
      activeSessions: this.sessions.size,
    });
    return session;
  }

  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  tryGet(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  touch(session: Session): void {
    session.lastUsedAt = new Date();
    session.lastKnownWindowCount = session.app.windows().length;
  }

  setStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }

  list(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map(serializeSession);
  }

  size(): number {
    return this.sessions.size;
  }

  /**
   * Remove a session from the registry. Does NOT close the app — caller
   * is responsible for invoking `app.close()` before `remove`.
   *
   * If the session was launched with an auto-tmp `userDataDir`, that dir
   * is cleaned up on best-effort basis here. Crashes before remove()
   * (e.g. the Electron process SIGKILLing) leave the dir behind — that's
   * intentional for post-mortem inspection.
   */
  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session?.autoTmpUserDataDir && session.userDataDir) {
      cleanupUserDataDir(session.userDataDir);
    }
  }

  /**
   * Close every tracked session. Best-effort: failures are logged and
   * swallowed so shutdown is not blocked by a single hung app.
   */
  async closeAll(timeoutMs = 5_000): Promise<void> {
    const entries = Array.from(this.sessions.values());
    this.logger.info('closing all sessions', { count: entries.length });
    await Promise.all(
      entries.map(async (session) => {
        try {
          session.status = 'closing';
          await Promise.race([
            session.app.close(),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
          ]);
        } catch (err) {
          this.logger.warn('failed to close session', {
            sessionId: session.id,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          session.status = 'closed';
          this.sessions.delete(session.id);
          if (session.autoTmpUserDataDir && session.userDataDir) {
            cleanupUserDataDir(session.userDataDir);
          }
        }
      }),
    );
  }
}
