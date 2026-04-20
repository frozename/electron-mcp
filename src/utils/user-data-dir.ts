import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Utilities for resolving the Chromium `--user-data-dir` passed to Electron
 * at launch. The main jobs:
 *
 *   1. If the caller omits `userDataDir`, mint a fresh `/tmp/...` directory
 *      so the session is hermetic (no bleed from crashed prior runs, no
 *      conflict with a user's desktop copy of the app).
 *   2. If the caller supplied a dir that already has an active
 *      `SingletonLock`, either fail fast (strict) or substitute a tmp dir
 *      (permissive default). Chromium's singleton lock silently stalls the
 *      new process, so this MUST be detected before launch.
 *   3. Best-effort cleanup of auto-minted dirs on graceful close.
 */

export interface ResolvedUserDataDir {
  /** The directory to pass via `--user-data-dir`. */
  dir: string;
  /** True when `dir` was freshly created by us (caller must clean up). */
  autoTmp: boolean;
  /** Present when we replaced a locked dir with a fresh one. Echoed so the
   * caller/operator can see what happened. */
  replacedLockedDir?: string;
}

export interface ResolveUserDataDirOptions {
  userDataDir?: string;
  /** When true and the caller's userDataDir is locked, throw instead of
   * auto-substituting a tmp dir. */
  strict?: boolean;
}

export const USER_DATA_DIR_PREFIX = 'electron-mcp-userdata-';

/**
 * Resolve the userDataDir for a launch. See module docs for semantics.
 * Throws when `strict` is true AND the provided dir has an active lock.
 */
export function resolveUserDataDir(opts: ResolveUserDataDirOptions): ResolvedUserDataDir {
  if (!opts.userDataDir) {
    const dir = mkdtempSync(join(tmpdir(), USER_DATA_DIR_PREFIX));
    return { dir, autoTmp: true };
  }

  if (isSingletonLockActive(opts.userDataDir)) {
    if (opts.strict) {
      throw new Error(
        `userDataDir ${opts.userDataDir} is locked by another Electron instance (SingletonLock)`,
      );
    }
    const dir = mkdtempSync(join(tmpdir(), USER_DATA_DIR_PREFIX));
    return { dir, autoTmp: true, replacedLockedDir: opts.userDataDir };
  }

  // Not locked — ensure the dir actually exists before handing it to
  // Chromium (Electron happily creates it but Playwright's own bookkeeping
  // sometimes chokes on missing ancestors).
  mkdirSync(opts.userDataDir, { recursive: true });
  return { dir: opts.userDataDir, autoTmp: false };
}

/**
 * Detect a `SingletonLock` whose holder process is still alive.
 *
 * Chromium writes this file as a symlink with target `<hostname>-<pid>` on
 * macOS + Linux. When the process dies without cleaning up, the symlink is
 * still there but the pid is gone — "stale lock". We distinguish the two
 * with a `kill(pid, 0)` existence check so stale locks don't force an
 * unnecessary tmp dir.
 *
 * Windows uses a different on-disk format; we treat any Windows path as
 * "not locked" for now (documented as a future improvement).
 */
export function isSingletonLockActive(userDataDir: string): boolean {
  const lockPath = join(userDataDir, 'SingletonLock');
  // IMPORTANT: use lstat rather than existsSync — Chromium's SingletonLock
  // is a symlink to a target that doesn't actually exist on disk
  // (`<hostname>-<pid>` is a string, not a path), so `existsSync` follows
  // the dangling link and returns false. `lstat` inspects the symlink
  // itself.
  let target: string;
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isSymbolicLink()) {
      // Non-symlink lock file — treat as "present but can't verify". Be
      // conservative and report locked so we don't collide.
      return true;
    }
    target = readlinkSync(lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    // Permission errors / unknown failures — conservative: report locked
    // so we don't silently collide.
    return false;
  }

  // Target format: `<hostname>-<pid>`. Extract the trailing integer.
  const match = /-(\d+)$/.exec(target);
  if (!match) return false;
  const pid = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(pid) || pid <= 0) return false;

  try {
    // signal 0 = existence / permission probe. Throws ESRCH when the pid
    // is gone, EPERM when it exists but we can't signal it (still alive).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

/**
 * Best-effort removal of an auto-minted userDataDir. Never throws: a leaked
 * dir is an operational inconvenience, not a correctness bug, and we'd
 * rather let the caller continue shutting down cleanly.
 */
export function cleanupUserDataDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // swallow — best-effort
  }
}

const SECRET_KEY_RE = /TOKEN|BEARER|SECRET|KEY|PASSWORD|PASSWD|API[-_]?KEY/i;

/**
 * Scrub secret-shaped env keys for logging. We never log the raw env
 * record; every diagnostic passes through here first so a stray
 * `AWS_SECRET_ACCESS_KEY` can't leak via structured logs.
 */
export function redactEnvForLog(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SECRET_KEY_RE.test(k) ? '<redacted>' : v;
  }
  return out;
}
