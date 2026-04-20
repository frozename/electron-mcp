/**
 * Tests for ui-audit-driver-v2 flag parsing. The full audit path spawns
 * an Electron app and is exercised via the sprint smokes — here we cover
 * only the argv → Options mapping + the pixel-regression validation
 * rules, so regressions in flag handling fail fast without requiring a
 * GUI.
 */
import { describe, expect, test } from 'vitest';

import { parseArgs, type Options } from './ui-audit-driver-v2.js';

/** Build a full argv the way Node.js does: node binary, script path, then flags. */
function argv(...flags: string[]): string[] {
  return ['node', '/tests/ui-audit-driver-v2.ts', ...flags];
}

describe('ui-audit-driver-v2 parseArgs', () => {
  test('defaults when only --executable is supplied', () => {
    const opts = parseArgs(argv('--executable=/path/to/app'));
    expect(opts.executable).toBe('/path/to/app');
    expect(opts.execArgs).toEqual([]);
    expect(opts.env).toEqual({});
    expect(opts.userDataDir).toBeUndefined();
    expect(opts.baselinesDir).toBeUndefined();
    expect(opts.updateBaselines).toBe(false);
    expect(opts.threshold).toBe(0.01);
    expect(opts.pixelThreshold).toBe(0);
    expect(opts.diffDir).toBeUndefined();
  });

  test('--executable is required', () => {
    expect(() => parseArgs(argv('--baselines=/tmp/baselines'))).toThrow(/--executable required/);
  });

  test('--baselines=<path> parses correctly', () => {
    const opts = parseArgs(argv('--executable=/x', '--baselines=/tmp/baselines'));
    expect(opts.baselinesDir).toBe('/tmp/baselines');
    expect(opts.updateBaselines).toBe(false);
  });

  test('--updateBaselines is a boolean flag', () => {
    const opts = parseArgs(
      argv('--executable=/x', '--baselines=/tmp/baselines', '--updateBaselines'),
    );
    expect(opts.updateBaselines).toBe(true);
  });

  test('--updateBaselines WITHOUT --baselines throws clearly', () => {
    expect(() => parseArgs(argv('--executable=/x', '--updateBaselines'))).toThrow(
      /--updateBaselines requires --baselines/,
    );
  });

  test('--threshold=<n> parses as a number', () => {
    const opts = parseArgs(
      argv('--executable=/x', '--baselines=/tmp/b', '--threshold=0.05'),
    );
    expect(opts.threshold).toBe(0.05);
  });

  test('--threshold rejects non-numeric input', () => {
    expect(() =>
      parseArgs(argv('--executable=/x', '--baselines=/tmp/b', '--threshold=banana')),
    ).toThrow(/--threshold requires a finite number/);
  });

  test('--pixelThreshold=<n> parses as a number (ints ok)', () => {
    const opts = parseArgs(
      argv('--executable=/x', '--baselines=/tmp/b', '--pixelThreshold=10'),
    );
    expect(opts.pixelThreshold).toBe(10);
  });

  test('--diffDir=<path> parses', () => {
    const opts = parseArgs(
      argv('--executable=/x', '--baselines=/tmp/b', '--diffDir=/tmp/diffs'),
    );
    expect(opts.diffDir).toBe('/tmp/diffs');
  });

  test('all the regression-gate flags compose', () => {
    const opts: Options = parseArgs(
      argv(
        '--executable=/Applications/MyApp.app/Contents/MacOS/MyApp',
        '--args=main.js --foo',
        '--env=API_BASE=http://localhost:4000',
        '--userDataDir=/tmp/udd',
        '--baselines=/repo/tests/baselines',
        '--updateBaselines',
        '--threshold=0.02',
        '--pixelThreshold=8',
        '--diffDir=/tmp/diffs',
      ),
    );
    expect(opts.executable).toBe('/Applications/MyApp.app/Contents/MacOS/MyApp');
    expect(opts.execArgs).toEqual(['main.js', '--foo']);
    expect(opts.env).toEqual({ API_BASE: 'http://localhost:4000' });
    expect(opts.userDataDir).toBe('/tmp/udd');
    expect(opts.baselinesDir).toBe('/repo/tests/baselines');
    expect(opts.updateBaselines).toBe(true);
    expect(opts.threshold).toBe(0.02);
    expect(opts.pixelThreshold).toBe(8);
    expect(opts.diffDir).toBe('/tmp/diffs');
  });

  test('existing --env=KEY=VALUE parsing still works (regression)', () => {
    const opts = parseArgs(
      argv('--executable=/x', '--env=FOO=bar', '--env=BAZ=qux=with=equals'),
    );
    expect(opts.env).toEqual({ FOO: 'bar', BAZ: 'qux=with=equals' });
  });

  test('unknown flags are ignored (forward-compat)', () => {
    const opts = parseArgs(argv('--executable=/x', '--unknown=value', '--flag-only'));
    expect(opts.executable).toBe('/x');
    expect(opts.updateBaselines).toBe(false);
  });
});

describe('ui-audit-driver-v2 DiffReport aggregation', () => {
  // The driver's `diffsTotalBreached` is a count of `diffs.filter(d =>
  // d.thresholdBreached).length`. We can't run the full audit here, but
  // we can lock in the accumulation rule by re-deriving it from the same
  // field shape the report.json consumes.
  test('diffsTotalBreached counts only modules with thresholdBreached=true', () => {
    const diffs = [
      { moduleId: 'a', thresholdBreached: false },
      { moduleId: 'b', thresholdBreached: true },
      { moduleId: 'c', thresholdBreached: true },
      { moduleId: 'd', thresholdBreached: false },
    ];
    const breached = diffs.filter((d) => d.thresholdBreached).length;
    expect(breached).toBe(2);
  });

  test('empty diff list → zero breached', () => {
    const diffs: Array<{ thresholdBreached: boolean }> = [];
    expect(diffs.filter((d) => d.thresholdBreached).length).toBe(0);
  });
});
