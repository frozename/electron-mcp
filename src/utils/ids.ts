import { randomUUID } from 'node:crypto';

export function newSessionId(): string {
  return `sess_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
