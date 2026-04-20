/**
 * assert_visible_text — accessibility/DOM text search with polling waits.
 *
 * Uses Playwright's built-in locator primitives (`getByText`, filtered
 * locators, and `locator.waitFor({state:'visible'})`) rather than an
 * ad-hoc `page.waitForTimeout` loop. On failure we fall back to a
 * bounded DOM scan for up to three near-matches so the caller can see
 * what text IS on-screen.
 *
 * The in-page evaluators are passed as stringified JS bodies so we do
 * NOT need DOM lib types in tsconfig — the handler code stays strict
 * ES2022 + Node, while the browser-side code runs inside Playwright.
 */
import {
  AssertVisibleTextInputSchema,
  AssertVisibleTextOutputSchema,
  type AssertVisibleTextInput,
  type AssertVisibleTextOutput,
  type AssertVisibleTextNearestMatch,
} from '../schemas/index.js';

import type { ToolHandler } from './types.js';
import type { Locator, Page } from 'playwright';

const MAX_NEAREST = 3;

interface NearestMatchCandidate {
  locator: string;
  text: string;
  score: number;
}

function trigramSet(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.length < 3) return new Set([normalized]);
  const out = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    out.add(normalized.slice(i, i + 3));
  }
  return out;
}

/**
 * Cheap similarity score in [0,1] — jaccard over character trigrams.
 * Good enough to rank candidates for a helpful error message; we aren't
 * trying to be Lucene.
 */
function similarity(a: string, b: string): number {
  const ta = trigramSet(a);
  const tb = trigramSet(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  for (const g of ta) if (tb.has(g)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Body (not full function) of the locator-description evaluator. The
 * argument is the matched DOM element; the result is a short CSS path
 * the caller can plug back into other tool calls, or null.
 */
const BUILD_SELECTOR_SOURCE = `
if (!el || el.nodeType !== 1) return null;
const parts = [];
let cur = el;
let depth = 0;
while (cur && cur.nodeType === 1 && depth < 6) {
  const element = cur;
  let part = element.tagName.toLowerCase();
  const id = element.getAttribute && element.getAttribute('id');
  if (id) {
    parts.unshift(part + '#' + id);
    return parts.join(' > ');
  }
  const dataTest = element.getAttribute && element.getAttribute('data-testid');
  if (dataTest) {
    part += '[data-testid=' + JSON.stringify(dataTest) + ']';
    parts.unshift(part);
    return parts.join(' > ');
  }
  const parent = element.parentElement;
  if (parent) {
    const siblings = [];
    for (const c of parent.children) {
      if (c.tagName === element.tagName) siblings.push(c);
    }
    if (siblings.length > 1) {
      const idx = siblings.indexOf(element) + 1;
      part += ':nth-of-type(' + idx + ')';
    }
  }
  parts.unshift(part);
  cur = parent;
  depth++;
}
return parts.join(' > ');
`;

const DESCRIBE_TAG_TEXT_SOURCE = `
const tag = el.tagName.toLowerCase();
const text = (el.textContent || '').trim().slice(0, 40);
return { tag: tag, text: text };
`;

const COLLECT_CANDIDATES_SOURCE = `
const scope = arg.scope;
const needleLc = String(arg.needleLc || '').toLowerCase();
const root = document.querySelector(scope) || document.body;
if (!root) return [];
const results = [];
const seen = new Set();
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
let node = walker.nextNode();
while (node) {
  const parent = node.parentElement;
  const text = (node.textContent || '').trim();
  if (parent && text.length > 0 && text.length < 200 && !seen.has(parent)) {
    seen.add(parent);
    const tag = parent.tagName.toLowerCase();
    if (tag !== 'script' && tag !== 'style' && tag !== 'noscript') {
      results.push({ text: text, locator: tag });
    }
  }
  if (results.length >= 50) break;
  node = walker.nextNode();
}
results.sort((a, b) => {
  const aHit = a.text.toLowerCase().indexOf(needleLc) !== -1 ? 1 : 0;
  const bHit = b.text.toLowerCase().indexOf(needleLc) !== -1 ? 1 : 0;
  return bHit - aHit;
});
return results.slice(0, 20);
`;

/**
 * Wrap a function body so it can be passed to `locator.evaluate` /
 * `page.evaluate`. The body sees the element as `el` (for element
 * evaluators) or the argument as `arg` (for page-scoped evaluators).
 */
function makeElementFn<T>(source: string): (el: unknown) => T {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('el', source) as (el: unknown) => T;
}

function makePageFn<T>(source: string): (arg: unknown) => T {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('arg', source) as (arg: unknown) => T;
}

async function buildLocatorDescription(loc: Locator): Promise<string> {
  try {
    const path = await loc.evaluate(makeElementFn<string | null>(BUILD_SELECTOR_SOURCE));
    if (typeof path === 'string' && path.length > 0) return path;
  } catch {
    /* fall through */
  }
  try {
    const handle = await loc.elementHandle();
    if (!handle) return 'unknown';
    try {
      const info = await handle.evaluate(
        makeElementFn<{ tag: string; text: string }>(DESCRIBE_TAG_TEXT_SOURCE),
      );
      return info.text ? `${info.tag}[text="${info.text}"]` : info.tag;
    } finally {
      await handle.dispose();
    }
  } catch {
    return 'unknown';
  }
}

async function collectNearestMatches(
  page: Page,
  selector: string | undefined,
  needle: string,
): Promise<AssertVisibleTextNearestMatch[]> {
  const scopeSelector = selector ?? 'body';
  let candidates: Array<{ text: string; locator: string }> = [];
  try {
    const fn = makePageFn<Array<{ text: string; locator: string }>>(COLLECT_CANDIDATES_SOURCE);
    candidates = await page.evaluate(fn, { scope: scopeSelector, needleLc: needle });
  } catch {
    return [];
  }
  const scored: NearestMatchCandidate[] = candidates.map((c) => ({
    locator: c.locator,
    text: c.text,
    score: similarity(c.text, needle),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_NEAREST).map((c) => ({ locator: c.locator, text: c.text }));
}

export const electronAssertVisibleText: ToolHandler<
  AssertVisibleTextInput,
  AssertVisibleTextOutput
> = async (rawInput, ctx) => {
  const input = AssertVisibleTextInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  const started = Date.now();
  let textMatcher: string | RegExp = input.text;
  if (input.regex) {
    try {
      textMatcher = new RegExp(input.text);
    } catch (err) {
      const elapsedMs = Date.now() - started;
      return AssertVisibleTextOutputSchema.parse({
        ok: false,
        sessionId: session.id,
        elapsedMs,
        message: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies AssertVisibleTextOutput);
    }
  }

  // Build the locator:
  //   - selector → page.locator(selector).filter({ hasText })
  //   - no selector → page.getByText(textMatcher)
  //   - includeHidden → filter under a broad scope so visibility is not applied
  let locator: Locator;
  if (input.includeHidden) {
    const base = input.selector ? page.locator(input.selector) : page.locator('*');
    locator = base.filter({ hasText: textMatcher });
  } else if (input.selector) {
    locator = page.locator(input.selector).filter({ hasText: textMatcher });
  } else {
    locator = page.getByText(textMatcher);
  }
  const firstMatch = locator.first();

  try {
    if (input.includeHidden) {
      // `attached` still polls, but does not filter by visibility —
      // right semantics when the caller opted into includeHidden.
      await firstMatch.waitFor({ state: 'attached', timeout: input.timeoutMs });
    } else {
      await firstMatch.waitFor({ state: 'visible', timeout: input.timeoutMs });
    }
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const nearest = await collectNearestMatches(page, input.selector, input.text);
    ctx.sessions.touch(session);
    return AssertVisibleTextOutputSchema.parse({
      ok: false,
      sessionId: session.id,
      elapsedMs,
      nearestMatches: nearest,
      message:
        err instanceof Error
          ? `Text not ${input.includeHidden ? 'found' : 'visible'} within ${input.timeoutMs}ms: ${err.message}`
          : `Text not ${input.includeHidden ? 'found' : 'visible'} within ${input.timeoutMs}ms.`,
    } satisfies AssertVisibleTextOutput);
  }

  let matchedText: string | undefined;
  try {
    const raw = await firstMatch.textContent();
    if (raw !== null) matchedText = raw.trim();
  } catch {
    /* best-effort only */
  }
  const locatorDescription = await buildLocatorDescription(firstMatch);
  const elapsedMs = Date.now() - started;
  ctx.sessions.touch(session);

  return AssertVisibleTextOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    elapsedMs,
    locator: locatorDescription,
    ...(matchedText !== undefined ? { matchedText } : {}),
  } satisfies AssertVisibleTextOutput);
};
