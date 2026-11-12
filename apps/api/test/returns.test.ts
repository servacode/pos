import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type ReturnedLine, type SalePayload } from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import {
  balances,
  cartLine,
  compact,
  documents,
  makeProduct,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDb, withTenant } from '@serva/db';
import type { DayReport, ShiftReport } from '@serva/core';
import { checkIntegrity } from '../src/services/integrity';
import { correctCreditReturns } from '../src/services/credit-return-correction';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Sale returns (08 › مرتجع مبيعات): stored once, stock back in, the entry of the sale turned around
 * for what came back, and never refused, only flagged when it returns more than is left.
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

interface Day {
  store: Store;
  doc: ReturnType<typeof documents>;
  shiftId: string;
  sold: SyncDocument;
  payload: SalePayload;
}

/** A shift and one sale of two pieces of a stocked product and one other line, paid as asked. */
async function aDayWithASale(method: 'cash' | 'card' = 'cash'): Promise<Day> {
  const store = await openStore(app);
  const milk = await makeProduct(app, store, 'حليب', 25_000);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const lines = [
    cartLine(1, 25_000, { qty: 2000, productId: milk.productId, variantId: milk.variantId, name: 'حليب' }),
    cartLine(2, 10_000, { name: 'خبز' }),
  ];
  const payload = sale(store, open.id, {
    lines,
    payments:
      method === 'cash'
        ? [{ method: 'cash', currency: 'SYP', amountMinor: 60_000 }]
        : [{ method: 'card', currency: 'SYP', amountMinor: 60_000, reference: 'A1' }],
  });
  const sold = doc('sale', payload);
  await push(app, store.device, [open, sold]);
  return { store, doc, shiftId: open.id, sold, payload };
}

function returnOf(day: Day, picks: { saleLineNo: number; qty: number }[], returned: ReturnedLine[] = []) {
  const payload = buildReturnPayload({
    sale: day.payload,
    saleId: day.sold.id,
    saleNumber: day.sold.number!,
    shiftId: day.shiftId,
    cashierId: day.store.userId,
    reason: 'تالف',
    picks,
    returned,
    reference: 'R-9',
  });
  const { hash: _hash, ...body } = day.doc('return', payload);
  const withDeps = { ...body, deps: [day.sold.id] };
  return { ...withDeps, hash: payloadHash(withDeps) };
}

const stockOf = async (tenantId: string) =>
  ownerDb()<{ qty: string }[]>`select qty from stock_levels where tenant_id = ${tenantId}`;

describe('a cash return', () => {
  it('is stored with its lines, puts the goods back and pays from the drawer of its shift', async () => {
    const day = await aDayWithASale();
    expect((await stockOf(day.store.tenantId)).map((r) => Number(r.qty))).toEqual([-2000]);
    const ret = returnOf(day, [{ saleLineNo: 1, qty: 1000 }]);
    const res = await push(app, day.store.device, [ret]);
    expect(res.results[0]).toMatchObject({ id: ret.id, status: 'accepted', flags: [] });

    const [stored] = await ownerDb()<
      { sale_id: string; total_minor: string; refund_method: string; shift_linked: boolean }[]
    >`select sale_id, total_minor, refund_method, shift_linked from sale_returns where tenant_id = ${day.store.tenantId}`;
    expect(stored).toEqual({
      sale_id: day.sold.id,
      total_minor: '25000',
      refund_method: 'cash',
      shift_linked: true,
    });
    expect((await stockOf(day.store.tenantId)).map((r) => Number(r.qty))).toEqual([-1000]);

    const entries = await postedEntries(day.store.tenantId);
    const entry = entries.find((e) => e.sourceType === 'return');
    expect(entry).toMatchObject({ sourceId: ret.id, total: 25_000 });
    expect(compact(entry)).toEqual([
      ['4100', 25_000, 0],
      ['111001', 0, 25_000],
    ]);
    // The sale and its return leave the drawer and the sales with what was kept.
    const b = await balances(day.store.tenantId);
    expect(b.get('111001')?.base).toBe(35_000);
    expect(b.get('4100')?.base).toBe(-35_000);
  });

  it('is stored once, however often the device sends it', async () => {
    const day = await aDayWithASale();
    const ret = returnOf(day, [{ saleLineNo: 2, qty: 1000 }]);
    await push(app, day.store.device, [ret]);
    await push(app, day.store.device, [ret]);
    const [count] = await ownerDb()<{ n: string }[]>`
      select count(*) as n from journal_entries where tenant_id = ${day.store.tenantId} and source_type = 'return'`;
    expect(count!.n).toBe('1');
  });
});

describe('a card return', () => {
  it('goes back to the card account with its reference, and leaves the drawer alone', async () => {
    const day = await aDayWithASale('card');
    const ret = returnOf(day, [
      { saleLineNo: 1, qty: 2000 },
      { saleLineNo: 2, qty: 1000 },
    ]);
    await push(app, day.store.device, [ret]);
    const entry = (await postedEntries(day.store.tenantId)).find((e) => e.sourceType === 'return');
    expect(compact(entry)).toEqual([
      ['4100', 60_000, 0],
      ['1140', 0, 60_000],
    ]);
    expect((await balances(day.store.tenantId)).get('1140')?.base).toBe(0);
  });
});

describe('a return to the customer’s account', () => {
  async function creditDay() {
    const store = await openStore(app);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { authorization: `Bearer ${store.accessToken}` },
      payload: { name: 'أبو خالد' },
    });
    const customerId = created.json<{ id: string }>().id;
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [cartLine(1, 25_000, { qty: 2000 })],
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 50_000 }],
      customerId,
      customerName: 'أبو خالد',
    });
    const sold = doc('sale', payload);
    await push(app, store.device, [open, sold]);
    return { store, doc, shiftId: open.id, sold, payload, customerId };
  }
  const balanceOf = async (tenantId: string, customerId: string) =>
    Number(
      (
        await ownerDb()<{ b: string }[]>`
          select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as b
          from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
          where l.tenant_id = ${tenantId} and a.code = '1200' and l.party_id = ${customerId}`
      )[0]!.b,
    );

  function returnFor(d: Awaited<ReturnType<typeof creditDay>>, qty: number, extra = {}) {
    const payload = buildReturnPayload({
      sale: d.payload,
      saleId: d.sold.id,
      saleNumber: d.sold.number!,
      shiftId: d.shiftId,
      cashierId: d.store.userId,
      reason: 'تالف',
      picks: [{ saleLineNo: 1, qty }],
      ...extra,
    });
    const { hash: _hash, ...body } = d.doc('return', payload);
    const withDeps = { ...body, deps: [d.sold.id] };
    return { ...withDeps, hash: payloadHash(withDeps), payload };
  }

  it('comes off the customer’s debt on 1200, and never touches the drawer', async () => {
    const d = await creditDay();
    const ret = returnFor(d, 1000);
    expect(ret.payload.refunds[0]!.method).toBe('account');
    const res = await push(app, d.store.device, [ret]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: [] });
    const entry = (await postedEntries(d.store.tenantId)).find((e) => e.sourceType === 'return');
    expect(compact(entry)).toEqual([
      ['4100', 25_000, 0],
      ['1200', 0, 25_000],
    ]);
    expect(await balanceOf(d.store.tenantId, d.customerId)).toBe(25_000);
    expect((await balances(d.store.tenantId)).get('111001')).toBeUndefined();
    const [stored] = await ownerDb()<{ refund_method: string }[]>`
      select refund_method from sale_returns where tenant_id = ${d.store.tenantId}`;
    expect(stored!.refund_method).toBe('account');
    const report = await withTenant(appDb().db, d.store.tenantId, (tx) =>
      checkIntegrity(tx, d.store.tenantId),
    );
    expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
  });

  it('a return of more than the customer still owes leaves them a credit balance on 1200, as an over-payment does', async () => {
    const d = await creditDay();
    const pay = d.doc('receipt', {
      customerId: d.customerId,
      customerName: 'أبو خالد',
      shiftId: d.shiftId,
      cashierId: d.store.userId,
      currency: 'SYP',
      amountMinor: 40_000,
      method: 'cash',
      reference: null,
      note: null,
    });
    await push(app, d.store.device, [pay, returnFor(d, 2000)]);
    expect(await balanceOf(d.store.tenantId, d.customerId)).toBe(-40_000);
  });

  it('an older till’s cash refund of a credit sale still posts to the drawer as it came', async () => {
    const d = await creditDay();
    await push(app, d.store.device, [returnFor(d, 1000, { refundMethod: 'cash' })]);
    const entry = (await postedEntries(d.store.tenantId)).find((e) => e.sourceType === 'return');
    expect(compact(entry)).toEqual([
      ['4100', 25_000, 0],
      ['111001', 0, 25_000],
    ]);
    expect(await balanceOf(d.store.tenantId, d.customerId)).toBe(50_000);
  });
});

describe('the opt-in correction of older returns of credit sales', () => {
  it('lists them, posts one dated correction each only when applied, and a second run posts nothing', async () => {
    const store = await openStore(app);
    const customerId = (
      await app.inject({
        method: 'POST',
        url: '/v1/customers',
        headers: { authorization: `Bearer ${store.accessToken}` },
        payload: { name: 'أبو خالد' },
      })
    ).json<{ id: string }>().id;
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [cartLine(1, 25_000, { qty: 2000 })],
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 50_000 }],
      customerId,
      customerName: 'أبو خالد',
    });
    const sold = doc('sale', payload);
    // What a till that predates the account refund sent: cash back on a credit sale
    const old = buildReturnPayload({
      sale: payload,
      saleId: sold.id,
      saleNumber: sold.number!,
      shiftId: open.id,
      cashierId: store.userId,
      reason: 'تالف',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      refundMethod: 'cash',
    });
    const { hash: _hash, ...body } = doc('return', old);
    const withDeps = { ...body, deps: [sold.id] };
    await push(app, store.device, [open, sold, { ...withDeps, hash: payloadHash(withDeps) }]);

    const run = (apply: boolean) =>
      withTenant(appDb().db, store.tenantId, (tx) =>
        correctCreditReturns(tx, store.tenantId, { apply, today: '2026-11-12' }),
      );
    const dry = await run(false);
    expect(dry).toMatchObject({ posted: 0, items: [{ amountMinor: 25_000, customerId }] });
    expect(
      await ownerDb()`select 1 from journal_entries where tenant_id = ${store.tenantId} and kind = 'manual'`,
    ).toHaveLength(0);

    expect((await run(true)).posted).toBe(1);
    expect((await run(true)).items).toEqual([]);
    const fix = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'manual');
    expect(compact(fix)).toEqual([
      ['111001', 25_000, 0],
      ['1200', 0, 25_000],
    ]);
    const [total] = await ownerDb()<{ b: string }[]>`
      select sum(l.debit_minor - l.credit_minor)::text as b from journal_lines l
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.code = '1200' and l.party_id = ${customerId}`;
    expect(total!.b).toBe('25000');
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
  });
});

describe('a return over what is left', () => {
  it('is accepted and flagged over_return, never refused', async () => {
    const day = await aDayWithASale();
    const first = returnOf(day, [{ saleLineNo: 1, qty: 2000 }]);
    await push(app, day.store.device, [first]);
    // A second device's copy of the same sale returns the same pieces again.
    const again = returnOf(day, [{ saleLineNo: 1, qty: 2000 }]);
    const res = await push(app, day.store.device, [again]);
    expect(res.results[0]).toMatchObject({ status: 'accepted' });
    expect(res.results[0]!.flags).toContain('over_return');
    const flagged = await ownerDb()<{ flags: string[] }[]>`
      select flags from sale_returns where tenant_id = ${day.store.tenantId} and id = ${again.id}`;
    expect(flagged[0]!.flags).toEqual(['over_return']);
  });
});

describe('a return whose sale has not arrived', () => {
  it('waits linked to it, and is posted as it came', async () => {
    const day = await aDayWithASale();
    const ghost: Day = { ...day, sold: { ...day.sold, id: '0192a3b4-c5d6-7e8f-9a0b-0000000f0001' } };
    const ret = returnOf(ghost, [{ saleLineNo: 2, qty: 1000 }]);
    const res = await push(app, day.store.device, [ret]);
    expect(res.results[0]).toMatchObject({ status: 'pending_link' });
    const entry = (await postedEntries(day.store.tenantId)).find((e) => e.sourceType === 'return');
    expect(entry?.total).toBe(10_000);
  });
});

describe('the books after returns', () => {
  it('pass every integrity check, rebuild to the same books, and show in the day and shift reports', async () => {
    const day = await aDayWithASale();
    const first = returnOf(day, [{ saleLineNo: 1, qty: 1000 }]);
    const firstPayload = first.payload as unknown as ReturnType<typeof buildReturnPayload>;
    const returned: ReturnedLine[] = firstPayload.lines.map((l) => ({
      saleLineNo: l.saleLineNo,
      qty: l.qty,
      ...l.refund,
    }));
    const second = returnOf(
      day,
      [
        { saleLineNo: 1, qty: 1000 },
        { saleLineNo: 2, qty: 1000 },
      ],
      returned,
    );
    await push(app, day.store.device, [first, second]);

    const report = await withTenant(appDb().db, day.store.tenantId, (tx) =>
      checkIntegrity(tx, day.store.tenantId),
    );
    expect(report.checks.flatMap((c) => c.problems)).toEqual([]);
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: day.store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-30T12:00:00.000Z'),
    });
    expect(rebuilt).toMatchObject({ same: true, failed: [], replayed: 4 });

    const headers = { authorization: `Bearer ${day.store.accessToken}` };
    const dayReport = (
      await app.inject({ method: 'GET', url: '/v1/reports/day?date=2026-10-30', headers })
    ).json<DayReport>();
    expect(dayReport).toMatchObject({
      totalMinor: 60_000,
      returns: {
        count: 2,
        totalMinor: 60_000,
        taxMinor: 0,
        byMethod: [{ method: 'cash', currency: 'SYP', amountMinor: 60_000, count: 2 }],
      },
      netSalesMinor: 0,
    });
    const shift = (
      await app.inject({ method: 'GET', url: `/v1/shifts/${day.shiftId}`, headers })
    ).json<ShiftReport>();
    expect(shift).toMatchObject({ returnsCount: 2, returnsTotalMinor: 60_000 });
    // Opening 1,000.00 + 600.00 in − 600.00 back
    expect(shift.byCurrency[0]).toMatchObject({
      currency: 'SYP',
      cashSalesMinor: 60_000,
      refundsMinor: 60_000,
      expectedMinor: 100_000,
    });
  });
});
