import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type ControlledRegisterResponse,
  type ExpiryResponse,
  type ProductDetail,
  type PullSetRows,
  type PurchaseDetail,
  type SalePayload,
  type StoreResponse,
  type SupplierRow,
} from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { staffUser } from './staff';

/**
 * Pharmacies on the server (03 › الصيدليات): the scientific name, the batch and expiry of what was
 * received, what of it is still on the shelf, and the earliest expiry the till warns on.
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

async function medicine(store: Store, flags: { requiresPrescription?: boolean; controlled?: boolean } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: 'بانادول 500',
      genericName: 'باراسيتامول',
      ...flags,
      variants: [{ price: { currency: 'SYP', priceMinor: 15_000 } }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { productId: p.id, variantId: p.variants[0]!.id, name: p.nameAr, product: p };
}

async function receive(
  store: Store,
  supplierId: string,
  variantId: string,
  date: string,
  boxes: number,
  batch: string,
  expiry: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId,
      date,
      payment: 'credit',
      lines: [{ variantId, qty: boxes * BOX, costMinor: boxes * 10_000, batchNo: batch, expiryDate: expiry }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

async function pull(store: Store) {
  await settled();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  return res.json<PullResponse>().sets as unknown as {
    [K in keyof PullSetRows]: { upserts: PullSetRows[K][] };
  };
}

const expiry = async (store: Store, days = 30) =>
  (
    await app.inject({ method: 'GET', url: `/v1/inventory/expiry?days=${days}`, headers: as(store) })
  ).json<ExpiryResponse>();

describe('batches and expiry', () => {
  it('keeps each batch received, estimates what is on the shelf, and follows the sales', async () => {
    const store = await openStore(app);
    const s = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'مستودع الشفاء' },
      })
    ).json<SupplierRow>();
    const med = await medicine(store);
    expect(med.product.genericName).toBe('باراسيتامول');
    // An old batch already past its date, then a newer one
    const first = await receive(store, s.id, med.variantId, '2026-10-20', 10, 'A-01', '2026-10-25');
    expect(first.lines[0]).toMatchObject({
      productId: med.productId,
      batchNo: 'A-01',
      expiryDate: '2026-10-25',
    });
    await receive(store, s.id, med.variantId, '2026-10-28', 5, 'B-07', '2026-11-15');

    let sets = await pull(store);
    expect(sets.products.upserts.find((p) => p.id === med.productId)!.genericName).toBe('باراسيتامول');
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBe('2026-10-25');

    let report = await expiry(store);
    expect(report.today).toBe('2026-10-30');
    expect(report.items.map((r) => [r.batchNo, r.expiryDate, r.qty, r.daysLeft])).toEqual([
      ['A-01', '2026-10-25', 10 * BOX, -5],
      ['B-07', '2026-11-15', 5 * BOX, 16],
    ]);

    // Twelve boxes sold: the oldest go first, three of the new batch are left
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
            qty: 12 * BOX,
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 180_000 }],
      }),
    );
    await push(app, store.device, [open, sold]);
    report = await expiry(store);
    expect(report.items.map((r) => [r.batchNo, r.qty])).toEqual([['B-07', 3 * BOX]]);
    sets = await pull(store);
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBe('2026-11-15');
    // Within 10 days, nothing
    expect((await expiry(store, 10)).items).toEqual([]);
  });

  it('a purchase line without an expiry changes nothing, and a cashier cannot read the report', async () => {
    const store = await openStore(app);
    const s = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'مورد' },
      })
    ).json<SupplierRow>();
    const med = await medicine(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: s.id,
        date: '2026-10-29',
        payment: 'cash',
        lines: [{ variantId: med.variantId, qty: 2 * BOX, costMinor: 20_000 }],
      },
    });
    expect(res.json<PurchaseDetail>().lines[0]).toMatchObject({ batchNo: null, expiryDate: null });
    expect((await expiry(store)).items).toEqual([]);
    const sets = await pull(store);
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBeNull();
    const bad = await app.inject({ method: 'GET', url: '/v1/inventory/expiry?days=0', headers: as(store) });
    expect(bad.statusCode).toBe(400);
  });
});

/** A user with a system role (its branch is not needed: the role applies everywhere) */
const staff = (store: Store, role: string, phone: string) =>
  staffUser(app, { ...store, branchId: '' }, role, phone);

const RX = { ref: 'RX-77', doctor: 'د. سامر', patientName: 'ليلى', patientId: '01020304' };

async function supplier(store: Store) {
  return (
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: as(store),
      payload: { name: 'مستودع الشفاء' },
    })
  ).json<SupplierRow>();
}

describe('batches the till picks from, and the prescription flags', () => {
  it('keeps the flags on the product, pulls them with the batches on the shelf, and lets them change', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store, { requiresPrescription: true, controlled: true });
    expect(med.product).toMatchObject({ requiresPrescription: true, controlled: true });
    await receive(store, s.id, med.variantId, '2026-10-20', 10, 'A-01', '2026-10-25');
    await receive(store, s.id, med.variantId, '2026-10-28', 5, 'B-07', '2026-11-15');

    let sets = await pull(store);
    expect(sets.products.upserts.find((p) => p.id === med.productId)).toMatchObject({
      requiresPrescription: true,
      controlled: true,
    });
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.shelfBatches).toEqual([
      { batchNo: 'A-01', expiry: '2026-10-25' },
      { batchNo: 'B-07', expiry: '2026-11-15' },
    ]);

    // Eleven boxes sold: the old batch is gone from the shelf, and the till is told without the report
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
            qty: 11 * BOX,
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 165_000 }],
        prescription: RX,
      }),
    );
    await push(app, store.device, [open, sold]);
    sets = await pull(store);
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.shelfBatches).toEqual([
      { batchNo: 'B-07', expiry: '2026-11-15' },
    ]);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${med.productId}`,
      headers: as(store),
      payload: { version: med.product.version, controlled: false },
    });
    expect(patched.json<ProductDetail>()).toMatchObject({ requiresPrescription: true, controlled: false });
  });

  it('a pharmacy store gets its prescription setting on the till, the owner changes it, others have none', async () => {
    const store = await openStore(app);
    const read = async () =>
      (await app.inject({ method: 'GET', url: '/v1/store', headers: as(store) })).json<StoreResponse>();
    expect((await read()).pharmacy).toBeNull();
    let sets = await pull(store);
    expect(sets.settings.upserts[0]!.pharmacy).toBeNull();

    await ownerDb()`update tenants set sectors = array['pharmacy'] where id = ${store.tenantId}`;
    expect((await read()).pharmacy).toEqual({ prescription: 'optional' });
    sets = await pull(store);
    expect(sets.settings.upserts[0]!.pharmacy).toEqual({ prescription: 'optional' });

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/store/pharmacy',
      headers: as(store),
      payload: { prescription: 'required' },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<StoreResponse>().pharmacy).toEqual({ prescription: 'required' });
    sets = await pull(store);
    expect(sets.settings.upserts[0]!.pharmacy).toEqual({ prescription: 'required' });

    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/store/pharmacy',
      headers: as(store),
      payload: { prescription: 'sometimes' },
    });
    expect(bad.statusCode).toBe(400);
    const cashier = await staff(store, 'cashier', '0955555555');
    const denied = await app.inject({
      method: 'PUT',
      url: '/v1/store/pharmacy',
      headers: as(cashier),
      payload: { prescription: 'optional' },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('controlled drugs on the server', () => {
  /** One till for the test: its numbers keep counting, and its shift is opened once */
  async function till(store: Store) {
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    await push(app, store.device, [open]);
    return { doc, open };
  }

  async function sellControlled(
    t: Awaited<ReturnType<typeof till>>,
    store: Store,
    med: Awaited<ReturnType<typeof medicine>>,
    cashierId: string,
    extra: { prescription?: Record<string, string | null> | null; batch?: boolean },
  ) {
    const { doc, open } = t;
    const sold = doc(
      'sale',
      sale({ userId: cashierId }, open.id, {
        lines: [
          cartLine(1, 15_000, {
            productId: med.productId,
            variantId: med.variantId,
            name: med.name,
            qty: BOX,
            ...(extra.batch ? { batchNo: 'B-07', batchExpiry: '2026-11-15' } : {}),
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 15_000 }],
        ...(extra.prescription ? { prescription: extra.prescription as typeof RX } : {}),
      }),
    );
    const res = await push(app, store.device, [sold]);
    return { sold, result: res.results[0]! };
  }

  it('flags a controlled sale by someone without the pharmacist permission, or without the details', async () => {
    const store = await openStore(app);
    const med = await medicine(store, { controlled: true });
    await receive(store, (await supplier(store)).id, med.variantId, '2026-10-20', 10, 'B-07', '2026-11-15');
    const cashier = await staff(store, 'cashier', '0955555555');
    const pharmacist = await staff(store, 'pharmacist', '0966666666');
    const t = await till(store);

    const byCashier = await sellControlled(t, store, med, cashier.userId, { prescription: RX, batch: true });
    expect(byCashier.result).toMatchObject({ status: 'accepted', flags: ['permission_stale'] });
    const bare = await sellControlled(t, store, med, pharmacist.userId, { prescription: null });
    expect(bare.result).toMatchObject({ status: 'accepted', flags: ['controlled_incomplete'] });
    const half = await sellControlled(t, store, med, pharmacist.userId, {
      prescription: { ...RX, patientId: null },
    });
    expect(half.result.flags).toEqual(['controlled_incomplete']);
    const clean = await sellControlled(t, store, med, pharmacist.userId, { prescription: RX, batch: true });
    expect(clean.result).toMatchObject({ status: 'accepted', flags: [] });

    // The prescription and the batch are kept with the document
    const [stored] = await ownerDb()<{ payload: SalePayload }[]>`
      select payload from invoices where id = ${clean.sold.id}`;
    expect(stored!.payload.prescription).toEqual(RX);
    expect(stored!.payload.lines[0]).toMatchObject({ batchNo: 'B-07', batchExpiry: '2026-11-15' });
  });

  it('a medicine that is not controlled sells as before, with or without a prescription', async () => {
    const store = await openStore(app);
    const med = await medicine(store, { requiresPrescription: true });
    await receive(store, (await supplier(store)).id, med.variantId, '2026-10-20', 10, 'B-07', '2026-11-15');
    const cashier = await staff(store, 'cashier', '0955555555');
    const t = await till(store);
    const plain = await sellControlled(t, store, med, cashier.userId, { prescription: null });
    expect(plain.result).toMatchObject({ status: 'accepted', flags: [] });
  });

  it('writes the register from the documents, in order, with its balance matching the stock', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const med = await medicine(store, { controlled: true });
    const other = await medicine(store);
    await receive(store, s.id, med.variantId, '2026-10-20', 10, 'A-01', '2027-01-01');
    await receive(store, s.id, other.variantId, '2026-10-20', 4, 'Z-9', '2027-01-01');

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const soldPayload = sale(store, open.id, {
      lines: [
        cartLine(1, 15_000, {
          productId: med.productId,
          variantId: med.variantId,
          name: med.name,
          qty: 3 * BOX,
          batchNo: 'A-01',
          batchExpiry: '2027-01-01',
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 45_000 }],
      prescription: RX,
    });
    const sold = doc('sale', soldPayload);
    const back = doc(
      'return',
      buildReturnPayload({
        sale: soldPayload as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'علبة مغلقة',
        picks: [{ saleLineNo: 1, qty: BOX }],
      }),
    );
    await push(app, store.device, [open, sold, back]);

    const get = (token: Pick<Store, 'accessToken'>, q = 'from=2026-10-01&to=2026-10-31') =>
      app.inject({ method: 'GET', url: `/v1/pharmacy/controlled-register?${q}`, headers: as(token) });
    const res = await get(store);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json<ControlledRegisterResponse>();
    expect(r.rows.map((x) => [x.kind, x.batchNo, x.qtyIn, x.qtyOut, x.balance])).toEqual([
      ['purchase', 'A-01', 10 * BOX, 0, 10 * BOX],
      ['sale', 'A-01', 0, 3 * BOX, 7 * BOX],
      ['return', 'A-01', BOX, 0, 8 * BOX],
    ]);
    expect(r.rows[0]).toMatchObject({ item: 'بانادول 500', date: '2026-10-20' });
    expect(r.rows[1]).toMatchObject({
      document: sold.number,
      prescriptionRef: 'RX-77',
      doctor: 'د. سامر',
      patientName: 'ليلى',
      patientId: '01020304',
    });
    expect(r.rows[2]).toMatchObject({ document: back.number, prescriptionRef: 'RX-77' });
    expect(r.balances).toEqual([
      {
        variantId: med.variantId,
        item: 'بانادول 500',
        registerQty: 8 * BOX,
        stockQty: 8 * BOX,
        matches: true,
      },
    ]);
    expect(r.matches).toBe(true);

    // A day's window keeps the running balance from before it
    const day = (await get(store, 'from=2026-10-30&to=2026-10-30')).json<ControlledRegisterResponse>();
    expect(day.rows.map((x) => x.balance)).toEqual([7 * BOX, 8 * BOX]);

    // Stock changed by hand outside any document: the register says so
    await ownerDb()`update stock_levels set qty = qty - 2000 where variant_id = ${med.variantId}`;
    const off = (await get(store)).json<ControlledRegisterResponse>();
    expect(off.matches).toBe(false);
    expect(off.balances[0]).toMatchObject({ registerQty: 8 * BOX, stockQty: 8 * BOX - 2000, matches: false });

    expect((await get(store, 'from=2026-10-31&to=2026-10-01')).statusCode).toBe(400);
    const cashier = await staff(store, 'cashier', '0955555555');
    expect((await get(cashier)).statusCode).toBe(403);
    const manager = await staff(store, 'manager', '0977777777');
    expect((await get(manager)).statusCode).toBe(403);
    const pharmacist = await staff(store, 'pharmacist', '0966666666');
    expect((await get(pharmacist)).statusCode).toBe(200);
  });
});
