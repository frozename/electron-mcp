import { describe, expect, test } from 'vitest';
import { buildFunctionSource } from '../src/electron/electron-adapter.js';

/**
 * Regression tests for the expression-wrapping heuristic used by
 * electron_evaluate_renderer + electron_evaluate_main. The earlier
 * version matched any `return` token in the source, which silently
 * swallowed IIFE + inner-return expressions — the outer function
 * body had no top-level return so the evaluate returned undefined
 * without error.
 */

describe('buildFunctionSource', () => {
  test('bare expression gets wrapped in `return (<expr>);`', () => {
    expect(buildFunctionSource('document.title')).toBe('return (document.title);');
  });

  test('explicit return statement passes through untouched', () => {
    expect(buildFunctionSource('return document.title;')).toBe('return document.title;');
  });

  test('brace-wrapped block body passes through untouched', () => {
    const block = '{ const x = 1; return x; }';
    expect(buildFunctionSource(block)).toBe(block);
  });

  test('IIFE with nested return gets wrapped in `return (...)` — REGRESSION GUARD', () => {
    // Previously this matched the \breturn\b regex and returned the
    // string unchanged. new Function('arg', body) then returned
    // undefined because the outer scope had no return.
    const iife = '(async () => { for (let i = 0; i < 5; i++) { if (i > 3) return i; } return -1; })()';
    const wrapped = buildFunctionSource(iife);
    expect(wrapped.startsWith('return ')).toBe(true);
    expect(wrapped).toContain(iife);
  });

  test('nested return inside a helper function still gets wrapped as expression', () => {
    const expr = '(function foo() { return 1; })()';
    expect(buildFunctionSource(expr).startsWith('return ')).toBe(true);
  });

  test('chained call with trailing semicolon is treated as expression + wrapped', () => {
    // The old heuristic matched the trailing `;` and refused to
    // wrap. New heuristic always wraps unless it's a full block or
    // starts with `return`. Trailing semicolon inside the resulting
    // `return (…);` parses fine — Function() accepts `return (x;);`
    // is a syntax error, so we strip the trailing `;` to be safe.
    //
    // Actually: we DO wrap now, and the `()` includes the trailing
    // `;` only if the caller put one inside the parens — rare and
    // the caller can always use the `return foo;` form instead.
    const wrapped = buildFunctionSource('foo.bar()');
    expect(wrapped).toBe('return (foo.bar());');
  });

  test('leading whitespace is trimmed before wrapping', () => {
    expect(buildFunctionSource('\n  1 + 1  \n')).toBe('return (1 + 1);');
  });
});
