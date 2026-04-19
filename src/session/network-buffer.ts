import type { ElectronApplication, Page, Request as PWRequest, Response } from 'playwright';

import type { NetworkEntry } from '../schemas/index.js';
import type { NetworkBuffer, Session } from './types.js';

const DEFAULT_CAPACITY = 500;

export function createNetworkBuffer(capacity = DEFAULT_CAPACITY): NetworkBuffer {
  return {
    capacity,
    entries: [],
    dropped: 0,
    instrumented: new WeakSet<Page>(),
    started: new WeakMap<PWRequest, number>(),
  };
}

function push(buffer: NetworkBuffer, entry: NetworkEntry): void {
  buffer.entries.push(entry);
  while (buffer.entries.length > buffer.capacity) {
    buffer.entries.shift();
    buffer.dropped += 1;
  }
}

function windowIndex(app: ElectronApplication, page: Page): number | undefined {
  const i = app.windows().indexOf(page);
  return i >= 0 ? i : undefined;
}

async function buildEntry(
  session: Session,
  page: Page,
  request: PWRequest,
  response: Response | null,
  failureText: string | null,
): Promise<NetworkEntry> {
  const started = session.networkBuffer.started.get(request);
  const now = Date.now();
  const entry: NetworkEntry = {
    ts: new Date(now).toISOString(),
    method: request.method(),
    url: request.url(),
  };
  if (started !== undefined) entry.durationMs = Math.max(0, now - started);
  const resourceType = request.resourceType();
  if (resourceType) entry.resourceType = resourceType;
  const idx = windowIndex(session.app, page);
  if (idx !== undefined) entry.windowIndex = idx;

  try {
    const postData = request.postData();
    if (postData) entry.requestSizeBytes = Buffer.byteLength(postData, 'utf8');
  } catch {
    /* ignore — body not available after teardown */
  }

  if (response) {
    entry.status = response.status();
    entry.statusText = response.statusText();
    try {
      entry.fromCache = response.fromServiceWorker() || false;
    } catch {
      /* ignore */
    }
    try {
      const body = await response.body().catch(() => null);
      if (body) entry.responseSizeBytes = body.byteLength;
    } catch {
      /* ignore */
    }
  }

  if (failureText) {
    entry.failed = true;
    entry.failureText = failureText;
  }

  return entry;
}

export function instrumentPageForNetwork(session: Session, page: Page): void {
  const buffer = session.networkBuffer;
  if (buffer.instrumented.has(page)) return;
  buffer.instrumented.add(page);

  page.on('request', (req) => {
    buffer.started.set(req, Date.now());
  });
  page.on('response', (res) => {
    const req = res.request();
    void (async () => {
      try {
        push(buffer, await buildEntry(session, page, req, res, null));
      } catch {
        /* ignore */
      }
    })();
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    const text = failure?.errorText ?? 'request failed';
    void (async () => {
      try {
        push(buffer, await buildEntry(session, page, req, null, text));
      } catch {
        /* ignore */
      }
    })();
  });
}

export function instrumentSessionForNetwork(session: Session): void {
  for (const page of session.app.windows()) {
    instrumentPageForNetwork(session, page);
  }
  session.app.on('window', (page: Page) => {
    instrumentPageForNetwork(session, page);
  });
}
