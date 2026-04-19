import type { ElectronApplication } from 'playwright';

export type SessionStatus = 'launching' | 'active' | 'closing' | 'closed' | 'crashed';

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
