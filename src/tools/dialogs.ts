import {
  ElectronDialogPolicyInputSchema,
  ElectronDialogPolicyOutputSchema,
  type ElectronDialogPolicyInput,
  type ElectronDialogPolicyOutput,
} from '../schemas/index.js';
import { setDialogPolicy } from '../session/dialog-policy.js';

import { syncToolHandler } from './types.js';

export const electronDialogPolicy = syncToolHandler<
  ElectronDialogPolicyInput,
  ElectronDialogPolicyOutput
>((rawInput, ctx) => {
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
});
