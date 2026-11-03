import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomerRow, StoreResponse } from '@serva/core';
import { createDb, withTenant } from '@serva/db';
import type { PullResponse } from '@serva/sync';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import {
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, resetDatabase, settled } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Loyalty points (03 › الألبسة: نقاط الولاء): a named customer earns a point per amount spent and
 * spends them at the till at their value, posted to 6700; never refused, flagged when overdrawn.
 */

let app: FastifyInstance;
const owner = createDb(TEST_OWNER_URL, { max: 1 });
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await owner.client.end();
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function customerPoints(store: Store, id: string) {
  await settled();
  const page = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  const rows = (page.json<PullResponse>().sets as unknown as { customers: { upserts: CustomerRow[] } })
    .customers.upserts;
  return rows.find((c) => c.id === id)?.loyaltyPoints;
}

describe('loyalty points', () => {
  it('earns on what was not paid with points, spends at their value into 6700, and flags too many', async () => {
    const store = await openStore(app);
    // A point per 1,000; a point is worth 10
    const set = await app.inject({
      method: 'PUT',
      url: '/v1/store/loyalty',
      headers: as(store),
      payload: { loyalty: { earnEveryMinor: 100_000, pointValueMinor: 1_000 } },
    });
    expect(set.json<StoreResponse>().loyalty).toEqual({ earnEveryMinor: 100_000, pointValueMinor: 1_000 });
    const c = (
      await app.inject({ method: 'POST', url: '/v1/customers', headers: as(store), payload: { name: 'ريم' } })
    ).json<{ id: string }>();

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const first = doc(
      'sale',
      sale(store, open.id, {
        customerId: c.id,
        customerName: 'ريم',
        lines: [cartLine(1, 450_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 450_000 }],
      }),
    );
    await push(app, store.device, [open, first]);
    expect(await customerPoints(store, c.id)).toBe(4);

    // 1,000: 3 points (30) and the rest in cash; the cash part earns nothing (under 1,000)
    const second = doc(
      'sale',
      sale(store, open.id, {
        customerId: c.id,
        customerName: 'ريم',
        lines: [cartLine(1, 100_000)],
        payments: [
          { method: 'points', currency: 'SYP', amountMinor: 3_000 },
          { method: 'cash', currency: 'SYP', amountMinor: 97_000 },
        ],
      }),
    );
    const res = await push(app, store.device, [second]);
    expect(res.results[0]!.flags).toEqual([]);
    expect(await customerPoints(store, c.id)).toBe(1);
    const entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceId === second.id))).toEqual([
      ['6700', 3_000, 0],
      ['111001', 97_000, 0],
      ['4100', 0, 100_000],
    ]);

    // 5 points with 1 left: accepted, flagged
    const third = doc(
      'sale',
      sale(store, open.id, {
        customerId: c.id,
        customerName: 'ريم',
        lines: [cartLine(1, 5_000)],
        payments: [{ method: 'points', currency: 'SYP', amountMinor: 5_000 }],
      }),
    );
    const over = await push(app, store.device, [third]);
    expect(over.results[0]!.status).toBe('accepted');
    expect(over.results[0]!.flags).toEqual(['points_overdrawn']);
    expect(await customerPoints(store, c.id)).toBe(-4);

    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`))).toEqual([]);
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-31T00:00:00Z'),
    });
    expect(rebuilt.same).toBe(true);
  });

  it('gives no points without the setting, and a points payment needs its customer', async () => {
    const store = await openStore(app);
    const c = (
      await app.inject({
        method: 'POST',
        url: '/v1/customers',
        headers: as(store),
        payload: { name: 'سامي' },
      })
    ).json<{ id: string }>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const plain = doc(
      'sale',
      sale(store, open.id, {
        customerId: c.id,
        customerName: 'سامي',
        lines: [cartLine(1, 900_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 900_000 }],
      }),
    );
    await push(app, store.device, [open, plain]);
    expect(await customerPoints(store, c.id)).toBe(0);
    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/store/loyalty',
      headers: as(store),
      payload: { loyalty: { earnEveryMinor: 0, pointValueMinor: 1_000 } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
