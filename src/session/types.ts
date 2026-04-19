import type { ElectronApplication, Page } from 'playwright';

import type { ConsoleEntry } from '../schemas/index.js';

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
