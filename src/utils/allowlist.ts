import path from 'node:path';

/**
 * Minimal glob matcher supporting `*` (no slash) and `**` (any).
 * Sufficient for executable allowlists without pulling in a dependency.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withGlobs = escaped
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*');
  return new RegExp(`^${withGlobs}$`);
}

/**
 * Return true when `executablePath` matches any glob in `allowlist`.
 * An empty allowlist means "no restriction" — callers decide whether to
 * enforce that behaviour or refuse to launch.
 */
export function matchesAllowlist(executablePath: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  const resolved = path.resolve(executablePath);
  return allowlist.some((pattern) => {
    const normalized = pattern.startsWith('~')
      ? path.join(process.env.HOME ?? '', pattern.slice(1))
      : pattern;
    const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(normalized);
    const regex = globToRegExp(absolute);
    return regex.test(resolved);
  });
}
