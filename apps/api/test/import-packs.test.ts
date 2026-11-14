import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ImportResponse, ProductDetail, ProductListResponse } from '@serva/core';
import { ManualClock } from '../src/clock';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, testStore, type TestStore } from './staff';

/**
 * The product import's pack, warranty, serial and batch columns: a pack is a barcode with its
 * quantity and price, an opening quantity carries its batch and expiry and the pieces' numbers
 * through the same opening document as before (Dr 1300 / Cr 3900), and a bad row names its field.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let app: FastifyInstance;
let clock: ManualClock;
let s: TestStore;

beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
  s = await testStore(app);
});

type Values = Record<string, string | number | null>;

async function imported(rows: Values[], existing: 'skip' | 'update' = 'skip') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/import',
    headers: bearer(s.accessToken),
    payload: {
      type: 'products',
      mode: 'commit',
      existing,
      date: '2026-10-30',
      rows: rows.map((values, i) => ({ line: i + 2, values })),
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ImportResponse>();
}

async function productOf(name: string): Promise<ProductDetail> {
  const list = await app.inject({
    method: 'GET',
    url: `/v1/products?q=${encodeURIComponent(name)}`,
    headers: bearer(s.accessToken),
  });
  const [item] = list.json<ProductListResponse>().items;
  const res = await app.inject({
    method: 'GET',
    url: `/v1/products/${item!.id}`,
    headers: bearer(s.accessToken),
  });
  return res.json<ProductDetail>();
}

const amoxil: Values = {
  name: 'أموكسيل 500',
  barcode: '6281234500012',
  price: '5000',
  cost: '3000',
  quantity: '100',
  batch: 'B-2406',
  expiry: '2027-06-30',
};

describe('packs in the product import', () => {
  it('adds a named pack with its barcode, quantity and price beside the unit barcode', async () => {
    const res = await imported([
      {
        ...amoxil,
        quantity: '',
        batch: '',
        expiry: '',
        packName: 'علبة',
        packQty: '12',
        packBarcode: '6281234500029',
        packPrice: '55000',
      },
    ]);
    expect(res.totals).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    const [variant] = (await productOf('أموكسيل')).variants;
    const pack = variant!.barcodes.find((b) => b.code === '6281234500029');
    expect(pack).toMatchObject({ packQty: 12_000, packName: 'علبة', packPriceMinor: 5_500_000 });
    expect(variant!.barcodes.find((b) => b.code === '6281234500012')).toMatchObject({ packQty: 1000 });
  });

  it('numbers the pack by itself when the file has no barcode for it', async () => {
    await imported([{ ...amoxil, quantity: '', batch: '', expiry: '', packName: 'كرتونة', packQty: '144' }]);
    const [variant] = (await productOf('أموكسيل')).variants;
    const pack = variant!.barcodes.find((b) => b.packQty === 144_000);
    expect(pack).toMatchObject({ kind: 'internal', packName: 'كرتونة', packPriceMinor: null });
    expect(pack!.code).toMatch(/^29/);
  });

  it('adds a pack to a product the store already has, once, and a second run changes nothing', async () => {
    await imported([{ ...amoxil, quantity: '', batch: '', expiry: '' }]);
    const withPack = { ...amoxil, quantity: '', batch: '', expiry: '', packName: 'علبة', packQty: '10' };
    const first = await imported([withPack], 'update');
    expect(first.results[0]).toMatchObject({ status: 'update' });
    const second = await imported([withPack], 'update');
    expect(second.results[0]).toMatchObject({ status: 'skip' });
    const [variant] = (await productOf('أموكسيل')).variants;
    expect(variant!.barcodes.filter((b) => b.packQty === 10_000)).toHaveLength(1);
    expect(variant!.barcodes).toHaveLength(2);
  });

  it('refuses a pack without a size, one that is not bigger than a unit, and a barcode that repeats the unit', async () => {
    const res = await imported([
      { ...amoxil, quantity: '', batch: '', expiry: '', packName: 'علبة' },
      { ...amoxil, barcode: '6281234500036', quantity: '', batch: '', expiry: '', packQty: '1' },
      {
        ...amoxil,
        barcode: '6281234500043',
        quantity: '',
        batch: '',
        expiry: '',
        packQty: '6',
        packBarcode: '6281234500043',
      },
    ]);
    expect(res.totals.error).toBe(3);
    expect(res.results[0]!.errors[0]).toMatchObject({ field: 'packQty' });
    expect(res.results[1]!.errors[0]).toMatchObject({ field: 'packQty' });
    expect(res.results[2]!.errors[0]).toMatchObject({ field: 'packBarcode' });
  });

  it('sets the warranty months and the serial flag of a new product', async () => {
    await imported([
      {
        name: 'جوال X',
        barcode: '6281234500050',
        price: '2000000',
        warrantyMonths: '12',
        tracksSerial: 'نعم',
      },
    ]);
    expect(await productOf('جوال')).toMatchObject({ warrantyMonths: 12, tracksSerial: true });
    const bad = await imported([
      { name: 'جوال Y', barcode: '6281234500067', price: '10', warrantyMonths: '200' },
      { name: 'جوال Z', barcode: '6281234500074', price: '10', warrantyMonths: '1.5' },
    ]);
    expect(bad.results.map((r) => r.errors[0]?.field)).toEqual(['warrantyMonths', 'warrantyMonths']);
  });
});

describe('opening stock with batches and serial numbers', () => {
  const ledger = () =>
    ownerDb()`select batch_no, expiry_date::text as expiry, qty::int as qty, kind from batch_movements
      where tenant_id = ${s.tenantId} order by batch_no`;

  it('carries the batch and expiry into the batch ledger through the opening document', async () => {
    const res = await imported([amoxil]);
    expect(res.totals).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect(await ledger()).toEqual([
      { batch_no: 'B-2406', expiry: '2027-06-30', qty: 100_000, kind: 'count' },
    ]);
    const [stock] =
      await ownerDb()`select sum(qty)::int as qty from stock_levels where tenant_id = ${s.tenantId}`;
    expect(stock!.qty).toBe(100_000);
    const entries =
      await ownerDb()`select source_type from journal_entries where tenant_id = ${s.tenantId} and source_type = 'stocktake'`;
    expect(entries).toHaveLength(1);
    const [nearest] =
      await ownerDb()`select nearest_expiry::text as d from variants where tenant_id = ${s.tenantId}`;
    expect(nearest!.d).toBe('2027-06-30');
  });

  it('takes a second batch of the same item from a row that repeats the barcode', async () => {
    const res = await imported([amoxil, { ...amoxil, quantity: '40', batch: 'B-2501', expiry: '30/6/2028' }]);
    expect(res.totals).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    expect(res.results[1]!.notes.join(' ')).toContain('دفعة إضافية');
    expect(await ledger()).toEqual([
      { batch_no: 'B-2406', expiry: '2027-06-30', qty: 100_000, kind: 'count' },
      { batch_no: 'B-2501', expiry: '2028-06-30', qty: 40_000, kind: 'count' },
    ]);
    const [stock] =
      await ownerDb()`select sum(qty)::int as qty from stock_levels where tenant_id = ${s.tenantId}`;
    expect(stock!.qty).toBe(140_000);
  });

  it('refuses a repeated barcode that brings no batch of its own, and names the line', async () => {
    const res = await imported([amoxil, { ...amoxil, batch: '', expiry: '' }]);
    expect(res.results[1]!.errors[0]).toMatchObject({ field: 'barcode' });
    expect(res.results[1]!.errors[0]!.message).toContain('2');
  });

  it('refuses a batch with no quantity and an expiry that is not a date', async () => {
    const res = await imported([
      { ...amoxil, quantity: '' },
      { ...amoxil, barcode: '6281234500036', expiry: '2027-13-45' },
    ]);
    expect(res.results[0]!.errors[0]).toMatchObject({ field: 'quantity' });
    expect(res.results[1]!.errors[0]).toMatchObject({ field: 'expiry' });
  });

  it('receives one serial number per piece of a tracked item', async () => {
    const phone: Values = {
      name: 'جوال X',
      barcode: '6281234500050',
      price: '2000000',
      cost: '1500000',
      quantity: '3',
      tracksSerial: 'نعم',
      warrantyMonths: '12',
      serials: 'IMEI-0001, IMEI-0002\nIMEI-0003',
    };
    const res = await imported([phone]);
    expect(res.totals.error).toBe(0);
    const rows =
      await ownerDb()`select serial, status from serials where tenant_id = ${s.tenantId} order by serial`;
    expect(rows).toEqual([
      { serial: 'IMEI-0001', status: 'in_stock' },
      { serial: 'IMEI-0002', status: 'in_stock' },
      { serial: 'IMEI-0003', status: 'in_stock' },
    ]);
    const [stock] =
      await ownerDb()`select sum(qty)::int as qty from stock_levels where tenant_id = ${s.tenantId}`;
    expect(stock!.qty).toBe(3000);
  });

  it('refuses a tracked item whose numbers do not match its quantity, or that are already in the store', async () => {
    const phone: Values = {
      name: 'جوال X',
      barcode: '6281234500050',
      price: '2000000',
      quantity: '3',
      tracksSerial: 'نعم',
      serials: 'IMEI-0001, IMEI-0002',
    };
    const few = await imported([phone]);
    expect(few.results[0]!.errors[0]).toMatchObject({ field: 'serials' });
    expect(few.results[0]!.errors[0]!.message).toContain('3');

    await imported([{ ...phone, serials: 'IMEI-0001, IMEI-0002, IMEI-0003' }]);
    const again = await imported([
      { ...phone, name: 'جوال Y', barcode: '6281234500067', serials: 'IMEI-0003, IMEI-0004, IMEI-0005' },
    ]);
    expect(again.results[0]!.errors[0]).toMatchObject({ field: 'serials' });
    expect(again.results[0]!.errors[0]!.message).toContain('IMEI-0003');
  });

  it('refuses numbers for an item that does not track them, and the same number in two rows', async () => {
    const res = await imported([
      { name: 'قلم', barcode: '6281234500081', price: '100', quantity: '2', serials: 'SN-1111, SN-2222' },
      {
        name: 'جوال A',
        barcode: '6281234500098',
        price: '10',
        quantity: '1',
        tracksSerial: 'نعم',
        serials: 'SN-3333',
      },
      {
        name: 'جوال B',
        barcode: '6281234500104',
        price: '10',
        quantity: '1',
        tracksSerial: 'نعم',
        serials: 'SN-3333',
      },
    ]);
    expect(res.results[0]!.errors[0]).toMatchObject({ field: 'serials' });
    expect(res.results[1]!.status).toBe('create');
    expect(res.results[2]!.errors[0]).toMatchObject({ field: 'serials' });
    expect(res.results[2]!.errors[0]!.message).toContain('3');
  });
});
