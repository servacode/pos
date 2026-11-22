import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type DamagedStock,
  type InventoryResponse,
  type ProductDetail,
  type SalePayload,
  type SupplierRow,
} from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { damagedLocationOf } from '../src/services/damaged-stock';
import {
  balances,
  cartLine,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDb } from '@serva/db';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * «البضاعة التالفة» (round 35, D7): a return marked damaged goes to the store's damaged location, never
 * to the shelf; it keeps its cost in inventory until it is written off (a count) or sent back to the
 * supplier; and every entry of the way keeps the books balanced. A return not marked damaged is what
 * it always was.
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
const get = async <T>(store: Store, url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: as(store) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

interface World {
  store: Store;
  doc: ReturnType<typeof documents>;
  shiftId: string;
  sold: SyncDocument;
  payload: SalePayload;
  variantId: string;
  supplierId: string;
  branchId: string;
}

/** 10 pieces bought at 40,000 each; a shift; 2 sold for cash at 100,000 (8 left on the shelf) */
async function world(): Promise<World> {
  const store = await openStore(app);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: { nameAr: 'زيت', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const variantId = product.variants[0]!.id;
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId, qty: 10_000, costMinor: 400_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const payload = sale(store, open.id, {
    lines: [cartLine(1, 100_000, { qty: 2000, productId: product.id, variantId, name: 'زيت' })],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
  });
  const sold = doc('sale', payload);
  await push(app, store.device, [open, sold]);
  await settled();
  const [branch] = await ownerDb()<{ id: string }[]>`
    select id from branches where tenant_id = ${store.tenantId} and kind = 'store'`;
  return {
    store,
    doc,
    shiftId: open.id,
    sold,
    payload,
    variantId,
    supplierId: supplier.id,
    branchId: branch!.id,
  };
}

/** A return of `qty` thousandths of the sale's line, damaged or not, pushed from the till */
async function giveBack(w: World, qty: number, damaged: boolean) {
  const payload = buildReturnPayload({
    sale: w.payload,
    saleId: w.sold.id,
    saleNumber: w.sold.number!,
    shiftId: w.shiftId,
    cashierId: w.store.userId,
    reason: damaged ? 'تالف أو منتهي الصلاحية' : 'الزبون غيّر رأيه',
    picks: [{ saleLineNo: 1, qty }],
    damaged,
  });
  const { hash: _hash, ...body } = w.doc('return', payload);
  const withDeps = { ...body, deps: [w.sold.id] };
  const ret = { ...withDeps, hash: payloadHash(withDeps) };
  const res = await push(app, w.store.device, [ret]);
  expect(res.results[0]).toMatchObject({ status: 'accepted' });
  await settled();
  return ret;
}

const levelOf = async (branchId: string, variantId: string) => {
  const [row] = await ownerDb()<{ qty: string }[]>`
    select qty::text from stock_levels where branch_id = ${branchId} and variant_id = ${variantId}`;
  return Number(row?.qty ?? 0);
};
const valueOf = async (branchId: string, variantId: string) => {
  const [row] = await ownerDb()<{ v: string }[]>`
    select value_minor::text as v from stock_values where branch_id = ${branchId} and variant_id = ${variantId}`;
  return Number(row?.v ?? 0);
};
const damagedBranch = async (w: World) =>
  (
    await ownerDb()<{ id: string }[]>`
      select id from branches where tenant_id = ${w.store.tenantId} and kind = 'damaged'`
  )[0]?.id;

/** The books balance: debits equal credits over the whole ledger, and the integrity checks find nothing */
async function expectBalanced(w: World) {
  const [sum] = await ownerDb()<{ d: string; c: string }[]>`
    select sum(debit_minor)::text as d, sum(credit_minor)::text as c from journal_lines where tenant_id = ${w.store.tenantId}`;
  expect(sum!.d).toBe(sum!.c);
  const report = await withTenant(appDb().db, w.store.tenantId, (tx) => checkIntegrity(tx, w.store.tenantId));
  expect(report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`))).toEqual([]);
}

describe('a damaged return', () => {
  it('leaves the shelf as it was, adds the piece to the damaged goods at its cost, and keeps it in inventory', async () => {
    const w = await world();
    expect(await levelOf(w.branchId, w.variantId)).toBe(8000);
    await giveBack(w, 1000, true);

    // Sellable stock did not move; the damaged location holds the piece
    expect(await levelOf(w.branchId, w.variantId)).toBe(8000);
    const damagedId = (await damagedBranch(w))!;
    expect(await levelOf(damagedId, w.variantId)).toBe(1000);
    expect(await valueOf(damagedId, w.variantId)).toBe(40_000);
    expect(await valueOf(w.branchId, w.variantId)).toBe(320_000);

    // The sale's cost came back off 5100 at the branch's average; inventory still holds the piece
    const b = await balances(w.store.tenantId);
    expect(b.get('1300')?.base).toBe(360_000);
    expect(b.get('5100')?.base).toBe(40_000);

    // The page of damaged goods, the sellable inventory and the stores list
    const list = await get<DamagedStock>(w.store, '/v1/damaged-stock');
    expect(list.locations).toEqual([
      {
        branchId: damagedId,
        ownerBranchId: w.branchId,
        ownerName: expect.any(String),
        items: [{ variantId: w.variantId, name: 'زيت', qty: 1000, valueMinor: 40_000 }],
        totalValueMinor: 40_000,
      },
    ]);
    const stock = await get<InventoryResponse>(w.store, '/v1/inventory');
    expect(stock.items.map((i) => [i.branchId, i.qty])).toEqual([[w.branchId, 8000]]);
    const stores = await get<{ id: string }[]>(w.store, '/v1/branches');
    expect(stores.map((s) => s.id)).toEqual([w.branchId]);
    await expectBalanced(w);
  });

  it('comes out the same when the store is rebuilt from its documents (the books depend on the documents alone)', async () => {
    const w = await world();
    await giveBack(w, 1000, true);
    await giveBack(w, 1000, false);
    const owner = createDb(TEST_OWNER_URL, { max: 1 });
    try {
      const rebuilt = await checkRebuild(owner.db, {
        tenantId: w.store.tenantId,
        processors: DOCUMENT_PROCESSORS,
        now: new Date('2026-10-30T12:00:00.000Z'),
      });
      expect(rebuilt).toMatchObject({ same: true, failed: [] });
    } finally {
      await owner.client.end();
    }
  });

  it('is one location per store however many damaged returns come, and an ordinary return still goes back on the shelf', async () => {
    const w = await world();
    await giveBack(w, 1000, true);
    await giveBack(w, 1000, false);
    expect(await levelOf(w.branchId, w.variantId)).toBe(9000);
    const [counted] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from branches where tenant_id = ${w.store.tenantId} and kind = 'damaged'`;
    expect(counted!.n).toBe('1');
    const damagedId = (await damagedBranch(w))!;
    expect(await levelOf(damagedId, w.variantId)).toBe(1000);
    // The ordinary return is costed exactly as before: 5100 is the one piece still sold
    const b = await balances(w.store.tenantId);
    expect(b.get('5100')?.base).toBe(0);
    await expectBalanced(w);
  });

  it('is written off by a count of the damaged location: inventory goes down and the loss goes up', async () => {
    const w = await world();
    await giveBack(w, 1000, true);
    const damagedId = (await damagedBranch(w))!;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(w.store),
      payload: {
        branchId: damagedId,
        date: '2026-10-31',
        note: 'شطب تالف',
        lines: [{ variantId: w.variantId, countedQty: 0 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await levelOf(damagedId, w.variantId)).toBe(0);
    expect(await levelOf(w.branchId, w.variantId)).toBe(8000);
    const entry = (await postedEntries(w.store.tenantId)).find((e) => e.sourceType === 'stocktake');
    expect(entry?.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['6300', 40_000, 0],
      ['1300', 0, 40_000],
    ]);
    const b = await balances(w.store.tenantId);
    expect(b.get('1300')?.base).toBe(320_000);
    expect(b.get('6300')?.base).toBe(40_000);
    // Nothing left to list
    expect((await get<DamagedStock>(w.store, '/v1/damaged-stock')).locations).toEqual([]);
    await expectBalanced(w);
  });

  it('goes back to the supplier from the damaged location, at its cost, off the supplier balance', async () => {
    const w = await world();
    await giveBack(w, 1000, true);
    const damagedId = (await damagedBranch(w))!;
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/supplier-returns',
        headers: as(w.store),
        payload: {
          supplierId: w.supplierId,
          branchId: damagedId,
          date: '2026-10-31',
          refund: 'credit',
          lines: [{ variantId: w.variantId, qty: 1000 }],
        },
      });
    const res = await send();
    expect(res.statusCode, res.body).toBe(201);
    expect(await levelOf(damagedId, w.variantId)).toBe(0);
    const entry = (await postedEntries(w.store.tenantId)).find((e) => e.sourceType === 'supplier_return');
    expect(entry?.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['2100', 40_000, 0],
      ['1300', 0, 40_000],
    ]);
    // More than the damaged location holds is refused, as for any branch
    expect((await send()).statusCode).toBe(400);
    await expectBalanced(w);
  });

  it('is not counted as stock by the online shop or the reorder suggestions', async () => {
    const w = await world();
    await giveBack(w, 1000, true);
    const [row] = await ownerDb()<{ qty: string }[]>`
      select coalesce(sum(l.qty) filter (where l.branch_id not in (select id from branches where kind = 'damaged')), 0)::text as qty
      from stock_levels l where l.variant_id = ${w.variantId}`;
    expect(row!.qty).toBe('8000');
  });

  it('puts the goods of a van in its home store location, and answers the damaged location with itself', async () => {
    const w = await world();
    const [van] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name, kind, parent_branch_id)
      values (${w.store.tenantId}, '777', 'سيارة', 'van', ${w.branchId}) returning id`;
    const here = await withTenant(appDb().db, w.store.tenantId, async (tx) => {
      const fromVan = await damagedLocationOf(tx, w.store.tenantId, van!.id);
      const fromStore = await damagedLocationOf(tx, w.store.tenantId, w.branchId);
      const again = await damagedLocationOf(tx, w.store.tenantId, fromVan.id);
      return { fromVan, fromStore, again };
    });
    expect(here.fromVan.ownerId).toBe(w.branchId);
    expect(here.fromStore.id).toBe(here.fromVan.id);
    expect(here.again.id).toBe(here.fromVan.id);
  });
});
