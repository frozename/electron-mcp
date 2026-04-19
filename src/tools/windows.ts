import {
  ElectronFocusWindowInputSchema,
  ElectronListWindowsInputSchema,
  ElectronListWindowsOutputSchema,
  ElectronWaitForWindowInputSchema,
  type ElectronFocusWindowInput,
  type ElectronListWindowsInput,
  type ElectronListWindowsOutput,
  type ElectronWaitForWindowInput,
  type OkWithSession,
} from '../schemas/index.js';
import { ValidationError } from '../errors/index.js';

import type { ToolHandler } from './types.js';

export const electronListWindows: ToolHandler<
  ElectronListWindowsInput,
  ElectronListWindowsOutput
> = async (rawInput, ctx) => {
  const input = ElectronListWindowsInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const windows = await ctx.adapter.listWindows(session.app);
  ctx.sessions.touch(session);
  return ElectronListWindowsOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    windows,
  });
};

export const electronFocusWindow: ToolHandler<
  ElectronFocusWindowInput,
  OkWithSession & { index: number }
> = async (rawInput, ctx) => {
  const input = ElectronFocusWindowInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const page = await ctx.adapter.resolveWindow(session.app, input.window);
  await page.bringToFront();
  ctx.sessions.touch(session);

  const idx = session.app.windows().indexOf(page);
  return {
    ok: true,
    sessionId: session.id,
    index: idx >= 0 ? idx : 0,
  };
};

export const electronWaitForWindow: ToolHandler<
  ElectronWaitForWindowInput,
  OkWithSession & { index: number; url: string; title: string }
> = async (rawInput, ctx) => {
  const input = ElectronWaitForWindowInputSchema.parse(rawInput);
  if (!input.urlPattern && !input.titlePattern && input.index === undefined) {
    throw new ValidationError(
      'electron_wait_for_window requires at least one of urlPattern, titlePattern, or index',
    );
  }
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;

  const predicate: Parameters<typeof ctx.adapter.waitForWindow>[1] = {};
  if (input.urlPattern !== undefined) predicate.urlPattern = input.urlPattern;
  if (input.titlePattern !== undefined) predicate.titlePattern = input.titlePattern;
  if (input.index !== undefined) predicate.index = input.index;

  const page = await ctx.adapter.waitForWindow(session.app, predicate, timeoutMs);
  const idx = session.app.windows().indexOf(page);
  let title = '';
  try {
    title = await page.title();
  } catch {
    title = '';
  }
  ctx.sessions.touch(session);
  return {
    ok: true,
    sessionId: session.id,
    index: idx >= 0 ? idx : 0,
    url: page.url(),
    title,
  };
};
