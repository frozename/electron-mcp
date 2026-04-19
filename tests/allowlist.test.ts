import { describe, expect, test } from 'vitest';
import { matchesAllowlist } from '../src/utils/allowlist.js';

describe('matchesAllowlist', () => {
  test('empty allowlist permits anything', () => {
    expect(matchesAllowlist('/Applications/Foo.app/Contents/MacOS/Foo', [])).toBe(true);
  });

  test('exact path matches', () => {
    expect(matchesAllowlist('/usr/local/bin/electron', ['/usr/local/bin/electron'])).toBe(true);
  });

  test('star glob matches within a segment', () => {
    expect(matchesAllowlist('/usr/local/bin/electron-1.2.3', ['/usr/local/bin/electron-*'])).toBe(
      true,
    );
  });

  test('double-star glob crosses segments', () => {
    expect(
      matchesAllowlist('/Applications/MyApp.app/Contents/MacOS/MyApp', [
        '/Applications/*.app/**',
      ]),
    ).toBe(true);
  });

  test('non-matching path is rejected', () => {
    expect(matchesAllowlist('/opt/not-allowed/bin/electron', ['/usr/local/bin/*'])).toBe(false);
  });
});
