import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildSalePayload,
  priceSale,
  type ProductDetail,
  type SaleCartLine,
  type SalePayload,
} from '@serva/core';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type PushResponse,
  type SyncDocument,
  type SyncDocumentBody,
} from '@serva/sync';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

let app: FastifyInstance;
const newId = createUuidV7();

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

interface Setup {
  tenantId: string;
  userId: string;
  device: TestDevice;
  /** Variant ids of stocked products, each with a 10-piece stock to start */
  stocked: { productId: string; variantId: string; name: string; price: number }[];
  service: { productId: string; variantId: string };
}

async function setup(): Promise<Setup> {
  const { body } = await registerStore(app);
  const tenantId: string = body.tenant.id;
  const make = async (nameAr: string, priceMinor: number, type = 'stock') => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { nameAr, type, variants: [{ price: { currency: 'SYP', priceMinor } }] },
    });
    const p = res.json<ProductDetail>();
    return { productId: p.id, variantId: p.variants[0]!.id, name: nameAr, price: priceMinor };
  };
  const stocked = [await make('سكر', 1_200_000), await make('رز', 2_500_000), await make('زيت', 3_100_000)];
  const service = await make('توصيل', 500_000, 'service');
  const device = await createDevice(tenantId);
  for (const s of stocked) {
    await ownerDb()`insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${tenantId}, ${device.branchId}, ${s.variantId}, 10000)`;
  }
  return { tenantId, userId: body.user.id, device, stocked, service };
}

/** Documents as a device makes them: one seq for all, a counter per series. */
function documents(device: TestDevice) {
  let seq = 0;
  const counters = new Map<string, number>();
  return (type: DocType, payload: Record<string, unknown>, id = newId()): SyncDocument => {
    seq += 1;
    const series = seriesOf(type);
    const n = series ? (counters.get(series) ?? 0) + 1 : 0;
    if (series) counters.set(series, n);
    const body: SyncDocumentBody = {
      id,
      seq,
      type,
      number: series
        ? formatDocNumber({ series, branchCode: '001', deviceCode: device.code, sequence: n })
        : null,
      deviceTime: '2026-10-30T08:59:00.000Z',
      businessDate: '2026-10-30',
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload,
    };
    return { ...body, hash: payloadHash(body) };
  };
}

async function push(device: TestDevice, docs: SyncDocument[]): Promise<PushResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: { authorization: device.authorization },
    payload: { contractVersion: 1, appVersion: '1.0.0', sentAt: '2026-10-30T09:00:00.000Z', documents: docs },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const shiftOpen = (userId: string) => ({
  openedBy: userId,
  mode: 'per_cashier',
  handoverFromShiftId: null,
  opening: [{ currency: 'SYP', amountMinor: 100_000, denominations: null }],
});

const shiftClose = (userId: string, shiftId: string) => ({
  shiftId,
  shiftNumber: 'SFT-001-002-0000001',
  closedBy: userId,
  baseCurrency: 'SYP',
  cash: [
    {
      currency: 'SYP',
      rate: null,
      openingMinor: 100_000,
      cashInMinor: 0,
      changeOutMinor: 0,
      refundsMinor: 0,
      receiptsMinor: 0,
      payInMinor: 0,
      fxInMinor: 0,
      payOutMinor: 0,
      fxOutMinor: 0,
      dropsMinor: 0,
      expectedMinor: 100_000,
      countedMinor: 99_000,
      denominations: null,
      differenceMinor: -1000,
      differenceBaseMinor: -1000,
    },
  ],
  shortageTreatment: 'loss',
  approval: null,
  summary: { saleCount: 0, byMethod: [] },
  forced: false,
});

const cashIn = (userId: string, shiftId: string, offline = false) => ({
  shiftId,
  kind: 'pay_in',
  currency: 'SYP',
  amountMinor: 50_000,
  baseCurrency: 'SYP',
  rate: null,
  baseAmountMinor: 50_000,
  reason: 'فكة من الخزنة',
  expenseAccountCode: null,
  reference: null,
  performedBy: userId,
  approval: { userId, method: 'pin', at: '2026-10-30T08:58:00.000Z', offline },
});

/** A cash sale of these lines at their catalog prices, paid exactly. */
function sale(
  s: Setup,
  shiftId: string,
  lines: (Partial<SaleCartLine> & {
    variant: { productId: string; variantId: string; name: string; price: number };
    qty: number;
  })[],
): SalePayload {
  const cartLines: SaleCartLine[] = lines.map(({ variant, ...rest }, i) => ({
    lineNo: i + 1,
    productId: variant.productId,
    variantId: variant.variantId,
    name: variant.name,
    priceCurrency: 'SYP',
    priceMinor: variant.price,
    taxRateBp: 0,
    ...rest,
  }));
  const total = priceSale({ currency: 'SYP', taxInclusive: true, exchangeRates: [], lines: cartLines }).priced
    .totals.totalMinor;
  return buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [],
    lines: cartLines,
    shiftId,
    cashierId: s.userId,
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: total }],
    cashSteps: {},
  });
}

const stockOf = async (tenantId: string, variantId: string) =>
  Number(
    (
      await ownerDb()<{ qty: string }[]>`
        select qty from stock_levels where tenant_id = ${tenantId} and variant_id = ${variantId}`
    )[0]?.qty ?? 0,
  );

describe('sale processor', () => {
  it('stores the invoice with its lines and payments, and moves stock out of the branch', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const open = doc('shift_open', shiftOpen(s.userId));
    const [sugar, rice] = s.stocked;
    const payload = sale(s, open.id, [
      { variant: sugar!, qty: 3000 },
      { variant: rice!, qty: 2000, packQty: 12000, priceMinor: 25_000_000 },
    ]);
    const sold = doc('sale', payload as unknown as Record<string, unknown>);
    const res = await push(s.device, [open, sold]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', []],
      ['accepted', ['negative_stock']],
    ]);

    const [invoice] = await ownerDb()<Record<string, unknown>[]>`
      select number, shift_id, shift_linked, total_minor, flags, branch_id from invoices where id = ${sold.id}`;
    expect(invoice).toEqual({
      number: sold.number,
      shift_id: open.id,
      shift_linked: true,
      total_minor: String(payload.totals.totalMinor),
      flags: ['negative_stock'],
      branch_id: s.device.branchId,
    });
    const lines = await ownerDb()<{ line_no: number; base_qty: string }[]>`
      select line_no, base_qty from invoice_lines where invoice_id = ${sold.id} order by line_no`;
    expect(lines.map((l) => [l.line_no, Number(l.base_qty)])).toEqual([
      [1, 3000],
      [2, 24000],
    ]);
    const payments = await ownerDb()<{ method: string }[]>`
      select method from invoice_payments where invoice_id = ${sold.id}`;
    expect(payments).toEqual([{ method: 'cash' }]);
    // Ten sugars less three; ten rice less two boxes of twelve: below zero, allowed and flagged.
    expect(await stockOf(s.tenantId, sugar!.variantId)).toBe(7000);
    expect(await stockOf(s.tenantId, rice!.variantId)).toBe(-14000);
    const movements = await ownerDb()<{ qty: string; kind: string }[]>`
      select qty, kind from stock_movements where doc_id = ${sold.id} order by line_no`;
    expect(movements.map((m) => [Number(m.qty), m.kind])).toEqual([
      [-3000, 'sale'],
      [-24000, 'sale'],
    ]);
  });

  it('accepts a sale before its shift, and links it when the shift arrives', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const shiftId = newId();
    const sold = doc('sale', sale(s, shiftId, [{ variant: s.stocked[0]!, qty: 1000 }]) as never);
    const moved = doc('cash_movement', cashIn(s.userId, shiftId));
    expect((await push(s.device, [sold, moved])).results.map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
    ]);
    const linked = async () =>
      (
        await ownerDb()<{ linked: boolean }[]>`
          select shift_linked as linked from invoices union all select shift_linked from cash_movements`
      ).map((r) => r.linked);
    expect(await linked()).toEqual([false, false]);
    await push(s.device, [doc('shift_open', shiftOpen(s.userId), shiftId)]);
    expect(await linked()).toEqual([true, true]);
  });

  it('flags totals that differ from the engine’s, and an approval given offline, but never refuses', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const tampered = sale(s, newId(), [{ variant: s.stocked[0]!, qty: 1000 }]);
    tampered.lines[0]!.priced.grossMinor += 1;
    const discounted = sale(s, newId(), [
      {
        variant: s.stocked[1]!,
        qty: 1000,
        discount: {
          type: 'percent',
          bp: 3000,
          source: 'manual',
          reason: 'زبون دائم',
          approval: { userId: s.userId, method: 'pin', at: '2026-10-30T08:58:00.000Z', offline: true },
        },
      },
    ]);
    const res = await push(s.device, [doc('sale', tampered as never), doc('sale', discounted as never)]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', ['totals_mismatch']],
      ['accepted', ['approval_offline']],
    ]);
  });

  it('moves no stock for a service or a variant the server does not know', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const ghost = { productId: newId(), variantId: newId(), name: 'غير معروف', price: 100 };
    const payload = sale(s, newId(), [
      { variant: { ...s.service, name: 'توصيل', price: 500_000 }, qty: 1000 },
      { variant: ghost, qty: 1000 },
    ]);
    const res = await push(s.device, [doc('sale', payload as never)]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: [] });
    const [moves] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from stock_movements`;
    expect(moves!.n).toBe(0);
    const [lines] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from invoice_lines`;
    expect(lines!.n).toBe(2);
  });
});

describe('shift and cash movement processors', () => {
  it('opens and closes a shift; a close that arrives first is kept when the opening comes', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const open = doc('shift_open', shiftOpen(s.userId));
    const close = doc('shift_close', shiftClose(s.userId, open.id));
    // The close is pushed alone first (the device's batches can be cut anywhere).
    await push(s.device, [close]);
    const shift = async () =>
      (
        await ownerDb()<Record<string, unknown>[]>`
          select status, opened_by, close_doc_id, shortage_treatment from shifts where id = ${open.id}`
      )[0];
    expect(await shift()).toEqual({
      status: 'closed',
      opened_by: null,
      close_doc_id: close.id,
      shortage_treatment: 'loss',
    });
    await push(s.device, [open]);
    expect(await shift()).toMatchObject({ status: 'closed', opened_by: s.userId, close_doc_id: close.id });
  });

  it('stores a cash movement and flags an approval given offline', async () => {
    const s = await setup();
    const doc = documents(s.device);
    const open = doc('shift_open', shiftOpen(s.userId));
    const move = doc('cash_movement', cashIn(s.userId, open.id, true));
    const res = await push(s.device, [open, move]);
    expect(res.results[1]).toMatchObject({ status: 'accepted', flags: ['approval_offline'] });
    const [row] = await ownerDb()<Record<string, unknown>[]>`
      select kind, amount_minor, shift_linked, reason, number from cash_movements where id = ${move.id}`;
    expect(row).toEqual({
      kind: 'pay_in',
      amount_minor: '50000',
      shift_linked: true,
      reason: 'فكة من الخزنة',
      number: move.number,
    });
  });
});

describe('replays and order (property)', () => {
  it('N sales in any order, in any batches, with replays and lost answers, give exactly the ledger', async () => {
    const lineArb = fc.record({ v: fc.integer({ min: 0, max: 2 }), qty: fc.integer({ min: 1, max: 5 }) });
    const caseArb = fc.record({
      sales: fc.array(fc.array(lineArb, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 8 }),
      order: fc.array(fc.nat(), { minLength: 20, maxLength: 20 }),
      batch: fc.integer({ min: 1, max: 4 }),
      replays: fc.array(fc.nat(), { maxLength: 5 }),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        await resetDatabase();
        const s = await setup();
        const doc = documents(s.device);
        const open = doc('shift_open', shiftOpen(s.userId));
        const sales = c.sales.map((lines) =>
          sale(
            s,
            open.id,
            lines.map((l) => ({ variant: s.stocked[l.v]!, qty: l.qty * 1000 })),
          ),
        );
        const docs = [open, ...sales.map((p) => doc('sale', p as never))];
        // Any order: a permutation driven by the case.
        const shuffled = docs
          .map((d, i) => ({ d, k: c.order[i % c.order.length]! * 100 + i }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.d);
        const batches: SyncDocument[][] = [];
        for (let i = 0; i < shuffled.length; i += c.batch) batches.push(shuffled.slice(i, i + c.batch));
        for (const [i, batch] of batches.entries()) {
          await push(s.device, batch);
          // A lost answer: the device sends the same batch again; a replay of an earlier one too.
          if (c.replays.includes(i)) await push(s.device, batch);
          const earlier = batches[c.replays[i] ?? -1];
          if (earlier && c.replays[i]! <= i) await push(s.device, earlier);
        }
        await push(s.device, docs);

        for (const [v, item] of s.stocked.entries()) {
          const sold = c.sales.flat().reduce((acc, l) => acc + (l.v === v ? l.qty * 1000 : 0), 0);
          expect(await stockOf(s.tenantId, item.variantId)).toBe(10_000 - sold);
        }
        const [totals] = await ownerDb()<{ n: number; total: string; linked: number }[]>`
          select count(*)::int as n, coalesce(sum(total_minor), 0)::text as total,
                 count(*) filter (where shift_linked)::int as linked
          from invoices where tenant_id = ${s.tenantId}`;
        expect(totals).toEqual({
          n: sales.length,
          total: String(sales.reduce((acc, p) => acc + p.totals.totalMinor, 0)),
          linked: sales.length,
        });
        const [moves] = await ownerDb()<{ n: number }[]>`
          select count(*)::int as n from stock_movements where tenant_id = ${s.tenantId}`;
        expect(moves!.n).toBe(c.sales.flat().length);
      }),
      { numRuns: 12 },
    );
  }, 180_000);
});
