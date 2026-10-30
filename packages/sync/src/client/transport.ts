import type { PullResponse, PushRequest, PushResponse, ResyncResponse } from '../protocol';

/** How a request ended, in the terms the loops act on. */
export type TransportResult<T> =
  | { ok: true; body: T }
  /** No answer (offline, timeout, connection cut): try again with backoff */
  | { ok: false; kind: 'network' }
  /** 413: the batch is too large, split it */
  | { ok: false; kind: 'too_large' }
  /** 429 or 503: the server asks to wait */
  | { ok: false; kind: 'busy'; retryAfterMs: number | null }
  /** Other 5xx */
  | { ok: false; kind: 'server'; status: number }
  /** 401: the device token is not valid (anymore) */
  | { ok: false; kind: 'unauthorized' }
  /** 403 device_revoked: stop pulling, send what is left, then wipe */
  | { ok: false; kind: 'revoked' }
  /** Another 4xx: the request itself is wrong (a bug); retrying the same will not help */
  | { ok: false; kind: 'refused'; status: number; code: string | null };

export interface SyncTransport {
  push(request: PushRequest): Promise<TransportResult<PushResponse>>;
  pull(cursors: Record<string, string>, limit?: number): Promise<TransportResult<PullResponse>>;
  resync(sets: string[]): Promise<TransportResult<ResyncResponse>>;
}

export interface FetchTransportOptions {
  /** API origin, '' for same-origin */
  baseUrl?: string;
  /** The device token, read on every request so a re-activation takes effect at once */
  getToken: () => string | null | Promise<string | null>;
  appVersion: string;
  fetch?: typeof globalThis.fetch;
  /** gzip push bodies above this size (bytes) when CompressionStream exists; default 8 KiB */
  gzipAbove?: number;
  timeoutMs?: number;
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function retryAfter(res: Response): number | null {
  const value = Number(res.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

/** HTTP transport over fetch: `Authorization: Device <token>`, gzip push bodies, explicit 413. */
export function createFetchTransport(options: FetchTransportOptions): SyncTransport {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const gzipAbove = options.gzipAbove ?? 8 * 1024;
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function request<T>(
    path: string,
    init: { method: string; body?: string },
  ): Promise<TransportResult<T>> {
    const token = await options.getToken();
    if (!token) return { ok: false, kind: 'unauthorized' };
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Device ${token}`,
      'X-App-Version': options.appVersion,
    };
    let body: RequestInit['body'];
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      const compressed = init.body.length > gzipAbove ? await gzip(init.body) : null;
      if (compressed) {
        headers['Content-Encoding'] = 'gzip';
        body = compressed as RequestInit['body'];
      } else {
        body = init.body;
      }
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init.method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, kind: 'network' };
    }
    if (res.ok) {
      try {
        return { ok: true, body: (await res.json()) as T };
      } catch {
        return { ok: false, kind: 'network' };
      }
    }
    const error = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    const code = error?.error?.code ?? null;
    if (res.status === 413) return { ok: false, kind: 'too_large' };
    if (res.status === 429 || res.status === 503)
      return { ok: false, kind: 'busy', retryAfterMs: retryAfter(res) };
    if (res.status === 401) return { ok: false, kind: 'unauthorized' };
    if (res.status === 403 && code === 'device_revoked') return { ok: false, kind: 'revoked' };
    if (res.status >= 500) return { ok: false, kind: 'server', status: res.status };
    return { ok: false, kind: 'refused', status: res.status, code };
  }

  return {
    push: (req) => request<PushResponse>('/v1/sync/push', { method: 'POST', body: JSON.stringify(req) }),
    pull: (cursors, limit) => {
      const params = new URLSearchParams({ cursors: JSON.stringify(cursors) });
      if (limit !== undefined) params.set('limit', String(limit));
      return request<PullResponse>(`/v1/sync/pull?${params.toString()}`, { method: 'GET' });
    },
    resync: (sets) =>
      request<ResyncResponse>('/v1/sync/resync', { method: 'POST', body: JSON.stringify({ sets }) }),
  };
}
