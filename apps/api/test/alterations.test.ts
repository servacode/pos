import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AlterationTicket } from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Alteration tickets (03 › الألبسة: التعديل والتقصير): made at the till, followed until collected. */

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

const till = (store: Store) => ({ authorization: store.device.authorization });

const ticket = (store: Store, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/alterations',
    headers: till(store),
    payload: {
      customerName: 'سلمى',
      phone: '0933111222',
      item: 'بنطال جينز أسود',
      work: 'تقصير 3 سم',
      priceMinor: 150_000,
      dueDate: '2026-11-06',
      note: null,
      ...extra,
    },
  });

const open = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/device/alterations', headers: till(store) })).json<{
    items: AlterationTicket[];
  }>().items;

describe('alteration tickets', () => {
  it('numbers each ticket, lists the open ones soonest first, and follows it to collected', async () => {
    const store = await openStore(app);
    const first = await ticket(store);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<AlterationTicket>()).toMatchObject({
      number: 'ALT-000001',
      status: 'received',
      phone: '+963933111222',
      priceMinor: 150_000,
      currency: 'SYP',
    });
    await ticket(store, { item: 'فستان', work: 'تضييق الخصر', dueDate: '2026-11-04' });
    expect((await open(store)).map((t) => t.number)).toEqual(['ALT-000002', 'ALT-000001']);

    const t = first.json<AlterationTicket>();
    const ready = await app.inject({
      method: 'POST',
      url: `/v1/device/alterations/${t.id}/status`,
      headers: till(store),
      payload: { status: 'ready', version: t.version },
    });
    expect(ready.json<AlterationTicket>()).toMatchObject({ status: 'ready', readyAt: expect.any(String) });
    // Stale: refused
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/device/alterations/${t.id}/status`,
      headers: till(store),
      payload: { status: 'delivered', version: t.version },
    });
    expect(stale.statusCode).toBe(409);
    const done = await app.inject({
      method: 'POST',
      url: `/v1/device/alterations/${t.id}/status`,
      headers: till(store),
      payload: { status: 'delivered', version: ready.json<AlterationTicket>().version },
    });
    expect(done.json<AlterationTicket>().status).toBe('delivered');
    // Collected: off the open list, still in «all»; never back
    expect((await open(store)).map((x) => x.number)).toEqual(['ALT-000002']);
    const all = (
      await app.inject({ method: 'GET', url: '/v1/device/alterations?status=all', headers: till(store) })
    ).json<{ items: AlterationTicket[] }>();
    expect(all.items).toHaveLength(2);
    const back = await app.inject({
      method: 'POST',
      url: `/v1/device/alterations/${t.id}/status`,
      headers: till(store),
      payload: { status: 'ready', version: done.json<AlterationTicket>().version },
    });
    expect(back.statusCode).toBe(400);
    // Nothing posts
    const [entries] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    expect(entries!.n).toBe(0);
  });

  it('refuses a ticket without the piece or the work', async () => {
    const store = await openStore(app);
    expect((await ticket(store, { item: '' })).statusCode).toBe(400);
    expect((await ticket(store, { work: '' })).statusCode).toBe(400);
  });
});
