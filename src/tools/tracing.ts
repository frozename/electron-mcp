import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';

import {
  ElectronTraceStartInputSchema,
  ElectronTraceStartOutputSchema,
  ElectronTraceStopInputSchema,
  ElectronTraceStopOutputSchema,
  type ElectronTraceStartInput,
  type ElectronTraceStartOutput,
  type ElectronTraceStopInput,
  type ElectronTraceStopOutput,
} from '../schemas/index.js';
import { ValidationError } from '../errors/index.js';

import type { ToolHandler } from './types.js';

export const electronTraceStart: ToolHandler<
  ElectronTraceStartInput,
  ElectronTraceStartOutput
> = async (rawInput, ctx) => {
  const input = ElectronTraceStartInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  if (session.tracingActive) {
    throw new ValidationError('Tracing is already active for this session. Call trace_stop first.');
  }
  const opts: Parameters<typeof ctx.adapter.traceStart>[1] = {
    screenshots: input.screenshots,
    snapshots: input.snapshots,
    sources: input.sources,
  };
  if (input.title !== undefined) opts.title = input.title;
  await ctx.adapter.traceStart(session.app, opts);
  session.tracingActive = true;
  ctx.sessions.touch(session);

  return ElectronTraceStartOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    tracing: true,
  });
};

export const electronTraceStop: ToolHandler<
  ElectronTraceStopInput,
  ElectronTraceStopOutput
> = async (rawInput, ctx) => {
  const input = ElectronTraceStopInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  if (!session.tracingActive) {
    throw new ValidationError('Tracing is not active for this session.');
  }
  const absolute = path.resolve(input.path);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await ctx.adapter.traceStop(session.app, absolute);
  session.tracingActive = false;

  let byteLength = 0;
  try {
    byteLength = statSync(absolute).size;
  } catch {
    /* file may not exist if Playwright wrote to a different path */
  }
  ctx.sessions.touch(session);

  return ElectronTraceStopOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    path: absolute,
    byteLength,
  });
};
