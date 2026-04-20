import type { ElectronApplication, Page, Request as PWRequest } from 'playwright';

import type { ConsoleEntry, NetworkEntry } from '../schemas/index.js';

export type SessionStatus = 'launching' | 'active' | 'closing' | 'closed' | 'crashed';

export interface ConsoleBuffer {
  /** Max entries retained. Oldest are evicted FIFO. */
  capacity: number;
  entries: ConsoleEntry[];
  /** Entries evicted since session start — used to signal drops to callers. */
  dropped: number;
  /** Pages whose listeners we have already wired, so we don't double-subscribe. */
  instrumented: WeakSet<Page>;
}

export type DialogPolicy = 'accept' | 'dismiss' | 'auto' | 'none';

export interface DialogState {
  policy: DialogPolicy;
  promptText?: string;
  handled: number;
  /** Pages we've already wired `page.on('dialog')` on. */
  instrumented: WeakSet<Page>;
}

export interface NetworkBuffer {
  capacity: number;
  entries: NetworkEntry[];
  dropped: number;
  instrumented: WeakSet<Page>;
  /** request → start timestamp (ms). Used to compute durationMs on response. */
  started: WeakMap<PWRequest, number>;
}

export interface Session {
  id: string;
  label?: string;
  executablePath: string;
  args: readonly string[];
  status: SessionStatus;
  app: ElectronApplication;
  startedAt: Date;
  lastUsedAt: Date;
  /** Stable counter used when a caller references windows by index. */
  lastKnownWindowCount: number;
  /** Ring buffer of console + pageerror entries across all windows. */
  consoleBuffer: ConsoleBuffer;
  /** Auto-handling policy for alert/confirm/prompt dialogs. */
  dialog: DialogState;
  /** Ring buffer of request/response events. */
  networkBuffer: NetworkBuffer;
  /** Tracing state — true while Playwright tracing is active. */
  tracingActive: boolean;
  /** Resolved --user-data-dir passed to Electron at launch. */
  userDataDir?: string;
  /** True when `userDataDir` was auto-minted and should be removed on
   * graceful close. Crashes leave the dir behind for post-mortem. */
  autoTmpUserDataDir?: boolean;
}

export interface SessionSnapshot {
  sessionId: string;
  label?: string;
  status: SessionStatus;
  executablePath: string;
  startedAt: string;
  lastUsedAt: string;
  windowCount: number;
}

export function serializeSession(session: Session): SessionSnapshot {
  return {
    sessionId: session.id,
    ...(session.label !== undefined ? { label: session.label } : {}),
    status: session.status,
    executablePath: session.executablePath,
    startedAt: session.startedAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    windowCount: session.lastKnownWindowCount,
  };
}
