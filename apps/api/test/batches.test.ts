import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type ExpiryResponse,
  type PullSetRows,
  type RecallResponse,
  type SalePayload,
  type StocktakeDetail,
  type SupplierRow,
} from '@serva/core';
import { payloadHash, type PushResponse, type SyncDocument } from '@serva/sync';
import type { PullResponse } from '@serva/sync';
import {
  cartLine,
  documents,
  makeProduct,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { returnShares } from '../src/services/batches';

/**
 * The batch ledger (03 › الصيدليات): real per-batch balances beside the stock, the till's
 * allocations, the expiry report, blocking a batch, writing one off, the supplier return that
 * names its batch, the recall query, and the backfill of a store that had none.
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
beforeEach(resetDatabase, 120_000);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const BOX = 1000;

interface Day {
  store: Store;
  supplier: SupplierRow;
  variantId: string;
  productId: string;
  name: string;
  open: SyncDocument;
  doc: ReturnType<typeof documents>;
}

const receive = async (
  d: Pick<Day, 'store' | 'supplier' | 'variantId'>,
  boxes: number,
  batchNo: string | null,
  expiryDate: string | null,
  extra: Record<string, unknown> = {},
) =>
  app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(d.store),
    payload: {
      supplierId: d.supplier.id,
      date: '2026-10-20',
      payment: 'credit',
      lines: [{ variantId: d.variantId, qty: boxes * BOX, costMinor: boxes * 10_000, batchNo, expiryDate }],
      ...extra,
    },
  });

/** A store with a medicine received in three batches: A-01 (expired), B-07 and C-09 */
async function aDay(): Promise<Day> {
  const store = await openStore(app);
  const supplier = (
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: as(store),
      payload: { name: 'الشفاء' },
    })
  ).json<SupplierRow>();
  const med = await makeProduct(app, store, 'بانادول', 15_000);
  const d = { store, supplier, ...med };
  for (const [boxes, batch, expiry] of [
    [10, 'A-01', '2026-10-25'],
    [5, 'B-07', '2026-11-15'],
    [20, 'C-09', '2027-03-01'],
  ] as const) {
    expect((await receive(d, boxes, batch, expiry)).statusCode).toBe(201);
  }
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  return { ...d, open, doc };
}

const saleOf = (
  d: Day,
  qty: number,
  batches?: { batchNo: string | null; expiry: string | null; qty: number }[],
  extra: Record<string, unknown> = {},
): SalePayload =>
  sale(d.store, d.open.id, {
    lines: [
      cartLine(1, 15_000, {
        productId: d.productId,
        variantId: d.variantId,
        name: d.name,
        qty,
        ...(batches ? { batches } : {}),
      }),
    ],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: (15_000 * qty) / 1000 }],
    ...extra,
  });

const expiry = async (store: Store, days = 400, query = '') =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/inventory/expiry?days=${days}${query}`,
      headers: as(store),
    })
  ).json<ExpiryResponse>();
const balances = async (store: Store, days = 400) =>
  Object.fromEntries((await expiry(store, days)).items.map((r) => [r.batchNo, r.qty]));

async function pushSale(d: Day, payload: SalePayload): Promise<{ doc: SyncDocument; res: PushResponse }> {
  const doc = d.doc('sale', payload);
  const res = await push(app, d.store.device, [d.open, doc]);
  return { doc, res };
}

const flagsOf = (res: PushResponse, id: string) => res.results.find((r) => r.id === id)!.flags;

async function pullStock(store: Store) {
  await settled();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  return (
    res.json<PullResponse>().sets as unknown as { [K in keyof PullSetRows]: { upserts: PullSetRows[K][] } }
  ).stock_levels.upserts;
}

describe('batch balances', () => {
  it('start from the receipts, and an expired batch stays listed with its quantity', async () => {
    const d = await aDay();
    expect(await balances(d.store)).toEqual({ 'A-01': 10 * BOX, 'B-07': 5 * BOX, 'C-09': 20 * BOX });
    const report = await expiry(d.store, 30);
    expect(report.items.map((r) => [r.batchNo, r.daysLeft, r.supplierName, r.branchName !== ''])).toEqual([
      ['A-01', -5, 'الشفاء', true],
      ['B-07', 16, 'الشفاء', true],
    ]);
    expect(report.items[0]).toMatchObject({ blocked: false, purchaseNumber: expect.stringMatching(/^PUR-/) });
    // The till gets the same list on the item's stock level, nearest expiry first
    const [level] = await pullStock(d.store);
    expect(level!.batches).toEqual([
      { batchNo: 'A-01', expiry: '2026-10-25', qty: 10 * BOX, blocked: false },
      { batchNo: 'B-07', expiry: '2026-11-15', qty: 5 * BOX, blocked: false },
      { batchNo: 'C-09', expiry: '2027-03-01', qty: 20 * BOX, blocked: false },
    ]);
  });

  it('take what the sale lines allocated, split over batches, and the expired one stays', async () => {
    const d = await aDay();
    const { res, doc } = await pushSale(
      d,
      saleOf(d, 8 * BOX, [
        { batchNo: 'B-07', expiry: '2026-11-15', qty: 5 * BOX },
        { batchNo: 'C-09', expiry: '2027-03-01', qty: 3 * BOX },
      ]),
    );
    expect(flagsOf(res, doc.id)).toEqual([]);
    expect(await balances(d.store)).toEqual({ 'A-01': 10 * BOX, 'C-09': 17 * BOX });
    // Stock itself moved as it always did: 35 boxes in, 8 out
    const [row] = await ownerDb()<
      { qty: string }[]
    >`select qty from stock_levels where tenant_id = ${d.store.tenantId}`;
    expect(Number(row!.qty)).toBe(27 * BOX);
  });

  it('a sale line with no batch is taken earliest-expiry first from the good batches, never the expired', async () => {
    const d = await aDay();
    await pushSale(d, saleOf(d, 12 * BOX));
    // five good boxes of B-07 first, then seven of C-09; the expired ten were left alone
    expect(await balances(d.store)).toEqual({ 'A-01': 10 * BOX, 'C-09': 13 * BOX });
  });

  it('a line with only the older batchNo is taken from that batch', async () => {
    const d = await aDay();
    const payload = saleOf(d, 2 * BOX);
    payload.lines[0]!.batchNo = 'B-07';
    payload.lines[0]!.batchExpiry = '2026-11-15';
    await pushSale(d, payload);
    expect((await balances(d.store))['B-07']).toBe(3 * BOX);
  });

  it('flag a sale past a batch’s balance, or on a blocked or expired batch, and still accept it', async () => {
    const d = await aDay();
    const over = await pushSale(
      d,
      saleOf(d, 7 * BOX, [{ batchNo: 'B-07', expiry: '2026-11-15', qty: 7 * BOX }]),
    );
    expect(over.res.results.find((r) => r.id === over.doc.id)).toMatchObject({
      status: 'accepted',
      flags: ['batch_over_balance'],
    });
    const expired = await pushSale(d, saleOf(d, BOX, [{ batchNo: 'A-01', expiry: '2026-10-25', qty: BOX }]));
    expect(flagsOf(expired.res, expired.doc.id)).toEqual(['batch_blocked']);
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/batches/block',
      headers: as(d.store),
      payload: { batchNo: 'C-09', reason: 'سحب من المورد' },
    });
    expect(blocked.json()).toEqual({ count: 1 });
    const sold = await pushSale(d, saleOf(d, BOX, [{ batchNo: 'C-09', expiry: '2027-03-01', qty: BOX }]));
    expect(flagsOf(sold.res, sold.doc.id)).toEqual(['batch_blocked']);
  });

  it('are the same for a replayed document, which moves nothing twice', async () => {
    const d = await aDay();
    const { doc } = await pushSale(
      d,
      saleOf(d, 2 * BOX, [{ batchNo: 'C-09', expiry: '2027-03-01', qty: 2 * BOX }]),
    );
    await push(app, d.store.device, [doc]);
    expect((await balances(d.store))['C-09']).toBe(18 * BOX);
  });
});

describe('returns to a batch', () => {
  it('put the pieces back on the batches their sale line took them from, filling the last batch first', async () => {
    const d = await aDay();
    const payload = saleOf(d, 8 * BOX, [
      { batchNo: 'B-07', expiry: '2026-11-15', qty: 5 * BOX },
      { batchNo: 'C-09', expiry: '2027-03-01', qty: 3 * BOX },
    ]);
    const { doc } = await pushSale(d, payload);
    const back = (qty: number) => {
      const ret = buildReturnPayload({
        sale: payload,
        saleId: doc.id,
        saleNumber: doc.number!,
        shiftId: d.open.id,
        cashierId: d.store.userId,
        reason: 'سليم',
        picks: [{ saleLineNo: 1, qty }],
        returned: [],
      });
      const { hash: _hash, ...body } = d.doc('return', ret);
      const withDeps = { ...body, deps: [doc.id] };
      return { ...withDeps, hash: payloadHash(withDeps) };
    };
    await push(app, d.store.device, [back(2 * BOX)]);
    expect(await balances(d.store)).toEqual({ 'A-01': 10 * BOX, 'C-09': 19 * BOX });
  });
});

describe('writing a batch off, counting it, and sending it back', () => {
  it('writes the expired batch off through the count, and stock follows by the batch’s quantity', async () => {
    const d = await aDay();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(d.store),
      payload: {
        date: '2026-10-30',
        note: 'هدر',
        lines: [{ variantId: d.variantId, countedQty: 0, batchNo: 'A-01', expiryDate: '2026-10-25' }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<StocktakeDetail>().lines[0]).toMatchObject({
      expectedQty: 35 * BOX,
      countedQty: 25 * BOX,
    });
    expect(await balances(d.store)).toEqual({ 'B-07': 5 * BOX, 'C-09': 20 * BOX });
    const [level] = await ownerDb()<
      { qty: string }[]
    >`select qty from stock_levels where tenant_id = ${d.store.tenantId}`;
    expect(Number(level!.qty)).toBe(25 * BOX);
  });

  it('counts one batch: its difference moves the stock, and a whole-item count of it is refused with batch lines', async () => {
    const d = await aDay();
    const counted = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(d.store),
      payload: {
        date: '2026-10-30',
        lines: [{ variantId: d.variantId, countedQty: 18 * BOX, batchNo: 'C-09', expiryDate: '2027-03-01' }],
      },
    });
    expect(counted.statusCode, counted.body).toBe(201);
    expect((await balances(d.store))['C-09']).toBe(18 * BOX);
    const mixed = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(d.store),
      payload: {
        date: '2026-10-30',
        lines: [
          { variantId: d.variantId, countedQty: 5 * BOX },
          { variantId: d.variantId, countedQty: BOX, batchNo: 'C-09', expiryDate: '2027-03-01' },
        ],
      },
    });
    expect(mixed.statusCode).toBe(400);
  });

  it('a whole-item count that finds less takes the loss from the earliest expiry first', async () => {
    const d = await aDay();
    await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(d.store),
      payload: { date: '2026-10-30', lines: [{ variantId: d.variantId, countedQty: 30 * BOX }] },
    });
    expect(await balances(d.store)).toEqual({ 'A-01': 5 * BOX, 'B-07': 5 * BOX, 'C-09': 20 * BOX });
  });

  it('a supplier return names its batch and lowers only that batch, refusing more than it holds', async () => {
    const d = await aDay();
    const send = (qty: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/supplier-returns',
        headers: as(d.store),
        payload: {
          supplierId: d.supplier.id,
          date: '2026-10-30',
          refund: 'credit',
          lines: [{ variantId: d.variantId, qty, batchNo: 'B-07', expiryDate: '2026-11-15' }],
        },
      });
    const tooMany = await send(6 * BOX);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.fields['lines.0.batchNo']).toContain('5');
    expect((await send(5 * BOX)).statusCode).toBe(201);
    expect(await balances(d.store)).toEqual({ 'A-01': 10 * BOX, 'C-09': 20 * BOX });
  });

  it('a transfer carries its batch to the other branch', async () => {
    const d = await aDay();
    const [main] = await ownerDb()<
      { id: string }[]
    >`select id from branches where tenant_id = ${d.store.tenantId}`;
    const [mall] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${d.store.tenantId}, '002', 'فرع المول') returning id`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: as(d.store),
      payload: {
        fromBranchId: main!.id,
        toBranchId: mall!.id,
        date: '2026-10-30',
        lines: [{ variantId: d.variantId, qty: 4 * BOX, batchNo: 'C-09', expiryDate: '2027-03-01' }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const here = await ownerDb()<{ branch_id: string; qty: string }[]>`
      select branch_id, sum(qty)::text as qty from batch_movements
      where tenant_id = ${d.store.tenantId} and batch_no = 'C-09' group by branch_id`;
    expect(Object.fromEntries(here.map((r) => [r.branch_id, Number(r.qty)]))).toEqual({
      [main!.id]: 16 * BOX,
      [mall!.id]: 4 * BOX,
    });
    // A transfer with no batch named takes the earliest expiry first, expired ones included
    const auto = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: as(d.store),
      payload: {
        fromBranchId: main!.id,
        toBranchId: mall!.id,
        date: '2026-10-30',
        lines: [{ variantId: d.variantId, qty: 12 * BOX }],
      },
    });
    expect(auto.statusCode, auto.body).toBe(201);
    const left = await ownerDb()<{ batch_no: string; qty: string }[]>`
      select batch_no, sum(qty)::text as qty from batch_movements
      where tenant_id = ${d.store.tenantId} and branch_id = ${main!.id} group by batch_no having sum(qty) > 0 order by 1`;
    expect(left.map((r) => [r.batch_no, Number(r.qty)])).toEqual([
      ['B-07', 3 * BOX],
      ['C-09', 16 * BOX],
    ]);
  });
});

describe('blocking and recall', () => {
  it('blocks a batch for every till, lists who got it, and unblocks it', async () => {
    const d = await aDay();
    const named = saleOf(d, 2 * BOX, [{ batchNo: 'C-09', expiry: '2027-03-01', qty: 2 * BOX }], {
      customerName: 'مستشفى الأمل',
    });
    const { doc } = await pushSale(d, named);

    const recall = await app.inject({
      method: 'GET',
      url: '/v1/batches/recall?batchNo=C-09',
      headers: as(d.store),
    });
    const found = recall.json<RecallResponse>();
    expect(found.batches).toHaveLength(1);
    expect(found.batches[0]).toMatchObject({
      name: 'بانادول',
      batchNo: 'C-09',
      blocked: false,
      soldQty: 2 * BOX,
      receipts: [{ supplierName: 'الشفاء', qty: 20 * BOX }],
      branches: [{ qty: 18 * BOX }],
    });
    expect(found.sales).toEqual([
      expect.objectContaining({
        invoiceId: doc.id,
        invoiceNumber: doc.number,
        customerName: 'مستشفى الأمل',
        qty: 2 * BOX,
      }),
    ]);

    const block = await app.inject({
      method: 'POST',
      url: '/v1/batches/block',
      headers: as(d.store),
      payload: { batchNo: 'C-09', reason: 'سحب' },
    });
    expect(block.json()).toEqual({ count: 1 });
    expect((await pullStock(d.store))[0]!.batches!.find((b) => b.batchNo === 'C-09')!.blocked).toBe(true);
    const listed = (await expiry(d.store, 30)).items.find((r) => r.batchNo === 'C-09');
    expect(listed).toMatchObject({ blocked: true, blockReason: 'سحب' });

    await app.inject({
      method: 'POST',
      url: '/v1/batches/unblock',
      headers: as(d.store),
      payload: { batchNo: 'C-09' },
    });
    expect((await pullStock(d.store))[0]!.batches!.find((b) => b.batchNo === 'C-09')!.blocked).toBe(false);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/batches/block',
      headers: as(d.store),
      payload: { batchNo: 'ZZ-9' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('finds an invoice by the batch number it sold', async () => {
    const d = await aDay();
    const { doc } = await pushSale(d, saleOf(d, BOX, [{ batchNo: 'C-09', expiry: '2027-03-01', qty: BOX }]));
    const found = await app.inject({
      method: 'GET',
      url: '/v1/sales?q=C-09',
      headers: as(d.store),
    });
    expect(found.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([doc.id]);
  });

  it('keeps a store’s batches from another store, and a cashier from the report', async () => {
    const mine = await aDay();
    const other = await openStore(app, '0933333333');
    expect((await expiry(other)).items).toEqual([]);
    const recall = await app.inject({
      method: 'GET',
      url: '/v1/batches/recall?batchNo=C-09',
      headers: as(other),
    });
    expect(recall.json<RecallResponse>()).toMatchObject({ batches: [], sales: [] });
    const rows = await ownerDb()<{ n: string }[]>`select count(*)::text as n from batch_movements`;
    expect(Number(rows[0]!.n)).toBe(3);
    expect(mine.store.tenantId).not.toBe(other.tenantId);
  });
});

describe('purchases with batches', () => {
  it('takes the same item twice with different batches, and refuses the same batch twice', async () => {
    const d = await aDay();
    const twice = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(d.store),
      payload: {
        supplierId: d.supplier.id,
        date: '2026-10-30',
        payment: 'credit',
        lines: [
          { variantId: d.variantId, qty: BOX, costMinor: 1, batchNo: 'D-01', expiryDate: '2027-05-01' },
          { variantId: d.variantId, qty: 2 * BOX, costMinor: 2, batchNo: 'D-02', expiryDate: '2027-06-01' },
        ],
      },
    });
    expect(twice.statusCode, twice.body).toBe(201);
    expect(await balances(d.store)).toMatchObject({ 'D-01': BOX, 'D-02': 2 * BOX });
    const same = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(d.store),
      payload: {
        supplierId: d.supplier.id,
        date: '2026-10-30',
        payment: 'credit',
        lines: [
          { variantId: d.variantId, qty: BOX, costMinor: 1, batchNo: 'D-01', expiryDate: '2027-05-01' },
          { variantId: d.variantId, qty: BOX, costMinor: 1, batchNo: 'D-01', expiryDate: '2027-05-01' },
        ],
      },
    });
    expect(same.statusCode).toBe(400);
  });

  it('refuses a line with no expiry for an item that requires one', async () => {
    const d = await aDay();
    const product = await app.inject({
      method: 'GET',
      url: `/v1/products/${d.productId}`,
      headers: as(d.store),
    });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${d.productId}`,
      headers: as(d.store),
      payload: { version: product.json().version, requiresExpiry: true },
    });
    expect(patched.json()).toMatchObject({ requiresExpiry: true });
    const bad = await receive(d, 1, 'E-01', null);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields['lines.0.expiryDate']).toContain('صلاحية');
    expect((await receive(d, 1, 'E-01', '2027-08-01')).statusCode).toBe(201);
  });
});

describe('the backfill of a store that had no ledger', () => {
  it('turns receipts into batches, takes tagged sales off their batch, and the rest first-in-first-out', async () => {
    const d = await aDay();
    // One sale tagged with its batch (an older till), one untagged for 12 boxes
    const tagged = saleOf(d, 2 * BOX);
    tagged.lines[0]!.batchNo = 'C-09';
    tagged.lines[0]!.batchExpiry = '2027-03-01';
    await pushSale(d, tagged);
    await pushSale(d, saleOf(d, 12 * BOX));
    const live = await balances(d.store);
    // Forget the ledger as a store from before it would have none, then rebuild it from what is stored
    await ownerDb()`alter table batch_movements disable trigger append_only`;
    await ownerDb()`delete from batch_movements where tenant_id = ${d.store.tenantId}`;
    await ownerDb()`alter table batch_movements enable trigger append_only`;
    await ownerDb()`select backfill_batch_ledger(${d.store.tenantId}::uuid)`;
    const rebuilt = await balances(d.store);
    // Tagged and untagged sales together took 14 boxes; the expired batch is never consumed by the
    // first-in-first-out step, so the good batches carry all of it: 5 + 20 - 14 = 11
    expect(rebuilt['A-01']).toBe(10 * BOX);
    expect((rebuilt['B-07'] ?? 0) + (rebuilt['C-09'] ?? 0)).toBe(11 * BOX);
    expect(live['A-01']).toBe(10 * BOX);
    // Running it again changes nothing
    await ownerDb()`select backfill_batch_ledger(${d.store.tenantId}::uuid)`;
    expect(await balances(d.store)).toEqual(rebuilt);
    const [level] = await pullStock(d.store);
    expect(level!.batches!.map((b) => b.batchNo)).toContain('A-01');
  });
});

describe('the ledger’s protection', () => {
  it('is append-only for the store role, kept inside the store, and the block table cannot be deleted from', async () => {
    const d = await aDay();
    const other = await openStore(app, '0944444444');
    const inStore = (tenantId: string, statement: SQL) =>
      withTenant(appDb().db, tenantId, (tx) => tx.execute(statement)).then(
        () => 'ok',
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    const denied = '42501';
    expect(await inStore(d.store.tenantId, sql`update batch_movements set qty = 1`)).toBe(denied);
    expect(await inStore(d.store.tenantId, sql`delete from batch_movements`)).toBe(denied);
    expect(await inStore(d.store.tenantId, sql`delete from batch_blocks`)).toBe(denied);
    // Another store sees none of it, and cannot write a row under this store's id
    const seen = await withTenant(appDb().db, other.tenantId, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*)::text as n from batch_movements`),
    );
    expect(Number(seen[0]!.n)).toBe(0);
    const forged = await inStore(
      other.tenantId,
      sql`insert into batch_movements (tenant_id, branch_id, variant_id, qty, kind, doc_id, line_no, business_date)
          values (${d.store.tenantId}, gen_random_uuid(), gen_random_uuid(), 1, 'sale', gen_random_uuid(), 1, '2026-10-30')`,
    );
    expect(forged).not.toBe('ok');
    // A zero movement is refused by the table itself
    const [branch] = await ownerDb()<
      { id: string }[]
    >`select id from branches where tenant_id = ${d.store.tenantId}`;
    const zero = await ownerDb()`
      insert into batch_movements (tenant_id, branch_id, variant_id, qty, kind, doc_id, line_no, business_date)
      values (${d.store.tenantId}, ${branch!.id}, ${d.variantId}, 0, 'sale', ${d.open.id}, 1, '2026-10-30')`.then(
      () => 'ok',
      (e: { code?: string }) => e.code,
    );
    expect(zero).toBe('23514');
  });
});

describe('what a return puts back', () => {
  const alloc = (batchNo: string, qty: number) => ({ batchNo, expiry: null, qty });
  it('fills the last batch of the line first, after what earlier returns of it already put back', () => {
    const line = [alloc('A', 5000), alloc('B', 3000)];
    expect(returnShares(line, 0, 2000)).toEqual([alloc('B', 2000)]);
    expect(returnShares(line, 2000, 2000)).toEqual([alloc('B', 1000), alloc('A', 1000)]);
    expect(returnShares(line, 3000, 5000)).toEqual([alloc('A', 5000)]);
    expect(returnShares(line, 8000, 1000)).toEqual([]);
    expect(returnShares([], 0, 1000)).toEqual([]);
  });
});

describe('the store settings of the batch rules', () => {
  it('keeps «امنع البيع بلا دفعة صالحة» and «امنع البيع فوق المخزون», and hands them to the till', async () => {
    const store = await openStore(app);
    const pharmacy = await app.inject({
      method: 'PUT',
      url: '/v1/store/pharmacy',
      headers: as(store),
      payload: { prescription: 'optional', autoBatch: true, blockNoBatch: true },
    });
    expect(pharmacy.statusCode, pharmacy.body).toBe(200);
    const till = await app.inject({
      method: 'PUT',
      url: '/v1/store/till',
      headers: as(store),
      payload: { returnWindowDays: null, cardApprovalRequired: false, blockNegativeStock: true },
    });
    expect(till.statusCode, till.body).toBe(200);
    await settled();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    const settings = res.json<PullResponse>().sets.settings!.upserts[0] as unknown as {
      pharmacy: { blockNoBatch: boolean };
      till: { blockNegativeStock: boolean };
    };
    expect(settings.pharmacy.blockNoBatch).toBe(true);
    expect(settings.till.blockNegativeStock).toBe(true);
  });
});
