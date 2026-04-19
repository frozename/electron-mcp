import { describe, expect, test } from 'vitest';
import {
  ElectronClickInputSchema,
  ElectronLaunchInputSchema,
  ElectronWaitForWindowInputSchema,
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
