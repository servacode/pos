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

  it('a number two sales took stays with the sale the owner picks', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['KEEP-1']);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const mk = () =>
      doc(
        'sale',
        sale(store, open.id, {
          lines: [cartLine(1, 2_000_000, { ...a15, serials: ['KEEP-1'] })],
          payments: salePayments,
        }),
      );
    const first = mk();
    const second = mk();
    await push(app, store.device, [open, first, second]);
    const row = await history(store, 'KEEP-1');
    expect(row.saleNumber).toBe(first.number);
    const other = row.sales.find((x) => x.saleNumber === second.number)!;
    const fix = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/serials/fix', headers: as(store), payload });
    // Already with that sale, or a sale that never took it: refused
    expect((await fix({ serial: 'KEEP-1', status: 'sold', keepSaleId: row.saleId })).statusCode).toBe(400);
    expect(
      (await fix({ serial: 'KEEP-1', status: 'sold', keepSaleId: '00000000-0000-4000-8000-000000000000' }))
        .statusCode,
    ).toBe(400);
    expect((await fix({ serial: 'KEEP-1', status: 'in_stock', keepSaleId: other.saleId })).statusCode).toBe(
      400,
    );
    expect((await fix({ serial: 'KEEP-1', status: 'sold', keepSaleId: other.saleId })).statusCode).toBe(200);
    const after = await history(store, 'KEEP-1');
    expect(after.saleNumber).toBe(second.number);
    // The history keeps both sales, the repeat still flagged
    expect(after.flags).toEqual(['duplicate']);
    expect(after.sales).toHaveLength(2);
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

  it('accepts a sale that left without its number, flags it, and the owner picks which piece left', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['MISS-1', 'MISS-2', 'MISS-3']);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, qty: 2000, serials: ['MISS-1'] })],
        payments: [{ method: 'cash' as const, currency: 'SYP' as const, amountMinor: 4_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    // Never rejected: accepted and flagged
    expect(res.results[1]!.status).toBe('accepted');
    expect(res.results[1]!.flags).toEqual(expect.arrayContaining(['serial_missing']));
    // A full sale of a tracked product carries no such flag
    const list = async () =>
      (await app.inject({ method: 'GET', url: '/v1/serials/unassigned', headers: as(store) })).json<{
        items: { saleId: string; missing: number; candidates: string[]; saleNumber: string }[];
      }>().items;
    const [item] = await list();
    expect(item).toMatchObject({ saleId: sold.id, missing: 1, saleNumber: sold.number });
    expect(item!.candidates).toEqual(['MISS-2', 'MISS-3']);
    const fix = (serial: string, saleId = sold.id) =>
      app.inject({
        method: 'POST',
        url: '/v1/serials/fix',
        headers: as(store),
        payload: { serial, status: 'sold', saleId },
      });
    expect((await fix('MISS-1')).statusCode).toBe(400); // already sold by this sale
    expect((await fix('MISS-2', '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const fixed = await fix('MISS-2');
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(await history(store, 'MISS-2')).toMatchObject({ status: 'sold', saleNumber: sold.number });
    expect(await list()).toEqual([]);
    expect((await fix('MISS-3')).statusCode).toBe(400); // nothing is missing any more
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

    const moved = await send(
      '/v1/transfers',
      { fromBranchId: main!.id, toBranchId: mall!.id, mode: 'instant' },
      ['OUT-2'],
    );
    expect(moved.statusCode, moved.body).toBe(201);
    const [branch] = await owner.db.execute<{ branch_id: string }>(
      sql`select branch_id from serials where serial = 'OUT-2'`,
    );
    expect(branch!.branch_id).toBe(mall!.id);
    // It is no longer in the sender's stock
    const lost = await send(
      '/v1/transfers',
      { fromBranchId: main!.id, toBranchId: mall!.id, mode: 'instant' },
      ['OUT-2'],
    );
    expect(lost.statusCode).toBe(400);
  });

  it('a count that finds fewer phones names the numbers that left, so the serial list agrees (round 60)', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    await received(store, a15, ['CNT-1', 'CNT-2', 'CNT-3']);
    const count = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/stocktakes',
        headers: as(store),
        payload: { date: '2026-10-30', ...payload },
      });
    const line = (extra: Record<string, unknown>) => ({
      lines: [{ variantId: a15.variantId, countedQty: 2000, ...extra }],
    });
    // A shortage with no numbers is refused, one with the wrong number too: nothing was posted
    const bare = await count(line({}));
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.fields['lines.0.serials']).toContain('1');
    const ghost = await count(line({ serials: ['NOPE'] }));
    expect(ghost.json().error.fields['lines.0.serials']).toContain('NOPE');
    expect(await history(store, 'CNT-2')).toMatchObject({ status: 'in_stock' });
    const ok = await count(line({ serials: ['cnt-2'] }));
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await history(store, 'CNT-2')).toMatchObject({ status: 'lost' });
    expect(await history(store, 'CNT-1')).toMatchObject({ status: 'in_stock' });
    // Counted at its book figure (no shortage): no numbers asked
    expect((await count(line({ countedQty: 2000 }))).statusCode).toBe(201);
    // The phone's count against an older sheet is never refused for want of numbers
    const phoneCount = await count({
      countedAt: new Date().toISOString(),
      lines: [{ variantId: a15.variantId, countedQty: 1000 }],
    });
    expect(phoneCount.statusCode, phoneCount.body).toBe(201);
    // The list the count picks from: only what is in stock
    const pick = await app.inject({
      method: 'GET',
      url: `/v1/inventory/serials?variantId=${a15.variantId}&branchId=${
        (
          await owner.db.execute<{ id: string }>(
            sql`select id from branches where tenant_id = ${store.tenantId}`,
          )
        )[0]!.id
      }`,
      headers: as(store),
    });
    expect(pick.statusCode, pick.body).toBe(200);
    expect(pick.json().items).toEqual(['CNT-1', 'CNT-3']);
  });

  describe('round 62: counts, write-offs and the serial list agree', () => {
    const branchOf = async (store: Store) =>
      (
        await owner.db.execute<{ id: string }>(
          sql`select id from branches where tenant_id = ${store.tenantId}`,
        )
      )[0]!.id;
    const count = (
      store: Store,
      variantId: string,
      countedQty: number,
      extra: Record<string, unknown> = {},
    ) =>
      app.inject({
        method: 'POST',
        url: '/v1/stocktakes',
        headers: as(store),
        payload: { date: '2026-10-30', lines: [{ variantId, countedQty }], ...extra },
      });
    const drift = async (store: Store) =>
      (await app.inject({ method: 'GET', url: '/v1/serials/drift', headers: as(store) })).json<{
        items: { variantId: string; stockPieces: number; serialPieces: number }[];
      }>().items;
    const fix = (store: Store, serial: string, status: string) =>
      app.inject({ method: 'POST', url: '/v1/serials/fix', headers: as(store), payload: { serial, status } });

    it('a write-off that says serials later goes through, the drift shows it, and lost puts it right', async () => {
      const store = await openStore(app);
      const a15 = await phone(store);
      await received(store, a15, ['LT-1', 'LT-2', 'LT-3']);
      expect(await drift(store)).toEqual([]);
      const refused = await count(store, a15.variantId, 2000);
      expect(refused.statusCode).toBe(400);
      const later = await count(store, a15.variantId, 2000, { serialsLater: true });
      expect(later.statusCode, later.body).toBe(201);
      // Nothing named a number: all three are still in stock against two in the stock level
      expect(await history(store, 'LT-3')).toMatchObject({ status: 'in_stock' });
      expect(await drift(store)).toEqual([
        { variantId: a15.variantId, name: expect.any(String), stockPieces: 2, serialPieces: 3 },
      ]);
      // Lost: only a number in stock can be marked, and it moves no stock
      const done = await fix(store, 'lt-3', 'lost');
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json()).toEqual({ serial: 'LT-3', status: 'lost' });
      expect(await history(store, 'LT-3')).toMatchObject({ status: 'lost' });
      expect(await drift(store)).toEqual([]);
      expect((await fix(store, 'LT-3', 'lost')).statusCode).toBe(400);
      // A lost number can only come back to the shop, not be sold again by magic
      expect((await fix(store, 'LT-3', 'sold')).statusCode).toBe(400);
      expect((await fix(store, 'LT-3', 'in_stock')).statusCode).toBe(200);
    });

    it('a surplus of a tracked product needs its numbers, the lenient paths do not', async () => {
      const store = await openStore(app);
      const a15 = await phone(store);
      await received(store, a15, ['SP-1', 'SP-2']);
      const bare = await count(store, a15.variantId, 5000);
      expect(bare.statusCode).toBe(400);
      expect(bare.json().error.fields['lines.0.serials']).toContain('3');
      const few = await count(store, a15.variantId, 5000, {
        lines: [{ variantId: a15.variantId, countedQty: 5000, serials: ['SP-3'] }],
      });
      expect(few.statusCode).toBe(400);
      const taken = await count(store, a15.variantId, 3000, {
        lines: [{ variantId: a15.variantId, countedQty: 3000, serials: ['SP-1'] }],
      });
      expect(taken.statusCode).toBe(400);
      expect(taken.json().error.fields.lines).toContain('SP-1');
      expect(await drift(store)).toEqual([]);
      const ok = await count(store, a15.variantId, 4000, {
        lines: [{ variantId: a15.variantId, countedQty: 4000, serials: ['sp-3', 'SP-4'] }],
      });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(await history(store, 'SP-4')).toMatchObject({ status: 'in_stock' });
      // An offline phone's count still adds stock with no numbers
      const phoneCount = await count(store, a15.variantId, 5000, { countedAt: new Date().toISOString() });
      expect(phoneCount.statusCode, phoneCount.body).toBe(201);
      expect(await drift(store)).toEqual([
        { variantId: a15.variantId, name: expect.any(String), stockPieces: 5, serialPieces: 4 },
      ]);
    });

    it('a product that does not track numbers takes none in a count', async () => {
      const store = await openStore(app);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/products',
        headers: as(store),
        payload: { nameAr: 'كفر', variants: [{ price: { currency: 'SYP', priceMinor: 10_000 } }] },
      });
      const variantId = res.json<ProductDetail>().variants[0]!.id;
      const bad = await count(store, variantId, 2000, {
        lines: [{ variantId, countedQty: 2000, serials: ['X-1', 'X-2'] }],
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.fields['lines.0.serials']).toBeTruthy();
      expect((await count(store, variantId, 2000)).statusCode).toBe(201);
    });

    it('a number counted lost is accepted back when the count finds it again', async () => {
      const store = await openStore(app);
      const a15 = await phone(store);
      await received(store, a15, ['LOST-1', 'LOST-2']);
      const gone = await count(store, a15.variantId, 1000, {
        lines: [{ variantId: a15.variantId, countedQty: 1000, serials: ['LOST-2'] }],
      });
      expect(gone.statusCode, gone.body).toBe(201);
      expect(await history(store, 'LOST-2')).toMatchObject({ status: 'lost' });
      const found = await count(store, a15.variantId, 2000, {
        lines: [{ variantId: a15.variantId, countedQty: 2000, serials: ['LOST-2'] }],
      });
      expect(found.statusCode, found.body).toBe(201);
      expect(await history(store, 'LOST-2')).toMatchObject({ status: 'in_stock' });
      expect(await drift(store)).toEqual([]);
      // A number that is in stock is still refused
      const again = await count(store, a15.variantId, 3000, {
        lines: [{ variantId: a15.variantId, countedQty: 3000, serials: ['LOST-1'] }],
      });
      expect(again.statusCode).toBe(400);
    });

    it('stock with no numbers gets them added by the owner, and one products numbers can be listed', async () => {
      const store = await openStore(app);
      const a15 = await phone(store);
      await received(store, a15, ['AD-1']);
      const surplus = await count(store, a15.variantId, 3000, { countedAt: new Date().toISOString() });
      expect(surplus.statusCode, surplus.body).toBe(201);
      expect(await drift(store)).toEqual([
        { variantId: a15.variantId, name: expect.any(String), stockPieces: 3, serialPieces: 1 },
      ]);
      const add = (serial: string, variantId: string | null = a15.variantId) =>
        app.inject({
          method: 'POST',
          url: '/v1/serials/fix',
          headers: as(store),
          payload: { serial, status: 'in_stock', ...(variantId ? { variantId } : {}) },
        });
      // Without a product the number is simply unknown; a product that does not track numbers takes none
      expect((await add('ad-2', null)).statusCode).toBe(404);
      expect((await add('ad-2')).statusCode).toBe(200);
      expect((await add('ad-3')).statusCode).toBe(200);
      expect(await history(store, 'AD-3')).toMatchObject({ status: 'in_stock' });
      expect(await drift(store)).toEqual([]);
      const mine = await app.inject({
        method: 'GET',
        url: `/v1/serials?variantId=${a15.variantId}`,
        headers: as(store),
      });
      expect(
        mine
          .json<{ items: SerialRow[] }>()
          .items.map((r) => r.serial)
          .sort(),
      ).toEqual(['AD-1', 'AD-2', 'AD-3']);
    });

    it('the picker finds a number by part of it and says when the list was cut', async () => {
      const store = await openStore(app);
      const a15 = await phone(store);
      await received(store, a15, ['AB-100', 'AB-200', 'CD-300']);
      const branchId = await branchOf(store);
      const find = async (q: string) =>
        (
          await app.inject({
            method: 'GET',
            url: `/v1/inventory/serials?variantId=${a15.variantId}&branchId=${branchId}&q=${encodeURIComponent(q)}`,
            headers: as(store),
          })
        ).json<{ items: string[]; truncated: boolean }>();
      expect((await find('ab-')).items).toEqual(['AB-100', 'AB-200']);
      expect((await find('300')).items).toEqual(['CD-300']);
      // A wildcard typed in the box is text, not a pattern
      expect((await find('%')).items).toEqual([]);
      expect((await find('_')).items).toEqual([]);
      expect(await find('')).toMatchObject({ items: ['AB-100', 'AB-200', 'CD-300'], truncated: false });
    });
  });
});
