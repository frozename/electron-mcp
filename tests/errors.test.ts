import { describe, expect, test } from 'vitest';
import {
  ElectronMcpError,
  SelectorError,
  SessionNotFoundError,
  TimeoutError,
  ValidationError,
  normalizeError,
} from '../src/errors/index.js';

describe('normalizeError', () => {
  test('passes through ElectronMcpError subclasses', () => {
    const err = new ValidationError('bad input', { field: 'x' });
    expect(normalizeError(err)).toBe(err);
  });

  test('maps unknown Error to internal_error with stack', () => {
    const err = normalizeError(new Error('boom'));
    expect(err).toBeInstanceOf(ElectronMcpError);
    expect(err.code).toBe('internal_error');
    expect(err.message).toBe('boom');
  });

  test('detects timeout in message', () => {
    const err = normalizeError(new Error('playwright timeout exceeded'));
    expect(err.code).toBe('timeout');
  });

  test('wraps non-Error throws', () => {
    const err = normalizeError('just a string');
    expect(err.code).toBe('internal_error');
    expect(err.message).toBe('just a string');
  });
});

describe('toJSON', () => {
  test('serializes selector error', () => {
    const err = new SelectorError('button#x', 'not found');
    expect(err.toJSON()).toEqual({
      ok: false,
      error: {
        code: 'selector_error',
        message: 'Selector failed: button#x (not found)',
        details: { selector: 'button#x', cause: 'not found' },
      },
    });
  });

  test('serializes session not found', () => {
    const err = new SessionNotFoundError('sess_abc');
    expect(err.toJSON().error.code).toBe('session_not_found');
    expect(err.toJSON().error.details).toMatchObject({ sessionId: 'sess_abc' });
  });

  test('serializes timeout', () => {
    const err = new TimeoutError('click', 5000);
    expect(err.toJSON().error.code).toBe('timeout');
    expect(err.toJSON().error.details).toMatchObject({ operation: 'click', timeoutMs: 5000 });
  });
});
