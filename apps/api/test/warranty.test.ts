import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductDetail, SupplierRow, WarrantyClaim, WarrantyLookup } from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Warranty and maintenance claims (03 › الإلكترونيات والأدوات الطبية): a sold serial gives its sale,
 * its customer and its warranty end; a claim follows received → sent → ready → delivered and moves
 * no stock and posts nothing.
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

/** A store with two phones received and one of them sold to a named customer */
async function storeWithSoldPhone() {
  const store = await openStore(app);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'سامسونج A15',
        tracksSerial: true,
        warrantyMonths: 12,
        variants: [{ price: { currency: 'SYP', priceMinor: 2_000_000 } }],
      },
    })
  ).json<ProductDetail>();
  const variantId = product.variants[0]!.id;
  const s = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'وكيل' } })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: s.id,
      date: '2026-10-29',
      payment: 'cash',
      lines: [{ variantId, qty: 2000, costMinor: 3_000_000, serials: ['IMEI001', 'IMEI002'] }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const customer = await app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: as(store),
    payload: { name: 'سامر الحلبي', phone: '0944111222' },
  });
  expect(customer.statusCode, customer.body).toBe(201);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc(
    'sale',
    sale(store, open.id, {
      customerId: customer.json<{ id: string }>().id,
      customerName: 'سامر الحلبي',
      lines: [
        cartLine(1, 2_000_000, {
          productId: product.id,
          variantId,
          name: product.nameAr,
          qty: 1000,
          serials: ['IMEI001'],
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
    }),
  );
  await push(app, store.device, [open, sold]);
  return { store, sold };
}

const post = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: as(store), payload });

describe('the warranty lookup', () => {
  it('finds a sold serial with its sale, customer and warranty end', async () => {
    const { store, sold } = await storeWithSoldPhone();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=imei%20001',
      headers: as(store),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<WarrantyLookup>()).toMatchObject({
      serial: 'IMEI001',
      item: 'سامسونج A15',
      saleNumber: sold.number,
      soldOn: '2026-10-30',
      warrantyUntil: '2027-10-30',
      customerName: 'سامر الحلبي',
      customerPhone: expect.stringContaining('944111222'),
      claims: [],
    });
  });

  it('answers 404 for an unknown number and for a piece still in stock', async () => {
    const { store } = await storeWithSoldPhone();
    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=NOPE999',
      headers: as(store),
    });
    expect(unknown.statusCode).toBe(404);
    const stock = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=IMEI002',
      headers: as(store),
    });
    expect(stock.statusCode).toBe(404);
    expect(stock.json()).toMatchObject({ error: { code: 'not_found' } });
    const short = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=ab',
      headers: as(store),
    });
    expect(short.statusCode).toBe(400);
  });
});

describe('a claim', () => {
  it('goes received, sent, ready, delivered, with its days, and never back', async () => {
    const { store } = await storeWithSoldPhone();
    const made = await post(store, '/v1/warranty/claims', {
      serial: 'IMEI001',
      issue: 'الشاشة لا تعمل',
      receivedOn: '2026-11-02',
      note: 'جاء مع الشاحن',
    });
    expect(made.statusCode, made.body).toBe(201);
    let claim = made.json<WarrantyClaim>();
    expect(claim).toMatchObject({
      number: 'WC-000001',
      status: 'received',
      serial: 'IMEI001',
      item: 'سامسونج A15',
      underWarranty: true,
      warrantyUntil: '2027-10-30',
      customerName: 'سامر الحلبي',
      events: [{ status: 'received', on: '2026-11-02', note: 'جاء مع الشاحن' }],
    });

    // One open claim per piece
    const twice = await post(store, '/v1/warranty/claims', { serial: 'IMEI001', issue: 'مرة ثانية' });
    expect(twice.statusCode).toBe(409);

    // «sent» needs where to
    const noWhere = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'sent',
      version: claim.version,
    });
    expect(noWhere.statusCode).toBe(400);

    const sent = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'sent',
      version: claim.version,
      sentTo: 'وكيل سامسونج',
      on: '2026-11-03',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    claim = sent.json<WarrantyClaim>();
    expect(claim).toMatchObject({ status: 'sent', sentTo: 'وكيل سامسونج' });

    // A stale version is refused, a step before the last one too
    const stale = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'ready',
      version: claim.version - 1,
    });
    expect(stale.statusCode).toBe(409);
    const early = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'ready',
      version: claim.version,
      on: '2026-11-01',
    });
    expect(early.statusCode).toBe(400);

    const ready = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'ready',
      version: claim.version,
      on: '2026-11-09',
      note: 'تم تبديل الشاشة',
    });
    claim = ready.json<WarrantyClaim>();
    expect(claim.status).toBe('ready');
    const delivered = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'delivered',
      version: claim.version,
      on: '2026-11-10',
    });
    claim = delivered.json<WarrantyClaim>();
    expect(claim.events.map((e) => [e.status, e.on])).toEqual([
      ['received', '2026-11-02'],
      ['sent', '2026-11-03'],
      ['ready', '2026-11-09'],
      ['delivered', '2026-11-10'],
    ]);
    const back = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'ready',
      version: claim.version,
    });
    expect(back.statusCode).toBe(400);

    // Delivered claims leave the open list, and the serial can have a new one
    const open = await app.inject({ method: 'GET', url: '/v1/warranty/claims', headers: as(store) });
    expect(open.json<{ items: WarrantyClaim[] }>().items).toEqual([]);
    const all = await app.inject({
      method: 'GET',
      url: '/v1/warranty/claims?status=all',
      headers: as(store),
    });
    expect(all.json<{ items: WarrantyClaim[] }>().items.map((c) => c.number)).toEqual(['WC-000001']);
    const again = await post(store, '/v1/warranty/claims', { serial: 'IMEI001', issue: 'عطل آخر' });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<WarrantyClaim>().number).toBe('WC-000002');
    const looked = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=IMEI001',
      headers: as(store),
    });
    expect(looked.json<WarrantyLookup>().claims.map((c) => c.number)).toEqual(['WC-000002', 'WC-000001']);
  });

  it('says the warranty had ended when the piece comes back late, and refuses unknown or unsold numbers', async () => {
    const { store } = await storeWithSoldPhone();
    const late = await post(store, '/v1/warranty/claims', {
      serial: 'IMEI001',
      issue: 'لا يشحن',
      receivedOn: '2027-12-01',
    });
    expect(late.json<WarrantyClaim>()).toMatchObject({ underWarranty: false });
    expect((await post(store, '/v1/warranty/claims', { serial: 'NOPE999', issue: 'x' })).statusCode).toBe(
      400,
    );
    expect((await post(store, '/v1/warranty/claims', { serial: 'IMEI002', issue: 'x' })).statusCode).toBe(
      400,
    );
    expect((await post(store, '/v1/warranty/claims', { serial: 'IMEI001', issue: '' })).statusCode).toBe(400);
  });

  it('touches neither stock nor the books', async () => {
    const { store } = await storeWithSoldPhone();
    const count = async () => {
      const db = ownerDb();
      const [r] = await db<{ s: string; j: string }[]>`
        select (select count(*) from stock_movements where tenant_id = ${store.tenantId})::text as s,
               (select count(*) from journal_entries where tenant_id = ${store.tenantId})::text as j`;
      return r;
    };
    const before = await count();
    const made = await post(store, '/v1/warranty/claims', { serial: 'IMEI001', issue: 'عطل' });
    const claim = made.json<WarrantyClaim>();
    await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'delivered',
      version: claim.version,
    });
    expect(await count()).toEqual(before);
    const [serial] = await ownerDb()<
      { status: string }[]
    >`select status from serials where tenant_id = ${store.tenantId} and serial = 'IMEI001'`;
    expect(serial!.status).toBe('sold');
  });

  it('is for whoever manages the catalog, not a cashier, and each store sees only its own', async () => {
    const { store } = await storeWithSoldPhone();
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0955555555');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/warranty/claims',
      headers: { authorization: `Bearer ${cashier.accessToken}` },
    });
    expect(denied.statusCode).toBe(403);
    const other = await openStore(app, '0966666666');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/warranty/claims?status=all',
      headers: as(other),
    });
    expect(list.json<{ items: WarrantyClaim[] }>().items).toEqual([]);
    const seen = await app.inject({
      method: 'GET',
      url: '/v1/warranty/lookup?serial=IMEI001',
      headers: as(other),
    });
    expect(seen.statusCode).toBe(404);
  });
});

describe('a claim’s repair details', () => {
  it('keeps the technician, the loan unit, the cost and the paid repair, and finds the piece by invoice and customer', async () => {
    const { store, sold } = await storeWithSoldPhone();
    const made = await post(store, '/v1/warranty/claims', {
      serial: 'IMEI001',
      issue: 'لا يشحن',
      technician: 'أبو خالد',
      loanItem: 'جوال بديل A05',
      paidRepair: true,
    });
    expect(made.statusCode, made.body).toBe(201);
    const claim = made.json<WarrantyClaim>();
    expect(claim).toMatchObject({
      technician: 'أبو خالد',
      loanItem: 'جوال بديل A05',
      paidRepair: true,
      costMinor: null,
      repairSaleNumber: null,
    });
    const ready = await post(store, `/v1/warranty/claims/${claim.id}/status`, {
      status: 'ready',
      version: claim.version,
      costMinor: 150_000,
      repairSaleNumber: 'INV-001-001-0000099',
    });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json<WarrantyClaim>()).toMatchObject({
      costMinor: 150_000,
      technician: 'أبو خالد',
      repairSaleNumber: 'INV-001-001-0000099',
    });

    // From the invoice and from the customer: the serial with its buyer, ready to open a claim on
    const [invoice] = await ownerDb()<
      { id: string }[]
    >`select id from invoices where number = ${sold.number!}`;
    const saleId = invoice!.id;
    const bySale = await app.inject({
      method: 'GET',
      url: `/v1/serials?saleId=${saleId}`,
      headers: as(store),
    });
    expect(bySale.json<{ items: { serial: string; customerName: string | null }[] }>().items).toEqual([
      expect.objectContaining({ serial: 'IMEI001', customerName: 'سامر الحلبي' }),
    ]);
  });
});
