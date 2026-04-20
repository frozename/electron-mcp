import { describe, expect, test, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';

import {
  cleanupUserDataDir,
  isSingletonLockActive,
  redactEnvForLog,
  resolveUserDataDir,
  USER_DATA_DIR_PREFIX,
} from '../src/utils/user-data-dir.js';
import { composeLaunchArgs } from '../src/electron/electron-adapter.js';

function freshDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `udd-test-${label}-`));
}

// Track dirs we create so we can scrub them on teardown.
const created = new Set<string>();
function track(dir: string): string {
  created.add(dir);
  return dir;
}
afterEach(() => {
  for (const d of created) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  created.clear();
});

describe('resolveUserDataDir', () => {
  test('no userDataDir → auto-mints a tmp dir', () => {
    const res = resolveUserDataDir({});
    track(res.dir);
    expect(res.autoTmp).toBe(true);
    expect(res.replacedLockedDir).toBeUndefined();
    expect(res.dir).toContain(USER_DATA_DIR_PREFIX);
    expect(existsSync(res.dir)).toBe(true);
  });

  test('caller-supplied dir (no lock) → returns as-is + creates if missing', () => {
    const base = freshDir('supplied');
    track(base);
    const childThatDoesNotYetExist = join(base, 'profile');
    const res = resolveUserDataDir({ userDataDir: childThatDoesNotYetExist });
    expect(res.dir).toBe(childThatDoesNotYetExist);
    expect(res.autoTmp).toBe(false);
    expect(res.replacedLockedDir).toBeUndefined();
    expect(existsSync(childThatDoesNotYetExist)).toBe(true);
  });

  test('lock-conflict (alive pid) → auto-tmp + echoes replacedLockedDir', () => {
    const base = freshDir('locked');
    track(base);
    // Fake a SingletonLock pointing at OUR pid — guaranteed alive.
    symlinkSync(`${hostname()}-${process.pid}`, join(base, 'SingletonLock'));

    const res = resolveUserDataDir({ userDataDir: base });
    track(res.dir);
    expect(res.autoTmp).toBe(true);
    expect(res.replacedLockedDir).toBe(base);
    expect(res.dir).not.toBe(base);
    expect(res.dir).toContain(USER_DATA_DIR_PREFIX);
  });

  test('lock-conflict + strictUserDataDir → throws', () => {
    const base = freshDir('strict');
    track(base);
    symlinkSync(`${hostname()}-${process.pid}`, join(base, 'SingletonLock'));

    expect(() => resolveUserDataDir({ userDataDir: base, strict: true })).toThrow(
      /locked by another Electron instance/i,
    );
  });

  test('stale lock (dead pid) → still uses the provided dir', () => {
    const base = freshDir('stale');
    track(base);
    // Pick a pid we can be confident is dead. We use an impossibly high
    // pid (7 digits) — Linux/macOS caps pid_max well below this in
    // practice, and kill(pid, 0) returns ESRCH.
    const deadPid = 9_999_998;
    symlinkSync(`${hostname()}-${deadPid}`, join(base, 'SingletonLock'));

    const res = resolveUserDataDir({ userDataDir: base });
    expect(res.dir).toBe(base);
    expect(res.autoTmp).toBe(false);
    expect(res.replacedLockedDir).toBeUndefined();
  });

  test('lock symlink with non-numeric target → treated as unlocked', () => {
    const base = freshDir('garbage');
    track(base);
    symlinkSync('not-a-valid-target', join(base, 'SingletonLock'));

    const res = resolveUserDataDir({ userDataDir: base });
    expect(res.dir).toBe(base);
    expect(res.autoTmp).toBe(false);
  });

  test('non-symlink SingletonLock → conservatively treated as locked', () => {
    const base = freshDir('regular');
    track(base);
    // Regular file, not a symlink — don't know how to parse it, be safe.
    writeFileSync(join(base, 'SingletonLock'), 'opaque');

    const res = resolveUserDataDir({ userDataDir: base });
    track(res.dir);
    expect(res.autoTmp).toBe(true);
    expect(res.replacedLockedDir).toBe(base);
  });
});

describe('isSingletonLockActive', () => {
  test('missing file → false', () => {
    const base = freshDir('nolock');
    track(base);
    expect(isSingletonLockActive(base)).toBe(false);
  });

  test('alive pid → true', () => {
    const base = freshDir('alive');
    track(base);
    symlinkSync(`${hostname()}-${process.pid}`, join(base, 'SingletonLock'));
    expect(isSingletonLockActive(base)).toBe(true);
  });

  test('dead pid → false', () => {
    const base = freshDir('dead');
    track(base);
    symlinkSync(`${hostname()}-9999998`, join(base, 'SingletonLock'));
    expect(isSingletonLockActive(base)).toBe(false);
  });
});

describe('cleanupUserDataDir', () => {
  test('removes the supplied dir', () => {
    const base = freshDir('cleanup');
    mkdirSync(join(base, 'nested'), { recursive: true });
    cleanupUserDataDir(base);
    expect(existsSync(base)).toBe(false);
  });

  test('tolerates missing dir', () => {
    const base = join(tmpdir(), 'never-created-' + Math.random().toString(36).slice(2));
    expect(() => cleanupUserDataDir(base)).not.toThrow();
  });

  test('tolerates undefined', () => {
    expect(() => cleanupUserDataDir(undefined)).not.toThrow();
  });
});

describe('redactEnvForLog', () => {
  test('scrubs secret-shaped keys', () => {
    const r = redactEnvForLog({
      FOO: 'bar',
      AWS_SECRET_ACCESS_KEY: 'abcd1234',
      BEARER_TOKEN: 'xyz',
      MY_TOKEN: 'tok',
      API_KEY: 'k',
      SOMETHING_PASSWORD: 'pw',
      HARMLESS: 'fine',
    });
    expect(r.FOO).toBe('bar');
    expect(r.HARMLESS).toBe('fine');
    expect(r.AWS_SECRET_ACCESS_KEY).toBe('<redacted>');
    expect(r.BEARER_TOKEN).toBe('<redacted>');
    expect(r.MY_TOKEN).toBe('<redacted>');
    expect(r.API_KEY).toBe('<redacted>');
    expect(r.SOMETHING_PASSWORD).toBe('<redacted>');
  });

  test('undefined → empty object', () => {
    expect(redactEnvForLog(undefined)).toEqual({});
  });

  test('does NOT mutate caller', () => {
    const input = { FOO: 'bar', TOKEN: 'secret' };
    redactEnvForLog(input);
    expect(input.TOKEN).toBe('secret');
  });
});

describe('composeLaunchArgs', () => {
  test('no userDataDir → returns args unchanged', () => {
    expect(composeLaunchArgs(['--foo', '--bar'], undefined)).toEqual(['--foo', '--bar']);
  });

  test('splices --user-data-dir when absent', () => {
    expect(composeLaunchArgs(['--foo'], '/tmp/udd')).toEqual([
      '--foo',
      '--user-data-dir=/tmp/udd',
    ]);
  });

  test('caller-supplied --user-data-dir= wins', () => {
    expect(composeLaunchArgs(['--user-data-dir=/already/set'], '/tmp/udd')).toEqual([
      '--user-data-dir=/already/set',
    ]);
  });

  test('caller-supplied space-separated --user-data-dir wins', () => {
    expect(composeLaunchArgs(['--user-data-dir', '/already'], '/tmp/udd')).toEqual([
      '--user-data-dir',
      '/already',
    ]);
  });

  test('undefined base args → just the flag', () => {
    expect(composeLaunchArgs(undefined, '/tmp/udd')).toEqual(['--user-data-dir=/tmp/udd']);
  });
});
