import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type ShiftReport, type SalePayload } from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { createDb, withTenant } from '@serva/db';
import {
  balances,
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftClose,
  shiftOpen,
} from './accounting-fixtures';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { appDb, closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Round 36 (decision 10): a sale paid in dollars is refunded from the dollar drawer. The refund posts
 * through the dollar drawer account with its dollars and the rate the sale took them at, the shift
 * expects it, and every book stays balanced. A refund with no foreign part (every one made before)
 * posts exactly as it did.
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

/** The shift opens with 2,000.00 ل.س: enough to refund a whole sale in pounds */
const OPENING = 200_000;

type Payment = { method: 'cash'; currency: 'SYP' | 'USD'; amountMinor: number };

/** A day: the shift opens with 2,000.00 ل.س, one 1,170.00 ل.س sale, one return of all of it, the close */
async function aDay(
  payments: Payment[],
  foreignRefund: { currency: 'USD'; amountMinor: number }[] | undefined,
) {
  const store = await openStore(app);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId, [{ currency: 'SYP', amountMinor: OPENING }]));
  const payload: SalePayload = sale(store, open.id, {
    lines: [cartLine(1, 117_000, { name: 'جاكيت' })],
    payments,
  });
  const sold = doc('sale', payload);
  const built = buildReturnPayload({
    sale: payload,
    saleId: sold.id,
    saleNumber: sold.number!,
    shiftId: open.id,
    cashierId: store.userId,
    reason: 'مقاس',
    picks: [{ saleLineNo: 1, qty: 1000 }],
    refundMethod: 'cash',
    ...(foreignRefund ? { foreignRefund } : {}),
  });
  const { hash: _h, ...body } = doc('return', built);
  const ret: SyncDocument = { ...body, deps: [sold.id], hash: payloadHash({ ...body, deps: [sold.id] }) };

  const usdIn = payments.filter((p) => p.currency === 'USD').reduce((n, p) => n + p.amountMinor, 0);
  const sypIn = payments.filter((p) => p.currency === 'SYP').reduce((n, p) => n + p.amountMinor, 0);
  const refund = built.refunds[0]!;
  const usdOut = refund.foreign?.reduce((n, f) => n + f.amountMinor, 0) ?? 0;
  const sypOut = refund.amountMinor - (refund.foreign?.reduce((n, f) => n + f.baseAmountMinor, 0) ?? 0);
  const drawers: Parameters<typeof shiftClose>[2] = [
    { currency: 'SYP', opening: OPENING, cashIn: sypIn, counted: OPENING + sypIn - sypOut },
  ];
  if (usdIn > 0) drawers.push({ currency: 'USD', opening: 0, cashIn: usdIn, counted: usdIn - usdOut });
  const closing = shiftClose(store.userId, open.id, drawers);
  // The drawers' own terms, refunds included (the helper leaves them at zero)
  for (const c of closing.cash) {
    const out = c.currency === 'USD' ? usdOut : sypOut;
    c.refundsMinor = out;
    c.expectedMinor = c.openingMinor + c.cashInMinor - c.changeOutMinor - out;
    c.differenceMinor = c.countedMinor - c.expectedMinor;
    c.differenceBaseMinor = 0;
  }
  await push(app, store.device, [open, sold, ret, doc('shift_close', closing)]);
  return { store, shiftId: open.id, built };
}

const returnEntry = async (tenantId: string) =>
  (await postedEntries(tenantId)).find((e) => e.sourceType === 'return');

async function shiftOf(accessToken: string, shiftId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/shifts/${shiftId}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.json<ShiftReport>();
}

/** Integrity (drawer ledger included), replay, and the trial balance: debits equal credits */
async function everyBookAgrees(tenantId: string) {
  const report = await withTenant(appDb().db, tenantId, (tx) => checkIntegrity(tx, tenantId));
  expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
  const rebuilt = await checkRebuild(owner.db, {
    tenantId,
    processors: DOCUMENT_PROCESSORS,
    now: new Date('2026-10-30T12:00:00.000Z'),
  });
  expect(rebuilt).toMatchObject({ same: true, failed: [], replayed: 4 });
  const all = await balances(tenantId);
  expect([...all.values()].reduce((n, b) => n + b.base, 0)).toBe(0);
  return all;
}

describe('a refund from the dollar drawer', () => {
  it('a dollar sale refunded in dollars leaves the dollar drawer expecting zero and the pound drawer untouched', async () => {
    const { store, shiftId, built } = await aDay(
      [{ method: 'cash', currency: 'USD', amountMinor: 900 }],
      [{ currency: 'USD', amountMinor: 900 }],
    );
    expect(built.refunds[0]!.foreign).toHaveLength(1);
    const entry = await returnEntry(store.tenantId);
    // 1,170.00 ل.س of sales reversed; the dollar drawer pays 9.00 $ at 130
    expect(entry?.lines.map((l) => [l.code, l.debit, l.credit, l.currency, l.amount])).toEqual([
      ['4100', 117_000, 0, 'SYP', 117_000],
      ['111002', 0, 117_000, 'USD', -900],
    ]);
    const all = await everyBookAgrees(store.tenantId);
    // 9 $ in by the sale, 9 $ out by the return: the dollar drawer holds nothing from this sale
    expect(all.get('111002')).toEqual({ base: 0, amount: 0 });

    const shift = await shiftOf(store.accessToken, shiftId);
    expect(shift.byCurrency.find((c) => c.currency === 'USD')).toMatchObject({
      cashSalesMinor: 900,
      refundsMinor: 900,
      expectedMinor: 0,
      differenceMinor: 0,
    });
    expect(shift.byCurrency.find((c) => c.currency === 'SYP')).toMatchObject({
      refundsMinor: 0,
      expectedMinor: OPENING,
      differenceMinor: 0,
    });
  });

  it('a sale half in dollars is refunded half from each drawer, and each drawer closes right', async () => {
    const { store, shiftId } = await aDay(
      [
        { method: 'cash', currency: 'SYP', amountMinor: 58_500 },
        { method: 'cash', currency: 'USD', amountMinor: 450 },
      ],
      [{ currency: 'USD', amountMinor: 450 }],
    );
    const entry = await returnEntry(store.tenantId);
    expect(entry?.lines.map((l) => [l.code, l.debit, l.credit, l.currency, l.amount])).toEqual([
      ['4100', 117_000, 0, 'SYP', 117_000],
      ['111001', 0, 58_500, 'SYP', -58_500],
      ['111002', 0, 58_500, 'USD', -450],
    ]);
    await everyBookAgrees(store.tenantId);
    const shift = await shiftOf(store.accessToken, shiftId);
    expect(shift.byCurrency.find((c) => c.currency === 'USD')).toMatchObject({
      refundsMinor: 450,
      expectedMinor: 0,
      differenceMinor: 0,
    });
    expect(shift.byCurrency.find((c) => c.currency === 'SYP')).toMatchObject({
      refundsMinor: 58_500,
      expectedMinor: OPENING,
      differenceMinor: 0,
    });
  });

  it('the cashier can refund a dollar sale all in pounds: it posts as it always did', async () => {
    const { store, shiftId } = await aDay([{ method: 'cash', currency: 'USD', amountMinor: 900 }], undefined);
    expect(compact(await returnEntry(store.tenantId))).toEqual([
      ['4100', 117_000, 0],
      ['111001', 0, 117_000],
    ]);
    await everyBookAgrees(store.tenantId);
    const shift = await shiftOf(store.accessToken, shiftId);
    expect(shift.byCurrency.find((c) => c.currency === 'USD')).toMatchObject({
      refundsMinor: 0,
      expectedMinor: 900,
    });
    expect(shift.byCurrency.find((c) => c.currency === 'SYP')).toMatchObject({
      refundsMinor: 117_000,
      expectedMinor: OPENING - 117_000,
    });
  });

  it('a pound sale refunded in pounds is unchanged', async () => {
    const { store, shiftId } = await aDay(
      [{ method: 'cash', currency: 'SYP', amountMinor: 117_000 }],
      undefined,
    );
    expect(compact(await returnEntry(store.tenantId))).toEqual([
      ['4100', 117_000, 0],
      ['111001', 0, 117_000],
    ]);
    await everyBookAgrees(store.tenantId);
    const shift = await shiftOf(store.accessToken, shiftId);
    expect(shift.byCurrency).toHaveLength(1);
    expect(shift.byCurrency[0]).toMatchObject({
      currency: 'SYP',
      refundsMinor: 117_000,
      expectedMinor: OPENING,
    });
  });
});
