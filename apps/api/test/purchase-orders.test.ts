import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  PurchaseDetail,
  PurchaseOrderDetail,
  PurchaseOrderListResponse,
  PurchaseOrderSuggestion,
  SupplierRow,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * «طلبيات الشراء»: an order to a supplier is a promise. It is numbered, followed draft → sent →
 * partly received → received, posts nothing and moves no stock; each receipt is an ordinary purchase.
 */

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

const as = (s: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${s.accessToken}` });
const PIECE = 1000;
const year = new Date().getFullYear();

async function supplier(s: Store, name = 'مؤسسة الفرات') {
  const res = await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(s), payload: { name } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

async function product(s: Store, nameAr: string, minStockQty?: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(s),
    payload: {
      nameAr,
      variants: [{ price: { currency: 'SYP', priceMinor: 5000 }, ...(minStockQty ? { minStockQty } : {}) }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>().variants[0]!.id;
}

const order = (s: Store, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/purchase-orders', headers: as(s), payload: body });

async function made(s: Store, body: Record<string, unknown>) {
  const res = await order(s, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseOrderDetail>();
}

const move = (s: Store, o: PurchaseOrderDetail, status: string, version = o.version) =>
  app.inject({
    method: 'POST',
    url: `/v1/purchase-orders/${o.id}/status`,
    headers: as(s),
    payload: { status, version },
  });

const receive = (
  s: Store,
  o: PurchaseOrderDetail,
  lines: { variantId: string; qty: number; costMinor: number }[],
) =>
  app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(s),
    payload: {
      supplierId: o.supplierId,
      date: '2026-10-30',
      payment: 'credit',
      purchaseOrderId: o.id,
      lines,
    },
  });

async function counts() {
  const sql = ownerDb();
  const [stock] = await sql<{ n: string }[]>`select coalesce(sum(qty), 0)::text as n from stock_levels`;
  const [entries] = await sql<{ n: string }[]>`select count(*)::text as n from journal_entries`;
  const [buys] = await sql<{ n: string }[]>`select count(*)::text as n from purchases`;
  return { stock: stock!.n, entries: entries!.n, buys: buys!.n };
}

describe('purchase order unit cost', () => {
  it('keeps the unit cost, works the line total from it, and derives it for a line sent with a total only', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const a = await product(s, 'قفازات');
    const b = await product(s, 'كمامات');
    const o = await made(s, {
      supplierId: sup.id,
      lines: [
        { variantId: a, qty: 4 * PIECE, costMinor: 1, unitCostMinor: 2_500 },
        { variantId: b, qty: 5 * PIECE, costMinor: 12_400 },
      ],
    });
    expect(o.lines[0]).toMatchObject({ unitCostMinor: 2_500, costMinor: 10_000 });
    expect(o.lines[1]).toMatchObject({ unitCostMinor: 2_480, costMinor: 12_400 });
    expect(o.totalMinor).toBe(22_400);
  });
});

describe('purchase orders', () => {
  it('numbers a draft per store and year, and posts nothing and moves no stock', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const v = await product(s, 'قفازات');
    const before = await counts();
    const o = await made(s, {
      supplierId: sup.id,
      expectedDate: '2099-01-01',
      notes: 'التسليم صباحاً',
      lines: [{ variantId: v, qty: 10 * PIECE, costMinor: 50_000 }],
    });
    expect(o).toMatchObject({
      number: `PO-${year}-000001`,
      status: 'draft',
      supplierName: 'مؤسسة الفرات',
      totalMinor: 50_000,
      orderedQty: 10 * PIECE,
      receivedQty: 0,
      expectedDate: '2099-01-01',
    });
    expect(o.lines[0]).toMatchObject({ name: 'قفازات', receivedQty: 0 });
    expect(
      (await made(s, { supplierId: sup.id, lines: [{ variantId: v, qty: PIECE, costMinor: 1 }] })).number,
    ).toBe(`PO-${year}-000002`);
    expect(await counts()).toEqual(before);
    const list = await app.inject({ method: 'GET', url: '/v1/purchase-orders', headers: as(s) });
    expect(list.json<PurchaseOrderListResponse>().items).toHaveLength(2);
    const sent = await app.inject({
      method: 'GET',
      url: '/v1/purchase-orders?status=draft&supplierId=' + sup.id,
      headers: as(s),
    });
    expect(sent.json<PurchaseOrderListResponse>().items).toHaveLength(2);
  });

  it('refuses the same item twice, an empty order, a past day and a stranger supplier', async () => {
    const s = await openStore(app);
    const other = await openStore(app, '0955000001');
    const sup = await supplier(s);
    const v = await product(s, 'قفازات');
    const line = { variantId: v, qty: PIECE, costMinor: 10 };
    expect((await order(s, { supplierId: sup.id, lines: [line, line] })).statusCode).toBe(400);
    expect((await order(s, { supplierId: sup.id, lines: [] })).statusCode).toBe(400);
    expect(
      (await order(s, { supplierId: sup.id, expectedDate: '2020-01-01', lines: [line] })).statusCode,
    ).toBe(400);
    // Another store's supplier is not found, whoever asks
    expect((await order(other, { supplierId: sup.id, lines: [line] })).statusCode).toBe(400);
  });

  it('is edited while a draft or sent, then follows its steps', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const v = await product(s, 'قفازات');
    const o = await made(s, { supplierId: sup.id, lines: [{ variantId: v, qty: PIECE, costMinor: 10 }] });
    const edited = await app.inject({
      method: 'PUT',
      url: `/v1/purchase-orders/${o.id}`,
      headers: as(s),
      payload: {
        supplierId: sup.id,
        version: o.version,
        lines: [{ variantId: v, qty: 4 * PIECE, costMinor: 40 }],
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const o2 = edited.json<PurchaseOrderDetail>();
    expect(o2).toMatchObject({ orderedQty: 4 * PIECE, totalMinor: 40 });
    // A stale page is refused
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/purchase-orders/${o.id}`,
          headers: as(s),
          payload: {
            supplierId: sup.id,
            version: o.version,
            lines: [{ variantId: v, qty: PIECE, costMinor: 10 }],
          },
        })
      ).statusCode,
    ).toBe(409);
    // Nothing is received before it is sent, and a draft is not «received» by hand
    expect((await move(s, o2, 'received')).statusCode).toBe(409);
    expect((await receive(s, o2, [{ variantId: v, qty: PIECE, costMinor: 10 }])).statusCode).toBe(409);
    expect((await counts()).buys).toBe('0');
    const sent = (await move(s, o2, 'sent')).json<PurchaseOrderDetail>();
    expect(sent.status).toBe('sent');
    const cancelled = await move(s, sent, 'cancelled');
    expect(cancelled.json<PurchaseOrderDetail>().status).toBe('cancelled');
    // A cancelled order is final
    expect((await move(s, cancelled.json<PurchaseOrderDetail>(), 'sent')).statusCode).toBe(409);
    expect((await receive(s, sent, [{ variantId: v, qty: PIECE, costMinor: 10 }])).statusCode).toBe(409);
  });

  it('is received in parts, each an ordinary purchase, until it reads received', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const a = await product(s, 'قفازات');
    const b = await product(s, 'كمامات');
    const o0 = await made(s, {
      supplierId: sup.id,
      lines: [
        { variantId: a, qty: 10 * PIECE, costMinor: 100_000 },
        { variantId: b, qty: 4 * PIECE, costMinor: 40_000 },
      ],
    });
    const o = (await move(s, o0, 'sent')).json<PurchaseOrderDetail>();

    const first = await receive(s, o, [{ variantId: a, qty: 6 * PIECE, costMinor: 60_000 }]);
    expect(first.statusCode, first.body).toBe(201);
    const after1 = (
      await app.inject({ method: 'GET', url: `/v1/purchase-orders/${o.id}`, headers: as(s) })
    ).json<PurchaseOrderDetail>();
    expect(after1.status).toBe('partial');
    expect(after1.lines.map((l) => l.receivedQty)).toEqual([6 * PIECE, 0]);
    expect(after1.receivedQty).toBe(6 * PIECE);
    expect(after1.receipts).toEqual([
      expect.objectContaining({
        purchaseId: first.json<PurchaseDetail>().id,
        number: first.json<PurchaseDetail>().number,
      }),
    ]);
    // The purchase posted as any purchase does: stock in, the books balanced by the entry
    const mid = await counts();
    expect(mid.stock).toBe(String(6 * PIECE));
    expect(Number(mid.entries)).toBeGreaterThan(0);

    // The rest arrives with a different price; both lines now complete
    const second = await receive(s, o, [
      { variantId: a, qty: 4 * PIECE, costMinor: 44_000 },
      { variantId: b, qty: 4 * PIECE, costMinor: 40_000 },
    ]);
    expect(second.statusCode, second.body).toBe(201);
    const done = (
      await app.inject({ method: 'GET', url: `/v1/purchase-orders/${o.id}`, headers: as(s) })
    ).json<PurchaseOrderDetail>();
    expect(done.status).toBe('received');
    expect(done.receivedQty).toBe(14 * PIECE);
    expect(done.receipts).toHaveLength(2);
    // A received order takes no more
    expect((await receive(s, o, [{ variantId: a, qty: PIECE, costMinor: 1 }])).statusCode).toBe(409);
  });

  it('can be closed short from «partial», and refuses a receipt from another supplier', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const sup2 = await supplier(s, 'مورد ثانٍ');
    const a = await product(s, 'قفازات');
    const o = (
      await move(
        s,
        await made(s, { supplierId: sup.id, lines: [{ variantId: a, qty: 10 * PIECE, costMinor: 100 }] }),
        'sent',
      )
    ).json<PurchaseOrderDetail>();
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(s),
      payload: {
        supplierId: sup2.id,
        date: '2026-10-30',
        payment: 'credit',
        purchaseOrderId: o.id,
        lines: [{ variantId: a, qty: PIECE, costMinor: 10 }],
      },
    });
    expect(wrong.statusCode).toBe(400);
    // The refused receipt took no stock and posted nothing
    expect((await counts()).buys).toBe('0');
    expect((await receive(s, o, [{ variantId: a, qty: 3 * PIECE, costMinor: 30 }])).statusCode).toBe(201);
    const part = (
      await app.inject({ method: 'GET', url: `/v1/purchase-orders/${o.id}`, headers: as(s) })
    ).json<PurchaseOrderDetail>();
    expect(part.status).toBe('partial');
    const closed = await move(s, part, 'received');
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json<PurchaseOrderDetail>().status).toBe('received');
  });

  it("keeps one store from another store's orders", async () => {
    const s = await openStore(app);
    const other = await openStore(app, '0955000002');
    const sup = await supplier(s);
    const v = await product(s, 'قفازات');
    const o = await made(s, { supplierId: sup.id, lines: [{ variantId: v, qty: PIECE, costMinor: 10 }] });
    const theirs = await app.inject({ method: 'GET', url: '/v1/purchase-orders', headers: as(other) });
    expect(theirs.json<PurchaseOrderListResponse>().items).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/purchase-orders/${o.id}`, headers: as(other) }))
        .statusCode,
    ).toBe(404);
    // A purchase of the other store cannot name this store's order
    const otherSup = await supplier(other);
    const otherItem = await product(other, 'صنف');
    const stolen = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(other),
      payload: {
        supplierId: otherSup.id,
        date: '2026-10-30',
        payment: 'credit',
        purchaseOrderId: o.id,
        lines: [{ variantId: otherItem, qty: PIECE, costMinor: 10 }],
      },
    });
    expect(stolen.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/purchase-orders',
          headers: { authorization: 'Bearer x' },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('purchase order suggestion', () => {
  async function buy(s: Store, supplierId: string, variantId: string, pieces: number, costMinor: number) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(s),
      payload: {
        supplierId,
        date: '2026-10-30',
        payment: 'credit',
        lines: [{ variantId, qty: pieces * PIECE, costMinor }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const suggest = async (s: Store, supplierId: string, all = false) =>
    (
      await app.inject({
        method: 'GET',
        url: `/v1/purchase-orders/suggest?supplierId=${supplierId}${all ? '&all=1' : ''}`,
        headers: as(s),
      })
    ).json<PurchaseOrderSuggestion>();

  it('lists what is under its minimum, for the supplier it was last bought from, at that price', async () => {
    const s = await openStore(app);
    const sup = await supplier(s);
    const sup2 = await supplier(s, 'مورد ثانٍ');
    const low = await product(s, 'قفازات', 5 * PIECE);
    const fine = await product(s, 'كمامات', 1 * PIECE);
    const none = await product(s, 'بلا حد');
    await buy(s, sup.id, low, 2, 20_000);
    await buy(s, sup.id, fine, 5, 5_000);
    await buy(s, sup2.id, none, 1, 100);
    const got = await suggest(s, sup.id);
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({
      variantId: low,
      stockQty: 2 * PIECE,
      minStockQty: 5 * PIECE,
      suggestedQty: 3 * PIECE,
      costMinor: 30_000,
      unitCostMinor: 10_000,
      costDoubtful: false,
      reason: 'below_min',
      lastSupplierId: sup.id,
    });
    // The other supplier has nothing short
    expect((await suggest(s, sup2.id)).items).toEqual([]);
  });

  it("takes off what is already on a waiting order, and refuses a supplier that is not the store's", async () => {
    const s = await openStore(app);
    const other = await openStore(app, '0955000003');
    const sup = await supplier(s);
    const low = await product(s, 'قفازات', 5 * PIECE);
    await buy(s, sup.id, low, 2, 20_000);
    const o = await made(s, {
      supplierId: sup.id,
      lines: [{ variantId: low, qty: 3 * PIECE, costMinor: 30_000 }],
    });
    expect((await suggest(s, sup.id)).items[0]!.suggestedQty).toBe(3 * PIECE);
    await move(s, o, 'sent');
    // Sent, the three on order cover the shortage, and the answer says which order owes it
    const covered = await suggest(s, sup.id);
    expect(covered.items).toEqual([]);
    expect(covered.alreadyOrdered).toEqual([
      expect.objectContaining({ variantId: low, onOrderQty: 3 * PIECE, orderNumbers: [o.number] }),
    ]);
    const stranger = await app.inject({
      method: 'GET',
      url: `/v1/purchase-orders/suggest?supplierId=${sup.id}`,
      headers: as(other),
    });
    expect(stranger.statusCode).toBe(400);
  });
});
