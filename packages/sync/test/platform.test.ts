import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createFetchTransport, ensurePersistentStorage, storageLevel } from '../src/client';

describe('persistent storage', () => {
  it('asks for persistence and trusts only what persisted() says afterwards', async () => {
    const persist = vi.fn(async () => true);
    const refusing = {
      persisted: vi.fn(async () => false),
      persist,
      estimate: async () => ({ quota: 1e10, usage: 1e6 }),
    };
    expect(await ensurePersistentStorage(refusing)).toEqual({
      persisted: false,
      quota: 1e10,
      usage: 1e6,
      level: 'ok',
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(refusing.persisted).toHaveBeenCalledTimes(2);

    let granted = false;
    const granting = {
      persisted: async () => granted,
      persist: async () => {
        granted = true;
        return true;
      },
    };
    expect(await ensurePersistentStorage(granting)).toMatchObject({ persisted: true, level: 'unknown' });
  });

  it('reports null where there is no storage API (native builds) and survives a throwing one', async () => {
    expect(await ensurePersistentStorage(undefined)).toEqual({
      persisted: null,
      quota: null,
      usage: null,
      level: 'unknown',
    });
    const broken = {
      persisted: async () => {
        throw new Error('blocked');
      },
      estimate: async () => {
        throw new Error('blocked');
      },
    };
    expect(await ensurePersistentStorage(broken)).toMatchObject({ persisted: false, quota: null });
  });

  it('warns before the disk is full', () => {
    const GB = 1024 ** 3;
    expect(storageLevel(1 * GB, 10 * GB)).toBe('ok');
    expect(storageLevel(8 * GB, 10 * GB)).toBe('low');
    expect(storageLevel(100 * 1024 ** 2, 250 * 1024 ** 2)).toBe('low');
    expect(storageLevel(9.6 * GB, 10 * GB)).toBe('full');
    expect(storageLevel(null, 10)).toBe('unknown');
  });
});

describe('fetch transport', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('sends the device token and app version, and gzips large pushes', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json(200, { results: [] }),
    );
    const transport = createFetchTransport({
      getToken: () => 'sdt_abc',
      appVersion: '1.2.3',
      fetch,
      gzipAbove: 10,
    });
    const request = { contractVersion: 1, appVersion: '1.2.3', sentAt: 'x', documents: [] };
    expect(await transport.push(request)).toEqual({ ok: true, body: { results: [] } });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/v1/sync/push');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Device sdt_abc');
    expect(headers['X-App-Version']).toBe('1.2.3');
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(init!.body as Uint8Array).toString('utf8'))).toEqual(request);

    await transport.pull({ users: '0' }, 10);
    expect(fetch.mock.calls[1]![0]).toBe('/v1/sync/pull?cursors=%7B%22users%22%3A%220%22%7D&limit=10');
  });

  it('turns HTTP answers into what the loops act on', async () => {
    const cases: Array<[Response | Error, unknown]> = [
      [json(413, { error: { code: 'payload_too_large' } }), { ok: false, kind: 'too_large' }],
      [
        json(429, { error: { code: 'rate_limited' } }, { 'retry-after': '7' }),
        { ok: false, kind: 'busy', retryAfterMs: 7000 },
      ],
      [json(503, {}), { ok: false, kind: 'busy', retryAfterMs: null }],
      [json(401, { error: { code: 'unauthorized' } }), { ok: false, kind: 'unauthorized' }],
      [json(403, { error: { code: 'device_revoked' } }), { ok: false, kind: 'revoked' }],
      [json(500, {}), { ok: false, kind: 'server', status: 500 }],
      [
        json(400, { error: { code: 'validation_failed' } }),
        { ok: false, kind: 'refused', status: 400, code: 'validation_failed' },
      ],
      [new TypeError('Failed to fetch'), { ok: false, kind: 'network' }],
      [new Response('not json', { status: 200 }), { ok: false, kind: 'network' }],
    ];
    for (const [answer, expected] of cases) {
      const fetch = vi.fn(async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      });
      const transport = createFetchTransport({ getToken: () => 't', appVersion: '1', fetch });
      expect(await transport.resync(['users'])).toEqual(expected);
    }
  });

  it('does not call the server without a device token', async () => {
    const fetch = vi.fn();
    const transport = createFetchTransport({ getToken: () => null, appVersion: '1', fetch });
    expect(await transport.pull({})).toEqual({ ok: false, kind: 'unauthorized' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
