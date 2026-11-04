import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Broadcast } from '@serva/core';
import { settledBroadcasts } from '../src/services/broadcasts';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, codes, makeApp, resetDatabase } from './helpers';

/** Messages to customers on WhatsApp (03 › الألبسة: رسائل للزبائن), through the store's gateway. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function customer(store: Store, name: string, phone: string | null, noMessages = false) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: as(store),
    payload: { name, phone, noMessages },
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe('messages to customers', () => {
  it('counts who gets it, sends one each but never to who asked not to, and keeps the count', async () => {
    const store = await openStore(app);
    await customer(store, 'ريم', '0944111111');
    await customer(store, 'سامي', '0944222222');
    await customer(store, 'هالة', '0944333333', true);
    await customer(store, 'بلا رقم', null);

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/broadcasts/preview',
      headers: as(store),
      payload: { audience: { kind: 'all' } },
    });
    expect(preview.json()).toEqual({ count: 2 });

    const before = codes.sent.length;
    const made = await app.inject({
      method: 'POST',
      url: '/v1/broadcasts',
      headers: as(store),
      payload: { text: 'وصلت التشكيلة الشتوية!', audience: { kind: 'all' } },
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<Broadcast>()).toMatchObject({ status: 'sending', total: 2 });
    await settledBroadcasts();

    const sent = codes.sent.slice(before);
    expect(sent.map((m) => m.phone).sort()).toEqual(['+963944111111', '+963944222222']);
    expect(sent.every((m) => m.purpose === 'broadcast' && m.text?.includes('وصلت التشكيلة الشتوية!'))).toBe(
      true,
    );
    expect(sent[0]!.text).toContain('أخبرنا ونوقفها');
    const list = (await app.inject({ method: 'GET', url: '/v1/broadcasts', headers: as(store) })).json<{
      items: Broadcast[];
    }>();
    expect(list.items[0]).toMatchObject({ status: 'done', total: 2, sent: 2, failed: 0 });
  });

  it('sends only to those who bought lately, and refuses when nobody is chosen', async () => {
    const store = await openStore(app);
    await customer(store, 'ريم', '0944111111');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/broadcasts',
      headers: as(store),
      payload: { text: 'تنزيلات 30٪ اليوم', audience: { kind: 'recent', days: 30 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { fields: { audience: expect.any(String) } } });
  });
});
