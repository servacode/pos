import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type DayReport, type ShiftReport } from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { createDb, withTenant } from '@serva/db';
import {
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
} from './accounting-fixtures';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Round 21 (D1): a cash refund is rounded to the cash step like a cash sale; the difference posts
 * to 6400, the drawer expects the rounded amount. A refund from an older till (exact, no rounding)
 * posts exactly as before.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
const owner = createDb(TEST_OWNER_URL, { max: 1 });
afterAll(async () => {
  await owner.client.end();
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

async function aDay(cashStepMinor: number | undefined) {
  const store = await openStore(app);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const payload = sale(store, open.id, {
    lines: [cartLine(1, 71_250, { name: 'جاكيت' })], // 712.50
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 71_250 }],
  });
  const sold = doc('sale', payload);
  const built = buildReturnPayload({
    sale: payload,
    saleId: sold.id,
    saleNumber: sold.number!,
    shiftId: open.id,
    cashierId: store.userId,
    reason: 'تالف',
    picks: [{ saleLineNo: 1, qty: 1000 }],
    ...(cashStepMinor ? { cashStepMinor } : {}),
  });
  const { hash: _h, ...body } = doc('return', built);
  const ret: SyncDocument = { ...body, deps: [sold.id], hash: payloadHash({ ...body, deps: [sold.id] }) };
  await push(app, store.device, [open, sold, ret]);
  return { store, shiftId: open.id, ret };
}

const entryOf = async (tenantId: string) =>
  (await postedEntries(tenantId)).find((e) => e.sourceType === 'return');

describe('a cash refund rounded to the cash step', () => {
  it('pays 710 from the drawer, posts the 2.50 to 6400 and keeps every book balanced', async () => {
    const { store, shiftId } = await aDay(1000);
    const entry = await entryOf(store.tenantId);
    expect(compact(entry)).toEqual([
      ['4100', 71_250, 0],
      ['111001', 0, 71_000],
      ['6400', 0, 250],
    ]);
    expect(entry?.total).toBe(71_250);

    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-30T12:00:00.000Z'),
    });
    expect(rebuilt).toMatchObject({ same: true, failed: [], replayed: 3 });

    const headers = { authorization: `Bearer ${store.accessToken}` };
    const shift = (
      await app.inject({ method: 'GET', url: `/v1/shifts/${shiftId}`, headers })
    ).json<ShiftReport>();
    // Opening 1,000.00 + 712.50 in − 710.00 back
    expect(shift.byCurrency[0]).toMatchObject({
      currency: 'SYP',
      cashSalesMinor: 71_250,
      refundsMinor: 71_000,
      expectedMinor: 100_000 + 71_250 - 71_000,
    });
    expect(shift).toMatchObject({ returnsTotalMinor: 71_250 });
    const day = (
      await app.inject({ method: 'GET', url: '/v1/reports/day?date=2026-10-30', headers })
    ).json<DayReport>();
    expect(day.returns).toMatchObject({
      totalMinor: 71_250,
      byMethod: [{ method: 'cash', currency: 'SYP', amountMinor: 71_000, count: 1 }],
    });
  });

  it('a refund an older till made (exact, no rounding) posts as it always did', async () => {
    const { store, shiftId } = await aDay(undefined);
    const entry = await entryOf(store.tenantId);
    expect(compact(entry)).toEqual([
      ['4100', 71_250, 0],
      ['111001', 0, 71_250],
    ]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
    const headers = { authorization: `Bearer ${store.accessToken}` };
    const shift = (
      await app.inject({ method: 'GET', url: `/v1/shifts/${shiftId}`, headers })
    ).json<ShiftReport>();
    expect(shift.byCurrency[0]).toMatchObject({ refundsMinor: 71_250, expectedMinor: 100_000 });
    void ownerDb;
  });
});
