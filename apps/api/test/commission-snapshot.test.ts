import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MerchandiseReport, SalePayload, SalesBreakdown } from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** A sale keeps the seller's commission rate it was made with: a later rate change never re-prices it. */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

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
const RANGE = 'from=2026-10-01&to=2026-10-30';

describe('commission snapshot', () => {
  it('stays with the sale after the rate changes; new sales take the new rate', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    await push(app, store.device, [open]);
    const sell = async () => {
      const payload = sale(store, open.id, {
        lines: [cartLine(1, 100_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000 }],
      }) as SalePayload;
      const pushed = await push(app, store.device, [doc('sale', payload)]);
      expect(pushed.results.map((r) => r.status)).toEqual(['accepted']);
    };
    const report = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/reports/sales-breakdown?${RANGE}&by=seller`,
          headers: as(store),
        })
      ).json<SalesBreakdown>();

    // Sale 1 at 2.5%
    await ownerDb()`update users set commission_bp = 250 where id = ${store.userId}`;
    await sell();
    const snap = await ownerDb()`select commission_bp from invoices where tenant_id = ${store.tenantId}`;
    expect(snap.map((r) => r.commission_bp)).toEqual([250]);
    expect((await report()).rows[0]).toMatchObject({ commissionBp: 250, commissionMinor: 2_500 });

    // The rate becomes 10%: sale 1 is untouched
    await ownerDb()`update users set commission_bp = 1000 where id = ${store.userId}`;
    const after = await report();
    expect(after.rows[0]).toMatchObject({ commissionBp: 250, commissionMinor: 2_500 });
    expect(after.commissionTotalMinor).toBe(2_500);

    // Sale 2 takes the new rate: 2.5% of 1,000 + 10% of 1,000
    await sell();
    const mixed = await report();
    expect(mixed.rows[0]).toMatchObject({ commissionBp: 625, commissionMinor: 12_500 });
    expect(mixed.commissionTotalMinor).toBe(12_500);
    const merch = (
      await app.inject({
        method: 'GET',
        url: `/v1/reports/merchandise?${RANGE}`,
        headers: as(store),
      })
    ).json<MerchandiseReport>();
    expect(merch.bySeller[0]).toMatchObject({ commissionBp: 625 });
  });

  it('falls back to the current rate where a sale has no snapshot', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [cartLine(1, 100_000)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000 }],
    }) as SalePayload;
    await push(app, store.device, [open, doc('sale', payload)]);
    expect(
      (await ownerDb()`select commission_bp from invoices where tenant_id = ${store.tenantId}`)[0]!
        .commission_bp,
    ).toBeNull();
    await ownerDb()`update users set commission_bp = 400 where id = ${store.userId}`;
    const r = (
      await app.inject({
        method: 'GET',
        url: `/v1/reports/sales-breakdown?${RANGE}&by=seller`,
        headers: as(store),
      })
    ).json<SalesBreakdown>();
    expect(r.rows[0]).toMatchObject({ commissionBp: 400, commissionMinor: 4_000 });
  });
});
