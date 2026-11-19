import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from '@serva/sync';
import type {
  ProductDetail,
  PurchaseDetail,
  PurchaseOrderSuggestion,
  ShortagesResponse,
  SupplierRow,
} from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Round 38, the pharmacy pack: the strength and the form beside the generic name, «النواقص» (a request
 * the till writes once, an item under its minimum, the suggestion that reads them), and an expired batch
 * sold with the manager's code being audited.
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

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const BOX = 1000;

async function medicine(
  store: Store,
  extra: { nameAr?: string; strength?: string; dosageForm?: string; min?: number } = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: extra.nameAr ?? 'بانادول 500',
      genericName: 'باراسيتامول',
      strength: extra.strength,
      dosageForm: extra.dosageForm,
      variants: [
        {
          price: { currency: 'SYP', priceMinor: 15_000 },
          ...(extra.min !== undefined ? { minStockQty: extra.min } : {}),
        },
      ],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { productId: p.id, variantId: p.variants[0]!.id, name: p.nameAr, product: p };
}

async function supplier(store: Store, name = 'مستودع الشفاء') {
  return (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name } })
  ).json<SupplierRow>();
}

async function receive(
  store: Store,
  supplierId: string,
  variantId: string,
  boxes: number,
  batch?: string,
  expiry?: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId,
      date: '2026-10-28',
      payment: 'credit',
      lines: [
        {
          variantId,
          qty: boxes * BOX,
          costMinor: boxes * 10_000,
          ...(batch ? { batchNo: batch, expiryDate: expiry } : {}),
        },
      ],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

const ask = (store: Store, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/shortages',
    headers: { authorization: store.device.authorization },
    payload: body,
  });

const list = async (store: Store) =>
  (
    await app.inject({ method: 'GET', url: '/v1/pharmacy/shortages', headers: as(store) })
  ).json<ShortagesResponse>();

describe('strength and dosage form', () => {
  it('are kept on the product, change with a patch and reach the tills', async () => {
    const store = await openStore(app);
    const med = await medicine(store, { strength: '500 ملغ', dosageForm: 'أقراص' });
    expect(med.product).toMatchObject({ strength: '500 ملغ', dosageForm: 'أقراص' });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${med.productId}`,
      headers: as(store),
      payload: { version: med.product.version, strength: '1 غ' },
    });
    expect(patched.json<ProductDetail>()).toMatchObject({ strength: '1 غ', dosageForm: 'أقراص' });
    const pulled = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    const rows = (pulled.json().sets as { products: { upserts: { id: string; strength?: string }[] } })
      .products.upserts;
    expect(rows.find((p) => p.id === med.productId)).toMatchObject({ strength: '1 غ', dosageForm: 'أقراص' });
    // A product made without them has none
    const plain = await medicine(store, { nameAr: 'اسم آخر' });
    expect(plain.product).toMatchObject({ strength: null, dosageForm: null });
  });
});

describe('«النواقص»', () => {
  it('writes a request once however often the till retries it, and refuses an unknown item', async () => {
    const store = await openStore(app);
    const med = await medicine(store);
    const id = uuidv7();
    const body = { id, variantId: med.variantId, name: med.name, qty: 2 * BOX };
    const first = await ask(store, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({ id, created: true });
    const again = await ask(store, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ id, created: false });
    const [n] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from shortage_requests`;
    expect(n!.n).toBe(1);
    const unknown = await ask(store, { id: uuidv7(), variantId: uuidv7(), name: 'دواء' });
    expect(unknown.statusCode).toBe(400);
    // Not a device: refused
    const anon = await app.inject({ method: 'POST', url: '/v1/device/shortages', payload: body });
    expect(anon.statusCode).toBe(401);
  });

  it('lists an item under its minimum, a requested one and an unknown one, each with its reason', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    await medicine(store, { nameAr: 'دواء ناقص', min: 5 * BOX });
    const asked = await medicine(store, { nameAr: 'دواء مطلوب' });
    const both = await medicine(store, { nameAr: 'دواء الاثنين', min: 5 * BOX });
    const fine = await medicine(store, { nameAr: 'دواء كاف', min: 1 * BOX });
    await receive(store, s.id, fine.variantId, 10);
    await receive(store, s.id, asked.variantId, 3);
    await ask(store, { id: uuidv7(), variantId: asked.variantId, name: asked.name, qty: BOX });
    await ask(store, { id: uuidv7(), variantId: both.variantId, name: both.name, qty: BOX });
    await ask(store, { id: uuidv7(), variantId: both.variantId, name: both.name, qty: 2 * BOX });
    await ask(store, { id: uuidv7(), variantId: null, name: 'سيروم ملحي', qty: BOX });
    await ask(store, { id: uuidv7(), variantId: null, name: 'سيروم ملحي', qty: BOX });

    // The purchase of «asked» came before its request: the request is open
    const rows = (await list(store)).items;
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect([...byName.keys()].sort()).toEqual(
      ['دواء الاثنين', 'دواء مطلوب', 'دواء ناقص', 'سيروم ملحي'].sort(),
    );
    expect(byName.get('دواء ناقص')).toMatchObject({
      reason: 'below_min',
      requestCount: 0,
      minStockQty: 5 * BOX,
    });
    expect(byName.get('دواء مطلوب')).toMatchObject({
      reason: 'requested',
      requestCount: 1,
      requestedQty: BOX,
    });
    expect(byName.get('دواء الاثنين')).toMatchObject({
      reason: 'both',
      requestCount: 2,
      requestedQty: 3 * BOX,
    });
    expect(byName.get('سيروم ملحي')).toMatchObject({
      variantId: null,
      reason: 'requested',
      requestCount: 2,
      stockQty: null,
    });
    expect(byName.get('دواء مطلوب')!.lastSupplierId).toBe(s.id);
  });

  it('closes a request by hand, and by itself when the item is received afterwards', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const a = await medicine(store, { nameAr: 'دواء أ' });
    const b = await medicine(store, { nameAr: 'دواء ب' });
    await ask(store, { id: uuidv7(), variantId: a.variantId, name: a.name });
    await ask(store, { id: uuidv7(), variantId: b.variantId, name: b.name });
    expect((await list(store)).items).toHaveLength(2);

    await receive(store, s.id, a.variantId, 4);
    const afterReceipt = (await list(store)).items;
    expect(afterReceipt.map((r) => r.name)).toEqual(['دواء ب']);

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/pharmacy/shortages/resolve',
      headers: as(store),
      payload: { ids: afterReceipt[0]!.requestIds },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json<ShortagesResponse>().items).toEqual([]);
    const audits = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where action = 'shortage.resolve'`;
    expect(audits[0]!.n).toBe(1);
  });

  it('is for whoever manages purchases only', async () => {
    const store = await openStore(app);
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0955000111');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/pharmacy/shortages',
      headers: as(cashier),
    });
    expect(res.statusCode).toBe(403);
  });

  it('feeds the order suggestion: a requested item is on it for what was asked', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store);
    // Bought once from this supplier, plenty on the shelf, no minimum: nothing suggests it
    await receive(store, s.id, med.variantId, 10);
    const quiet = await app.inject({
      method: 'GET',
      url: `/v1/purchase-orders/suggest?supplierId=${s.id}`,
      headers: as(store),
    });
    expect(quiet.json<PurchaseOrderSuggestion>().items).toEqual([]);
    // A customer asked for 4 boxes more than the shelf had: now it is on the suggestion, for what was asked
    await ask(store, { id: uuidv7(), variantId: med.variantId, name: med.name, qty: 4 * BOX });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/purchase-orders/suggest?supplierId=${s.id}`,
      headers: as(store),
    });
    // The receipt came before the request, so the request is still open
    const items = res.json<PurchaseOrderSuggestion>().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ variantId: med.variantId, reason: 'requested' });
    expect(items[0]!.suggestedQty).toBe(4 * BOX);
  });
});

describe('an expired batch sold', () => {
  async function soldWith(
    store: Store,
    med: { productId: string; variantId: string; name: string },
    approved: boolean,
  ) {
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [
        cartLine(1, 15_000, {
          productId: med.productId,
          variantId: med.variantId,
          name: med.name,
          qty: BOX,
          batches: [{ batchNo: 'OLD-1', expiry: '2026-10-25', qty: BOX }],
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 15_000 }],
    });
    const withApproval = approved
      ? {
          ...payload,
          batchApproval: {
            userId: store.userId,
            method: 'pin',
            at: '2026-10-30T08:59:00.000Z',
            offline: false,
          },
        }
      : payload;
    const sold = doc('sale', withApproval);
    await push(app, store.device, [open, sold]);
    return sold;
  }

  it('is audited with the manager who approved it, once, and the sale is flagged', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store);
    await receive(store, s.id, med.variantId, 5, 'OLD-1', '2026-10-25');
    const sold = await soldWith(store, med, true);
    const rows = await ownerDb()<
      {
        entity_id: string;
        data: { approvedBy: string | null; batches: { batchNo: string; qty: number }[] };
      }[]
    >`select entity_id, data from audit_logs where action = 'sale.expired_batch'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_id).toBe(sold.id);
    expect(rows[0]!.data.approvedBy).toBe(store.userId);
    expect(rows[0]!.data.batches).toEqual([
      { variantId: med.variantId, batchNo: 'OLD-1', expiry: '2026-10-25', qty: BOX },
    ]);
    const [inv] = await ownerDb()<{ flags: string[] }[]>`select flags from invoices where id = ${sold.id}`;
    expect(inv!.flags).toContain('batch_blocked');
    // The batch ledger still adds up to the stock: four boxes left of the five
    const [left] = await ownerDb()<{ qty: string }[]>`
      select sum(qty)::text as qty from batch_movements where variant_id = ${med.variantId}`;
    expect(Number(left!.qty)).toBe(4 * BOX);
    // Pushing it again records nothing twice
    await push(app, store.device, [sold]);
    const again = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where action = 'sale.expired_batch'`;
    expect(again[0]!.n).toBe(1);
  });

  it('is audited with no approver when the document carries none', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store);
    await receive(store, s.id, med.variantId, 5, 'OLD-1', '2026-10-25');
    await soldWith(store, med, false);
    const rows = await ownerDb()<{ data: { approvedBy: string | null } }[]>`
      select data from audit_logs where action = 'sale.expired_batch'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.approvedBy).toBeNull();
  });

  it('a sale of a good batch writes no such entry', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store);
    await receive(store, s.id, med.variantId, 5, 'NEW-1', '2027-10-25');
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [
          cartLine(1, 15_000, {
            productId: med.productId,
            variantId: med.variantId,
            name: med.name,
            qty: BOX,
            batches: [{ batchNo: 'NEW-1', expiry: '2027-10-25', qty: BOX }],
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 15_000 }],
      }),
    );
    await push(app, store.device, [open, sold]);
    const rows = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where action = 'sale.expired_batch'`;
    expect(rows[0]!.n).toBe(0);
  });
});
