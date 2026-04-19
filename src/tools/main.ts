import { PermissionDeniedError } from '../errors/index.js';
import {
  ElectronEvaluateMainInputSchema,
  EvaluateOutputSchema,
  type ElectronEvaluateMainInput,
  type EvaluateOutput,
} from '../schemas/index.js';

import type { ToolHandler } from './types.js';

export const electronEvaluateMain: ToolHandler<ElectronEvaluateMainInput, EvaluateOutput> = async (
  rawInput,
  ctx,
) => {
  if (!ctx.config.allowMainEvaluate) {
    throw new PermissionDeniedError(
      'Main-process evaluation is disabled. Set ELECTRON_MCP_ALLOW_MAIN_EVALUATE=true to enable.',
    );
  }

  const input = ElectronEvaluateMainInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.evaluateTimeoutMs;

  const result = await ctx.adapter.evaluateMain(
    session.app,
    input.expression,
    input.arg,
    timeoutMs,
  );
  ctx.sessions.touch(session);

  return EvaluateOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    result,
  });
};
