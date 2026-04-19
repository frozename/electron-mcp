import { TimeoutError } from '../errors/index.js';

/**
 * Wrap a promise with a deadline. Rejects with `TimeoutError` if the
 * operation does not settle in time. Does NOT cancel the underlying work —
 * callers must still clean up if that matters (e.g. closing a session).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError(operation, timeoutMs));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
