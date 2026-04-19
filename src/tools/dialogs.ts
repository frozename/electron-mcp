import {
  ElectronDialogPolicyInputSchema,
  ElectronDialogPolicyOutputSchema,
  type ElectronDialogPolicyInput,
  type ElectronDialogPolicyOutput,
} from '../schemas/index.js';
import { setDialogPolicy } from '../session/dialog-policy.js';

import type { ToolHandler } from './types.js';

export const electronDialogPolicy: ToolHandler<
  ElectronDialogPolicyInput,
  ElectronDialogPolicyOutput
> = async (rawInput, ctx) => {
  const input = ElectronDialogPolicyInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  setDialogPolicy(session, input.policy, input.promptText);
  ctx.sessions.touch(session);

  return ElectronDialogPolicyOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    policy: input.policy,
    handled: session.dialog.handled,
  });
};
