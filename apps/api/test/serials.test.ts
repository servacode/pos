import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type ProductDetail,
  type PurchaseDetail,
  type SalePayload,
  type SerialRow,
  type SupplierRow,
} from '@serva/core';
import { sql } from 'drizzle-orm';
import { createDb } from '@serva/db';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Electronics and phones (03 › الإلكترونيات والجوالات): pieces received and sold by their serial
 * number or IMEI, with their warranty; a sale is never refused for a number, only flagged.
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

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function phone(store: Store, nameAr = 'سامسونج A15') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr,
      tracksSerial: true,
      warrantyMonths: 12,
      variants: [{ price: { currency: 'SYP', priceMinor: 2_000_000 } }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  expect(p).toMatchObject({ tracksSerial: true, warrantyMonths: 12 });
  return { productId: p.id, variantId: p.variants[0]!.id, name: p.nameAr };
}

async function supplier(store: Store) {
  return (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'وكيل' } })
  ).json<SupplierRow>();
}

const purchase = (store: Store, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/purchases', headers: as(store), payload: body });

const lookup = async (store: Store, q = '') =>
  (await app.inject({ method: 'GET', url: `/v1/serials${q ? `?q=${q}` : ''}`, headers: as(store) })).json<{
    items: SerialRow[];
  }>().items;

describe('serial numbers', () => {
  it('receives one number per piece, sells them with their warranty, and a whole return brings them back', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const a15 = await phone(store);
    const base = { supplierId: s.id, date: '2026-10-29', payment: 'cash' };
    const short = await purchase(store, {
      ...base,
      lines: [{ variantId: a15.variantId, qty: 3000, costMinor: 4_500_000, serials: ['IMEI-1', 'IMEI-2'] }],
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({
      error: { fields: { 'lines.0.serials': expect.stringContaining('3') } },
    });
    const ok = await purchase(store, {
      ...base,
      lines: [
        {
          variantId: a15.variantId,
          qty: 3000,
          costMinor: 4_500_000,
          serials: ['imei 001', 'IMEI002', 'IMEI003'],
        },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json<PurchaseDetail>().lines[0]!.serials).toEqual(['IMEI001', 'IMEI002', 'IMEI003']);
    const again = await purchase(store, {
      ...base,
      lines: [{ variantId: a15.variantId, qty: 1000, costMinor: 1_500_000, serials: ['IMEI001'] }],
    });
    expect(again.json()).toMatchObject({
      error: { fields: { lines: 'الرقم IMEI001 موجود في المحل من قبل' } },
    });

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, qty: 2000, serials: ['IMEI001', 'IMEI002'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 4_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results.map((r) => r.flags)).toEqual([[], []]);
    const after = await lookup(store);
    expect(after.map((r) => [r.serial, r.status, r.warrantyUntil])).toEqual(
      expect.arrayContaining([
        ['IMEI001', 'sold', '2027-10-30'],
        ['IMEI002', 'sold', '2027-10-30'],
        ['IMEI003', 'in_stock', null],
      ]),
    );
    expect((await lookup(store, 'imei001'))[0]).toMatchObject({
      name: 'سامسونج A15',
      purchaseNumber: expect.stringMatching(/^PUR-/),
      saleNumber: sold.number,
      soldOn: '2026-10-30',
    });

    // The whole line comes back
    const ret = doc(
      'return',
      buildReturnPayload({
        sale: sold.payload as unknown as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'لا يعمل',
        picks: [{ saleLineNo: 1, qty: 2000 }],
      }),
    );
    const back = await push(app, store.device, [ret]);
    expect(back.results[0]!.status, JSON.stringify(back.results[0])).toBe('accepted');
    expect((await lookup(store, 'IMEI001'))[0]).toMatchObject({ status: 'in_stock', saleNumber: null });
  });

  it('a number never received is recorded and flagged; one sold twice is flagged; the rebuild agrees', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const first = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['GHOST-1'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
      }),
    );
    const second = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['GHOST-1'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, first, second]);
    expect(res.results.map((r) => r.flags)).toEqual([
      [],
      expect.arrayContaining(['unknown_serial']),
      expect.arrayContaining(['serial_sold_twice']),
    ]);
    expect((await lookup(store, 'GHOST'))[0]).toMatchObject({ status: 'sold', saleNumber: first.number });
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-31T00:00:00Z'),
    });
    expect(rebuilt.same).toBe(true);
  });
});

describe('serial tracking at the till and on the server', () => {
  const salePayments = [{ method: 'cash' as const, currency: 'SYP' as const, amountMinor: 2_000_000 }];
  const history = async (store: Store, serial: string) =>
    (await lookup(store, serial)).find((r) => r.serial === serial)!;

  async function received(store: Store, a15: Awaited<ReturnType<typeof phone>>, list: string[]) {
    const s = await supplier(store);
    const ok = await purchase(store, {
      supplierId: s.id,
      date: '2026-10-29',
      payment: 'cash',
      lines: [
        {
          variantId: a15.variantId,
          qty: list.length * 1000,
          costMinor: 1_000_000 * list.length,
          serials: list,
        },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(201);
  }

  it('keeps every sale of a number, flags the repeat, and shows both buyers', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['BP-1001']);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const mk = () =>
      doc(
        'sale',
        sale(store, open.id, {
          lines: [cartLine(1, 2_000_000, { ...a15, serials: ['BP-1001'] })],
          payments: salePayments,
        }),
      );
    const first = mk();
    const second = mk();
    const res = await push(app, store.device, [open, first, second]);
    expect(res.results.map((r) => r.flags)).toEqual([[], [], expect.arrayContaining(['serial_sold_twice'])]);
    const row = await history(store, 'BP-1001');
    expect(row.saleNumber).toBe(first.number);
    expect(row.flags).toEqual(['duplicate']);
    expect(row.sales.map((x) => x.saleNumber).sort()).toEqual([first.number, second.number].sort());
    // The owner's list holds it, and a clean number does not
    const flagged = await app.inject({ method: 'GET', url: '/v1/serials?flagged=1', headers: as(store) });
    expect(flagged.json<{ items: SerialRow[] }>().items.map((r) => r.serial)).toEqual(['BP-1001']);
    // Both invoices are found by the serial
    const found = await app.inject({ method: 'GET', url: '/v1/sales?q=bp-1001', headers: as(store) });
    expect(
      found
        .json<{ items: { number: string }[] }>()
        .items.map((i) => i.number)
        .sort(),
    ).toEqual([first.number, second.number].sort());
  });

  it('flags an unknown number and a manager override, and a purchase entered later adopts it', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [
          cartLine(1, 2_000_000, {
            ...a15,
            serials: ['LATE-1'],
            serialOverrides: ['LATE-1'],
            serialApprovedBy: store.userId,
          }),
        ],
        payments: salePayments,
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results[1]!.flags).toEqual(expect.arrayContaining(['unknown_serial']));
    const row = await history(store, 'LATE-1');
    expect(row).toMatchObject({ status: 'sold', flags: ['override'] });
    // Entered on a purchase afterwards: the row is adopted, not refused
    await received(store, a15, ['LATE-1', 'LATE-2']);
    expect(await history(store, 'LATE-1')).toMatchObject({
      status: 'sold',
      purchaseNumber: expect.stringMatching(/^PUR-/),
    });
    expect(await history(store, 'LATE-2')).toMatchObject({ status: 'in_stock' });
  });

  it('flags a number in stock as another product and leaves that piece in stock', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    const glass = await phone(store, 'سماعة GL');
    await received(store, glass, ['GL-2003']);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['GL-2003'] })],
        payments: salePayments,
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results[1]!.flags).toEqual(expect.arrayContaining(['serial_other_product']));
    expect(await history(store, 'GL-2003')).toMatchObject({ status: 'in_stock', flags: ['other_product'] });
  });

  it('puts a drifted row right with «تصحيح»', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['DRIFT-1']);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['DRIFT-1'] })],
        payments: salePayments,
      }),
    );
    await push(app, store.device, [open, sold]);
    const fix = (status: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/serials/fix',
        headers: as(store),
        payload: { serial: 'drift-1', status },
      });
    expect((await fix('sold')).statusCode).toBe(400);
    expect((await fix('in_stock')).statusCode).toBe(200);
    expect(await history(store, 'DRIFT-1')).toMatchObject({ status: 'in_stock', saleNumber: null });
    expect((await fix('sold')).statusCode).toBe(200);
    expect(await history(store, 'DRIFT-1')).toMatchObject({ status: 'sold', saleNumber: sold.number });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/serials/fix',
          headers: as(store),
          payload: { serial: 'NOPE-1', status: 'in_stock' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('sends a device to the supplier or another branch with its number, and refuses a number that is not there', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['OUT-1', 'OUT-2', 'OUT-3']);
    const [main] = await owner.db.execute<{ id: string }>(
      sql`select id from branches where tenant_id = ${store.tenantId}`,
    );
    const [mall] = await owner.db.execute<{ id: string }>(
      sql`insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع المول') returning id`,
    );
    const send = (url: string, extra: Record<string, unknown>, serials?: string[]) =>
      app.inject({
        method: 'POST',
        url,
        headers: as(store),
        payload: {
          date: '2026-10-30',
          ...extra,
          lines: [
            { variantId: a15.variantId, qty: (serials?.length ?? 1) * 1000, ...(serials ? { serials } : {}) },
          ],
        },
      });
    const supplierId = (await supplier(store)).id;
    // A tracked line needs its numbers, in stock for that product
    const bare = await send('/v1/supplier-returns', { supplierId, refund: 'credit' });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.fields['lines.0.serials']).toContain('1');
    const ghost = await send('/v1/supplier-returns', { supplierId, refund: 'credit' }, ['NOPE-1']);
    expect(ghost.json().error.fields['lines.0.serials']).toContain('NOPE-1');
    const back = await send('/v1/supplier-returns', { supplierId, refund: 'credit' }, ['out-1']);
    expect(back.statusCode, back.body).toBe(201);
    expect(await history(store, 'OUT-1')).toMatchObject({ status: 'returned' });
    // Gone: it cannot go back to the supplier again, nor be transferred
    const again = await send('/v1/supplier-returns', { supplierId, refund: 'credit' }, ['OUT-1']);
    expect(again.statusCode).toBe(400);

    const moved = await send('/v1/transfers', { fromBranchId: main!.id, toBranchId: mall!.id }, ['OUT-2']);
    expect(moved.statusCode, moved.body).toBe(201);
    const [branch] = await owner.db.execute<{ branch_id: string }>(
      sql`select branch_id from serials where serial = 'OUT-2'`,
    );
    expect(branch!.branch_id).toBe(mall!.id);
    // It is no longer in the sender's stock
    const lost = await send('/v1/transfers', { fromBranchId: main!.id, toBranchId: mall!.id }, ['OUT-2']);
    expect(lost.statusCode).toBe(400);
  });
});
