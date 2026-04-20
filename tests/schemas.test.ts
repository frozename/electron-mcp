import { describe, expect, test } from 'vitest';
import {
  AssertVisibleTextInputSchema,
  ElectronAccessibilitySnapshotInputSchema,
  ElectronClickInputSchema,
  ElectronConsoleTailInputSchema,
  ElectronDialogPolicyInputSchema,
  ElectronHoverInputSchema,
  ElectronLaunchInputSchema,
  ElectronNetworkTailInputSchema,
  ElectronPressInputSchema,
  ElectronSelectOptionInputSchema,
  ElectronTraceStartInputSchema,
  ElectronTraceStopInputSchema,
  ElectronWaitForNewWindowInputSchema,
  ElectronWaitForSelectorInputSchema,
  ElectronWaitForWindowInputSchema,
  ScreenshotDiffInputSchema,
} from '../src/schemas/index.js';

describe('ElectronLaunchInputSchema', () => {
  test('accepts a minimal launch', () => {
    const result = ElectronLaunchInputSchema.parse({ executablePath: '/bin/electron' });
    expect(result.executablePath).toBe('/bin/electron');
    expect(result.args).toEqual([]);
  });

  test('rejects empty executable path', () => {
    expect(() => ElectronLaunchInputSchema.parse({ executablePath: '' })).toThrow();
  });

  test('rejects overly large timeout', () => {
    expect(() =>
      ElectronLaunchInputSchema.parse({ executablePath: '/x', timeout: 999_999 }),
    ).toThrow();
  });

  test('accepts env record', () => {
    const parsed = ElectronLaunchInputSchema.parse({
      executablePath: '/x',
      env: { FOO: 'bar', HELLO: 'world' },
    });
    expect(parsed.env).toEqual({ FOO: 'bar', HELLO: 'world' });
  });

  test('accepts userDataDir + strictUserDataDir', () => {
    const parsed = ElectronLaunchInputSchema.parse({
      executablePath: '/x',
      userDataDir: '/tmp/my-udd',
      strictUserDataDir: true,
    });
    expect(parsed.userDataDir).toBe('/tmp/my-udd');
    expect(parsed.strictUserDataDir).toBe(true);
  });

  test('strictUserDataDir defaults to false', () => {
    const parsed = ElectronLaunchInputSchema.parse({ executablePath: '/x' });
    expect(parsed.strictUserDataDir).toBe(false);
  });
});

describe('ElectronClickInputSchema', () => {
  test('applies defaults', () => {
    const parsed = ElectronClickInputSchema.parse({
      sessionId: 'sess_1',
      selector: '#x',
    });
    expect(parsed.button).toBe('left');
    expect(parsed.clickCount).toBe(1);
    expect(parsed.force).toBe(false);
  });
});

describe('ElectronWaitForWindowInputSchema', () => {
  test('accepts urlPattern only', () => {
    const parsed = ElectronWaitForWindowInputSchema.parse({
      sessionId: 'sess_1',
      urlPattern: '/login',
    });
    expect(parsed.urlPattern).toBe('/login');
  });
});

describe('ElectronWaitForSelectorInputSchema', () => {
  test('defaults state to visible', () => {
    const parsed = ElectronWaitForSelectorInputSchema.parse({
      sessionId: 'sess_1',
      selector: '#login',
    });
    expect(parsed.state).toBe('visible');
  });

  test('rejects unknown state', () => {
    expect(() =>
      ElectronWaitForSelectorInputSchema.parse({
        sessionId: 'sess_1',
        selector: '#x',
        state: 'enabled',
      }),
    ).toThrow();
  });
});

describe('ElectronAccessibilitySnapshotInputSchema', () => {
  test('defaults interestingOnly to true', () => {
    const parsed = ElectronAccessibilitySnapshotInputSchema.parse({
      sessionId: 'sess_1',
    });
    expect(parsed.interestingOnly).toBe(true);
  });
});

describe('ElectronHoverInputSchema', () => {
  test('defaults force to false', () => {
    const parsed = ElectronHoverInputSchema.parse({ sessionId: 's', selector: '#x' });
    expect(parsed.force).toBe(false);
  });
});

describe('ElectronPressInputSchema', () => {
  test('accepts modifier combos', () => {
    const parsed = ElectronPressInputSchema.parse({ sessionId: 's', key: 'Meta+K' });
    expect(parsed.key).toBe('Meta+K');
  });

  test('rejects empty key', () => {
    expect(() => ElectronPressInputSchema.parse({ sessionId: 's', key: '' })).toThrow();
  });
});

describe('ElectronSelectOptionInputSchema', () => {
  test('accepts value', () => {
    const parsed = ElectronSelectOptionInputSchema.parse({
      sessionId: 's',
      selector: '#drop',
      value: 'opt1',
    });
    expect(parsed.value).toBe('opt1');
  });

  test('rejects when no pick is given', () => {
    expect(() =>
      ElectronSelectOptionInputSchema.parse({ sessionId: 's', selector: '#drop' }),
    ).toThrow(/value, label, or index/);
  });
});

describe('ElectronDialogPolicyInputSchema', () => {
  test('accepts each policy', () => {
    for (const policy of ['accept', 'dismiss', 'auto', 'none'] as const) {
      const parsed = ElectronDialogPolicyInputSchema.parse({ sessionId: 's', policy });
      expect(parsed.policy).toBe(policy);
    }
  });

  test('rejects unknown policy', () => {
    expect(() =>
      ElectronDialogPolicyInputSchema.parse({ sessionId: 's', policy: 'ignore' }),
    ).toThrow();
  });
});

describe('ElectronConsoleTailInputSchema', () => {
  test('defaults limit and drain', () => {
    const parsed = ElectronConsoleTailInputSchema.parse({ sessionId: 'sess_1' });
    expect(parsed.limit).toBe(100);
    expect(parsed.drain).toBe(false);
  });

  test('limits reject over-sized requests', () => {
    expect(() =>
      ElectronConsoleTailInputSchema.parse({ sessionId: 'sess_1', limit: 99999 }),
    ).toThrow();
  });
});

describe('ElectronNetworkTailInputSchema', () => {
  test('defaults limit and filters', () => {
    const parsed = ElectronNetworkTailInputSchema.parse({ sessionId: 's' });
    expect(parsed.limit).toBe(100);
    expect(parsed.onlyFailures).toBe(false);
    expect(parsed.drain).toBe(false);
  });

  test('status filter accepts 3xx/4xx', () => {
    const parsed = ElectronNetworkTailInputSchema.parse({ sessionId: 's', status: [404, 500] });
    expect(parsed.status).toEqual([404, 500]);
  });

  test('rejects invalid status', () => {
    expect(() =>
      ElectronNetworkTailInputSchema.parse({ sessionId: 's', status: [99] }),
    ).toThrow();
  });
});

describe('ElectronWaitForNewWindowInputSchema', () => {
  test('all filters optional', () => {
    const parsed = ElectronWaitForNewWindowInputSchema.parse({ sessionId: 's' });
    expect(parsed.sessionId).toBe('s');
  });
});

describe('ElectronTraceStartInputSchema', () => {
  test('defaults', () => {
    const parsed = ElectronTraceStartInputSchema.parse({ sessionId: 's' });
    expect(parsed.screenshots).toBe(true);
    expect(parsed.snapshots).toBe(true);
    expect(parsed.sources).toBe(false);
  });
});

describe('ElectronTraceStopInputSchema', () => {
  test('requires path', () => {
    expect(() => ElectronTraceStopInputSchema.parse({ sessionId: 's' })).toThrow();
  });
});

describe('ScreenshotDiffInputSchema', () => {
  test('applies defaults', () => {
    const parsed = ScreenshotDiffInputSchema.parse({
      sessionId: 's',
      baselinePath: '/tmp/baseline.png',
    });
    expect(parsed.updateBaseline).toBe(false);
    expect(parsed.threshold).toBe(0.01);
    expect(parsed.pixelThreshold).toBe(0);
    expect(parsed.fullPage).toBe(false);
  });

  test('rejects missing baseline path', () => {
    expect(() => ScreenshotDiffInputSchema.parse({ sessionId: 's' })).toThrow();
  });

  test('rejects out-of-range threshold', () => {
    expect(() =>
      ScreenshotDiffInputSchema.parse({
        sessionId: 's',
        baselinePath: '/x',
        threshold: 1.5,
      }),
    ).toThrow();
  });

  test('rejects out-of-range pixelThreshold', () => {
    expect(() =>
      ScreenshotDiffInputSchema.parse({
        sessionId: 's',
        baselinePath: '/x',
        pixelThreshold: 300,
      }),
    ).toThrow();
  });

  test('accepts optional selector and diffPath', () => {
    const parsed = ScreenshotDiffInputSchema.parse({
      sessionId: 's',
      baselinePath: '/b.png',
      selector: 'div.panel',
      diffPath: '/d.png',
    });
    expect(parsed.selector).toBe('div.panel');
    expect(parsed.diffPath).toBe('/d.png');
  });
});

describe('AssertVisibleTextInputSchema', () => {
  test('applies defaults', () => {
    const parsed = AssertVisibleTextInputSchema.parse({
      sessionId: 's',
      text: 'Uninstall',
    });
    expect(parsed.regex).toBe(false);
    expect(parsed.includeHidden).toBe(false);
    expect(parsed.timeoutMs).toBe(5_000);
  });

  test('rejects empty text', () => {
    expect(() => AssertVisibleTextInputSchema.parse({ sessionId: 's', text: '' })).toThrow();
  });

  test('rejects oversized timeout', () => {
    expect(() =>
      AssertVisibleTextInputSchema.parse({ sessionId: 's', text: 'x', timeoutMs: 60_000 }),
    ).toThrow();
  });

  test('accepts regex + includeHidden', () => {
    const parsed = AssertVisibleTextInputSchema.parse({
      sessionId: 's',
      text: '^\\s*Uninstall',
      regex: true,
      includeHidden: true,
    });
    expect(parsed.regex).toBe(true);
    expect(parsed.includeHidden).toBe(true);
  });

  test('accepts timeoutMs=0 for immediate check', () => {
    const parsed = AssertVisibleTextInputSchema.parse({
      sessionId: 's',
      text: 'x',
      timeoutMs: 0,
    });
    expect(parsed.timeoutMs).toBe(0);
  });
});
