import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type PullSetRows } from '@serva/core';
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
 * Exchange vouchers (03 › الملابس: قسيمة الاستبدال): a return refunded as a voucher pays nothing out
 * and owes it in 2310; a later sale spends it by its code, the return's number.
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

/** A shirt sold for 450, then returned on a voucher */
async function exchangeDay(store: Store) {
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const soldPayload = sale(store, open.id, {
    lines: [cartLine(1, 45_000, { name: 'قميص M' })],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 45_000 }],
  });
  const sold = doc('sale', soldPayload);
  const ret = doc(
    'return',
    buildReturnPayload({
      sale: soldPayload,
      saleId: sold.id,
      saleNumber: sold.number!,
      shiftId: open.id,
      cashierId: store.userId,
      reason: 'المقاس صغير',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      refundMethod: 'voucher',
    }),
  );
  const res = await push(app, store.device, [open, sold, ret]);
  expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
  return { doc, open, sold, ret };
}

const spend = (store: Store, shiftId: string, code: string, price: number, voucher: number, cash = 0) =>
  sale(store, shiftId, {
    lines: [cartLine(1, price, { name: 'قميص L' })],
    payments: [
      { method: 'voucher', currency: 'SYP', amountMinor: voucher, reference: code },
      ...(cash > 0 ? [{ method: 'cash' as const, currency: 'SYP' as const, amountMinor: cash }] : []),
    ],
  });

describe('exchange vouchers', () => {
  it('a voucher return owes the amount in 2310, every till pulls it, and a sale spends it', async () => {
    const store = await openStore(app);
    const { doc, open, ret } = await exchangeDay(store);
    let entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceId === ret.id))).toEqual([
      ['4100', 45_000, 0],
      ['2310', 0, 45_000],
    ]);

    await settled();
    const pulled = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    const sets = pulled.json<PullResponse>().sets as unknown as {
      vouchers: { upserts: PullSetRows['vouchers'][] };
    };
    expect(sets.vouchers.upserts).toEqual([
      expect.objectContaining({ code: ret.number, amountMinor: 45_000, redeemedMinor: 0, currency: 'SYP' }),
    ]);

    // The other size costs 500: 450 from the voucher, 50 in cash
    const exchange = doc('sale', spend(store, open.id, ret.number!, 50_000, 45_000, 5_000));
    const res = await push(app, store.device, [exchange]);
    expect(res.results[0]!.flags).toEqual([]);
    entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceId === exchange.id))).toEqual([
      ['2310', 45_000, 0],
      ['111001', 5_000, 0],
      ['4100', 0, 50_000],
    ]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
  });

  it('flags a voucher it does not know or one spent past its amount, and the rebuild agrees', async () => {
    const store = await openStore(app);
    const { doc, open, ret } = await exchangeDay(store);
    const half = doc('sale', spend(store, open.id, ret.number!, 30_000, 30_000));
    const over = doc('sale', spend(store, open.id, ret.number!, 20_000, 20_000));
    const ghost = doc('sale', spend(store, open.id, 'SRT-999', 10_000, 10_000));
    const res = await push(app, store.device, [half, over, ghost]);
    expect(res.results.map((r) => r.flags)).toEqual([[], ['voucher_overdrawn'], ['unknown_voucher']]);
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-31T00:00:00Z'),
    });
    expect(rebuilt.same).toBe(true);
  });
});
