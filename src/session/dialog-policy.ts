import type { Dialog, Page } from 'playwright';

import type { DialogPolicy, Session } from './types.js';

export function createDialogState(): Session['dialog'] {
  return {
    policy: 'none',
    handled: 0,
    instrumented: new WeakSet<Page>(),
  };
}

/**
 * Apply the session's current dialog policy to one Playwright dialog.
 * Called from the `page.on('dialog', …)` listener.
 */
async function handleDialog(session: Session, dialog: Dialog): Promise<void> {
  const state = session.dialog;
  const type = dialog.type();
  state.handled += 1;
  try {
    switch (state.policy) {
      case 'accept':
        await dialog.accept(state.promptText ?? '');
        return;
      case 'dismiss':
        await dialog.dismiss();
        return;
      case 'auto':
        if (type === 'alert') {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
        return;
      case 'none':
      default:
        // Leave the dialog pending. Playwright will still block the page
        // until something calls accept()/dismiss(). A human debugger can
        // act on it via devtools.
        return;
    }
  } catch {
    /* dialog already handled or page closed — ignore */
  }
}

/** Wire a single page. Idempotent via the WeakSet. */
export function instrumentPageForDialogs(session: Session, page: Page): void {
  if (session.dialog.instrumented.has(page)) return;
  session.dialog.instrumented.add(page);
  page.on('dialog', (dialog) => {
    void handleDialog(session, dialog);
  });
}

/** Attach dialog listeners to every current + future page. */
export function instrumentSessionForDialogs(session: Session): void {
  for (const page of session.app.windows()) {
    instrumentPageForDialogs(session, page);
  }
  session.app.on('window', (page: Page) => {
    instrumentPageForDialogs(session, page);
  });
}

export function setDialogPolicy(
  session: Session,
  policy: DialogPolicy,
  promptText: string | undefined,
): void {
  session.dialog.policy = policy;
  if (promptText !== undefined) {
    session.dialog.promptText = promptText;
  } else if (policy === 'none') {
    delete session.dialog.promptText;
  }
}
