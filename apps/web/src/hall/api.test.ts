import { describe, expect, it, vi } from 'vitest';
import { createHallApi } from './api';

const TOKEN = `sdt_${'a'.repeat(43)}`;

function api(respond: () => Response | Promise<Response>) {
  const fetchFn = vi.fn(async () => respond());
  return { api: createHallApi(TOKEN, fetchFn as unknown as typeof fetch), fetchFn };
}

describe('the hall client', () => {
  it('calls the five endpoints with the device token and sends commands as JSON', async () => {
    const { api: hall, fetchFn } = api(() => new Response('{"orders":[]}', { status: 200 }));
    await hall.hall();
    await hall.kitchen();
    await hall.menu();
    await hall.command({ type: 'send', userId: 'u', orderId: 'o' } as never);
    await hall.kitchenCommand({ type: 'ack', lineIds: ['l'] } as never);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET /v1/device/hall',
      'GET /v1/device/kitchen',
      'GET /v1/device/menu',
      'POST /v1/device/hall',
      'POST /v1/device/kitchen',
    ]);
    const [, post] = calls[3]!;
    expect((post.headers as Record<string, string>).Authorization).toBe(`Device ${TOKEN}`);
    expect(JSON.parse(String(post.body))).toEqual({ type: 'send', userId: 'u', orderId: 'o' });
  });

  it('returns the body, a refusal with its first field message and code, or no network', async () => {
    expect(await api(() => new Response('{"a":1}', { status: 200 })).api.hall()).toEqual({
      kind: 'ok',
      body: { a: 1 },
    });
    const fields = await api(
      () =>
        new Response('{"error":{"code":"validation_failed","message":"x","fields":{"table":"لا طاولة"}}}', {
          status: 400,
        }),
    ).api.command({ type: 'open', userId: 'u', table: '9' } as never);
    expect(fields).toEqual({ kind: 'refused', message: 'لا طاولة', code: 'validation_failed', status: 400 });
    const locked = await api(
      () => new Response('{"error":{"code":"locked","message":"مغلق","retryAfter":30}}', { status: 429 }),
    ).api.hall();
    expect(locked).toEqual({
      kind: 'refused',
      message: 'مغلق',
      code: 'locked',
      status: 429,
      retryAfterSeconds: 30,
    });
    const bare = await api(() => new Response('{"error":{}}', { status: 403 })).api.hall();
    expect(bare).toMatchObject({ kind: 'refused', message: 'رُفض الطلب.', code: null });
    expect(await api(() => new Response('oops', { status: 502 })).api.hall()).toEqual({ kind: 'network' });
    expect(await api(() => new Response('not json', { status: 400 })).api.hall()).toEqual({
      kind: 'network',
    });
    expect(
      await api(() => {
        throw new TypeError('Failed to fetch');
      }).api.hall(),
    ).toEqual({ kind: 'network' });
  });
});
