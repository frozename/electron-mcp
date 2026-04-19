import path from 'node:path';
import { promises as fs } from 'node:fs';

import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';

import {
  EvaluationError,
  LaunchError,
  PermissionDeniedError,
  SelectorError,
  WindowNotFoundError,
  normalizeError,
} from '../errors/index.js';
import type { Logger } from '../logging/logger.js';
import type { ServerConfig } from '../utils/config.js';
import { matchesAllowlist } from '../utils/allowlist.js';
import { withTimeout } from '../utils/timeout.js';

export interface LaunchParams {
  executablePath: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  recordVideoDir?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
}

/**
 * The Playwright-side facade. Keeps the rest of the codebase ignorant of
 * Playwright specifics so we can swap implementations or add tracing
 * without touching tool handlers.
 */
export class ElectronAdapter {
  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
  ) {}

  async launch(params: LaunchParams): Promise<ElectronApplication> {
    const resolvedPath = path.resolve(params.executablePath);

    if (!matchesAllowlist(resolvedPath, this.config.executableAllowlist)) {
      throw new PermissionDeniedError(
        `Executable not in allowlist: ${resolvedPath}`,
        { executablePath: resolvedPath, allowlist: this.config.executableAllowlist },
      );
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      throw new LaunchError(`Executable does not exist or is not accessible: ${resolvedPath}`, {
        executablePath: resolvedPath,
      });
    }

    this.logger.info('launching electron app', {
      executablePath: resolvedPath,
      args: params.args,
      cwd: params.cwd,
    });

    try {
      const launchOptions: Parameters<typeof electron.launch>[0] = {
        executablePath: resolvedPath,
        args: [...(params.args ?? [])],
        timeout: params.timeoutMs,
      };
      if (params.cwd) {
        launchOptions.cwd = params.cwd;
      }
      if (params.env) {
        launchOptions.env = { ...process.env, ...params.env } as Record<string, string>;
      }
      if (params.recordVideoDir) {
        launchOptions.recordVideo = { dir: params.recordVideoDir };
      }
      if (params.colorScheme) {
        launchOptions.colorScheme = params.colorScheme;
      }

      const app = await withTimeout(
        electron.launch(launchOptions),
        params.timeoutMs,
        'electron.launch',
      );

      return app;
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === 'timeout') {
        throw normalized;
      }
      throw new LaunchError(`Failed to launch electron app: ${normalized.message}`, {
        executablePath: resolvedPath,
        cause: normalized.message,
      });
    }
  }

  /**
   * Resolve a window reference (index | url substring | title substring)
   * to a Playwright `Page`. Throws `WindowNotFoundError` if unresolvable.
   */
  async resolveWindow(
    app: ElectronApplication,
    ref?: number | string,
  ): Promise<Page> {
    const windows = app.windows();
    if (windows.length === 0) {
      throw new WindowNotFoundError(ref ?? '<default>');
    }

    if (ref === undefined || ref === null) {
      const first = windows[0];
      if (!first) throw new WindowNotFoundError('<default>');
      return first;
    }

    if (typeof ref === 'number') {
      const page = windows[ref];
      if (!page) throw new WindowNotFoundError(ref);
      return page;
    }

    // String: match on URL substring/regex first, then title.
    const needle = ref;
    let pattern: RegExp | null = null;
    try {
      pattern = new RegExp(needle);
    } catch {
      pattern = null;
    }

    for (const win of windows) {
      const url = win.url();
      if (url === needle || url.includes(needle) || (pattern && pattern.test(url))) {
        return win;
      }
    }

    const titles = await Promise.all(
      windows.map(async (win) => {
        try {
          return await win.title();
        } catch {
          return '';
        }
      }),
    );
    for (let i = 0; i < windows.length; i++) {
      const title = titles[i] ?? '';
      const page = windows[i];
      if (!page) continue;
      if (title === needle || title.includes(needle) || (pattern && pattern.test(title))) {
        return page;
      }
    }

    throw new WindowNotFoundError(ref);
  }

  async describeWindow(
    win: Page,
    index: number,
  ): Promise<{ index: number; title: string; url: string; isClosed: boolean }> {
    const isClosed = win.isClosed();
    const url = win.url();
    let title = '';
    if (!isClosed) {
      try {
        title = await win.title();
      } catch {
        title = '';
      }
    }
    return { index, title, url, isClosed };
  }

  async listWindows(app: ElectronApplication): Promise<
    { index: number; title: string; url: string; isClosed: boolean }[]
  > {
    const windows = app.windows();
    return Promise.all(windows.map((win, i) => this.describeWindow(win, i)));
  }

  /**
   * Wait until a window matching the predicate exists. Resolves with the
   * matched page; rejects with `WindowNotFoundError` (wrapped in a timeout
   * if the deadline is reached).
   */
  async waitForWindow(
    app: ElectronApplication,
    predicate: { urlPattern?: string; titlePattern?: string; index?: number },
    timeoutMs: number,
  ): Promise<Page> {
    const match = async (): Promise<Page | null> => {
      const windows = app.windows();
      if (predicate.index !== undefined) {
        const byIdx = windows[predicate.index];
        return byIdx ?? null;
      }
      for (const win of windows) {
        const url = win.url();
        if (predicate.urlPattern) {
          const re = safeRegex(predicate.urlPattern);
          if (url.includes(predicate.urlPattern) || (re && re.test(url))) return win;
        }
        if (predicate.titlePattern) {
          try {
            const title = await win.title();
            const re = safeRegex(predicate.titlePattern);
            if (
              title.includes(predicate.titlePattern) ||
              (re && re.test(title))
            ) {
              return win;
            }
          } catch {
            // ignore; the page may be mid-load
          }
        }
      }
      return null;
    };

    const existing = await match();
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        app.off('window', onWindow);
        reject(new WindowNotFoundError(describePredicate(predicate)));
      }, timeoutMs);

      const onWindow = async (): Promise<void> => {
        try {
          const found = await match();
          if (found) {
            clearTimeout(timer);
            app.off('window', onWindow);
            resolve(found);
          }
        } catch (err) {
          clearTimeout(timer);
          app.off('window', onWindow);
          reject(normalizeError(err));
        }
      };
      app.on('window', onWindow);
    });
  }

  async click(
    win: Page,
    selector: string,
    options: {
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
      delay?: number;
      force?: boolean;
      timeoutMs: number;
    },
  ): Promise<void> {
    try {
      const clickOptions: Parameters<Page['click']>[1] = {
        timeout: options.timeoutMs,
        button: options.button ?? 'left',
        clickCount: options.clickCount ?? 1,
        force: options.force ?? false,
      };
      if (options.delay !== undefined) {
        clickOptions.delay = options.delay;
      }
      await win.click(selector, clickOptions);
    } catch (err) {
      throw this.translateElementError(err, selector);
    }
  }

  async fill(
    win: Page,
    selector: string,
    value: string,
    options: { timeoutMs: number },
  ): Promise<void> {
    try {
      await win.fill(selector, value, { timeout: options.timeoutMs });
    } catch (err) {
      throw this.translateElementError(err, selector);
    }
  }

  async evaluateRenderer(
    win: Page,
    expression: string,
    arg: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const body = buildFunctionSource(expression);
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const result = await withTimeout(
        win.evaluate(new Function('arg', body) as (a: unknown) => unknown, arg),
        timeoutMs,
        'renderer.evaluate',
      );
      return result;
    } catch (err) {
      throw new EvaluationError(
        `Renderer evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
        { expressionLength: expression.length },
      );
    }
  }

  async evaluateMain(
    app: ElectronApplication,
    expression: string,
    arg: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const body = buildFunctionSource(expression);
    try {
      // The main-process evaluator receives `{ app, ... }` as the first
      // argument and our user-supplied `arg` as the second. We wrap the
      // caller-provided body so both arguments are in scope.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const wrapped = new Function(
        'electron',
        'arg',
        body,
      ) as (electronMod: unknown, a: unknown) => unknown;

      const result = await withTimeout(
        app.evaluate(wrapped, arg),
        timeoutMs,
        'main.evaluate',
      );
      return result;
    } catch (err) {
      throw new EvaluationError(
        `Main process evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
        { expressionLength: expression.length },
      );
    }
  }

  async screenshot(
    win: Page,
    options: {
      fullPage?: boolean;
      path?: string;
      type: 'png' | 'jpeg';
      quality?: number;
      timeoutMs: number;
    },
  ): Promise<Buffer> {
    const screenshotOpts: Parameters<Page['screenshot']>[0] = {
      fullPage: options.fullPage ?? false,
      type: options.type,
      timeout: options.timeoutMs,
    };
    if (options.path) {
      screenshotOpts.path = options.path;
    }
    if (options.type === 'jpeg' && options.quality !== undefined) {
      screenshotOpts.quality = options.quality;
    }
    try {
      return await win.screenshot(screenshotOpts);
    } catch (err) {
      throw new EvaluationError(
        `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private translateElementError(err: unknown, selector: string): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(message)) {
      // Let the caller know which selector timed out without losing the category.
      return new SelectorError(selector, 'timeout waiting for element');
    }
    return new SelectorError(selector, message);
  }
}

function safeRegex(input: string): RegExp | null {
  try {
    return new RegExp(input);
  } catch {
    return null;
  }
}

function describePredicate(p: { urlPattern?: string; titlePattern?: string; index?: number }): string {
  const parts: string[] = [];
  if (p.urlPattern) parts.push(`url~=${p.urlPattern}`);
  if (p.titlePattern) parts.push(`title~=${p.titlePattern}`);
  if (p.index !== undefined) parts.push(`index=${p.index}`);
  return parts.length > 0 ? parts.join(',') : '<any>';
}

/**
 * Accept either:
 *   - a full function body (multi-line with `return`) — used as-is
 *   - a single expression                           — wrapped in `return (<expr>);`
 * The `arg` / `electron` / `arg` identifiers are made available via the
 * wrapping `new Function(...)` signature.
 */
function buildFunctionSource(expression: string): string {
  const trimmed = expression.trim();
  if (/^[\s\S]*\breturn\b/.test(trimmed) || /;\s*$/.test(trimmed) || /^\{[\s\S]*\}$/.test(trimmed)) {
    return trimmed;
  }
  return `return (${trimmed});`;
}
