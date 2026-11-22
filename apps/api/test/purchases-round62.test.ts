import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  PurchaseDetail,
  PurchaseOrderListResponse,
  SupplierDueResponse,
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierReturnRow,
  SupplierRow,
} from '@serva/core';
import { balances, openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { firstBranch } from './devices';
import { bearer, staffUser } from './staff';

/**
 * Round 62 (purchases): the supplier's due date and payment days, «مستحق هذا الأسبوع», the paper's discount and
 * extra charges spread over the lines (the posting is the plain purchase's), the photo of the paper invoice,
 * the no-invoice credit capped by what THIS supplier charged, returns filtered and paged by a keyset cursor.
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
const post = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: as(store), payload });
const get = (store: Store, url: string) => app.inject({ method: 'GET', url, headers: as(store) });

async function product(store: Store, nameAr: string, extra: Record<string, unknown> = {}) {
  const res = await post(store, '/v1/products', {
    nameAr,
    ...extra,
    variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>().variants[0]!.id;
}

async function supplier(store: Store, name: string, extra: Record<string, unknown> = {}) {
  const res = await post(store, '/v1/suppliers', { name, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

async function buy(store: Store, body: Record<string, unknown>) {
  const res = await post(store, '/v1/purchases', { payment: 'credit', date: '2026-11-20', ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

describe('purchases, round 62: due dates', () => {
  it('keeps a typed due date, defaults it from the supplier payment days, and leaves it empty for cash', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const slow = await supplier(store, 'مورد بالأجل', { termsDays: 30 });
    expect(slow.termsDays).toBe(30);
    const typed = await buy(store, {
      supplierId: slow.id,
      dueDate: '2026-12-05',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    expect(typed.dueDate).toBe('2026-12-05');
    const defaulted = await buy(store, {
      supplierId: slow.id,
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    expect(defaulted.dueDate).toBe('2026-12-20');
    const cash = await buy(store, {
      supplierId: slow.id,
      payment: 'cash',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    expect(cash.dueDate).toBeNull();
    const early = await post(store, '/v1/purchases', {
      supplierId: slow.id,
      date: '2026-11-20',
      payment: 'credit',
      dueDate: '2026-11-19',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    expect(early.statusCode).toBe(400);
    expect(early.json()).toMatchObject({ error: { fields: { dueDate: expect.any(String) } } });
    const listed = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(listed.items.find((s) => s.id === slow.id)?.termsDays).toBe(30);
    const cleared = await app.inject({
      method: 'PUT',
      url: `/v1/suppliers/${slow.id}`,
      headers: as(store),
      payload: { name: 'مورد بالأجل', termsDays: null },
    });
    expect(cleared.json<SupplierRow>().termsDays).toBeNull();
  });

  it('lists what falls due this week and still owed; payments settle the oldest invoices first', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    // Old invoice due last week, newer invoice due in three days, one due next month
    const old = await buy(store, {
      supplierId: s.id,
      date: '2026-11-01',
      dueDate: '2026-11-15',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    const soon = await buy(store, {
      supplierId: s.id,
      date: '2026-11-10',
      dueDate: '2026-11-25',
      lines: [{ variantId, qty: 1000, costMinor: 200_000 }],
    });
    await buy(store, {
      supplierId: s.id,
      date: '2026-11-12',
      dueDate: '2027-01-01',
      lines: [{ variantId, qty: 1000, costMinor: 300_000 }],
    });
    // The store's day is whatever the test clock says: ask with a window wide enough for both the dates above
    const due = (await get(store, '/v1/suppliers/due?days=90')).json<SupplierDueResponse>();
    expect(due.items.map((i) => i.number)).toEqual([old.number, soon.number, expect.any(String)]);
    expect(due.items.map((i) => i.openMinor)).toEqual([100_000, 200_000, 300_000]);
    // 100,000 paid: the oldest invoice is settled, so it drops off
    const paid = await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-11-21',
      amountMinor: 100_000,
      method: 'cash',
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const after = (await get(store, '/v1/suppliers/due?days=90')).json<SupplierDueResponse>();
    expect(after.items.map((i) => i.number)).toEqual([soon.number, expect.any(String)]);
    // 50,000 more: part of the second invoice is still open
    await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-11-21',
      amountMinor: 50_000,
      method: 'cash',
    });
    const part = (await get(store, '/v1/suppliers/due?days=90')).json<SupplierDueResponse>();
    expect(part.items.map((i) => i.openMinor)).toEqual([150_000, 300_000]);
    expect(part.totalMinor).toBe(450_000);
    expect((await get(store, '/v1/suppliers/due?days=abc')).statusCode).toBe(400);
  });
});

describe('purchases, round 62: discount and charges', () => {
  it('spreads a discount over the lines; the books take the net and the paper figures are kept', async () => {
    const store = await openStore(app);
    const a = await product(store, 'قميص');
    const b = await product(store, 'بنطال');
    const s = await supplier(store, 'مورد الخصم');
    const made = await buy(store, {
      supplierId: s.id,
      discountMinor: 40_000,
      lines: [
        { variantId: a, qty: 1000, costMinor: 100_000 },
        { variantId: b, qty: 1000, costMinor: 300_000 },
      ],
    });
    expect(made.totalMinor).toBe(360_000);
    expect(made.discountMinor).toBe(40_000);
    expect(made.lines.map((l) => l.costMinor)).toEqual([90_000, 270_000]);
    const owed = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(owed.items.find((x) => x.id === s.id)?.balanceMinor).toBe(360_000);
    const books = await balances(store.tenantId);
    expect(books.get('1300')?.base).toBe(360_000);
    expect(books.get('2100')?.base).toBe(-360_000);
  });

  it('posts the same entry as an invoice whose line costs already equal the discounted amounts', async () => {
    const store = await openStore(app);
    const a = await product(store, 'قميص');
    const b = await product(store, 'بنطال');
    const s = await supplier(store, 'مورد المقارنة');
    const withDiscount = await buy(store, {
      supplierId: s.id,
      discountMinor: 40_000,
      lines: [
        { variantId: a, qty: 1000, costMinor: 100_000 },
        { variantId: b, qty: 1000, costMinor: 300_000 },
      ],
    });
    const plain = await buy(store, {
      supplierId: s.id,
      lines: [
        { variantId: a, qty: 1000, costMinor: 90_000 },
        { variantId: b, qty: 1000, costMinor: 270_000 },
      ],
    });
    const lines = async (sourceId: string) =>
      ownerDb()<{ code: string; debit: string; credit: string }[]>`
        select a.code, l.debit_minor::text as debit, l.credit_minor::text as credit
        from journal_entries e
        join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
        join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
        where e.tenant_id = ${store.tenantId} and e.source_id = ${sourceId}
        order by a.code, l.debit_minor, l.credit_minor`;
    const first = await lines(withDiscount.id);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(await lines(plain.id));
    // The entry balances, and the supplier owes the net of both invoices
    const sum = (rows: { debit: string; credit: string }[], k: 'debit' | 'credit') =>
      rows.reduce((t, r) => t + Number(r[k]), 0);
    expect(sum(first, 'debit')).toBe(sum(first, 'credit'));
    expect(sum(first, 'debit')).toBe(360_000);
    const owed = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(owed.items.find((x) => x.id === s.id)?.balanceMinor).toBe(720_000);
  });

  it('adds extra charges, keeps the lines adding up to the net to the last unit, and refuses a discount above the paper', async () => {
    const store = await openStore(app);
    const a = await product(store, 'قميص');
    const b = await product(store, 'بنطال');
    const c = await product(store, 'جاكيت');
    const s = await supplier(store, 'مورد الأجور');
    const made = await buy(store, {
      supplierId: s.id,
      chargesMinor: 1000,
      discountMinor: 1,
      lines: [
        { variantId: a, qty: 1000, costMinor: 333 },
        { variantId: b, qty: 1000, costMinor: 333 },
        { variantId: c, qty: 1000, costMinor: 334 },
      ],
    });
    expect(made.totalMinor).toBe(1000 + 1000 - 1);
    expect(made.lines.reduce((sum, l) => sum + l.costMinor, 0)).toBe(made.totalMinor);
    expect(made.chargesMinor).toBe(1000);
    const over = await post(store, '/v1/purchases', {
      supplierId: s.id,
      date: '2026-11-20',
      payment: 'credit',
      discountMinor: 1001,
      lines: [{ variantId: a, qty: 1000, costMinor: 1000 }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ error: { fields: { discountMinor: expect.any(String) } } });
  });

  it('spreads a discount on a dollar invoice in dollars', async () => {
    const store = await openStore(app);
    const rate = await app.inject({
      method: 'PUT',
      url: '/v1/store/currency',
      headers: as(store),
      payload: { usdEnabled: true, usdRate: '120' },
    });
    expect(rate.statusCode, rate.body).toBe(200);
    const a = await product(store, 'قميص');
    const s = await supplier(store, 'مورد دولار');
    const made = await buy(store, {
      supplierId: s.id,
      currency: 'USD',
      discountMinor: 500,
      lines: [{ variantId: a, qty: 1000, costMinor: 10_000 }],
    });
    expect(made.foreignTotalMinor).toBe(9500);
    expect(made.totalMinor).toBe(9500 * 120);
  });
});

describe('purchases, round 62: the photo of the paper invoice', () => {
  // A one-pixel PNG
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('attaches a photo, serves it, and refuses a file that is not a picture', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, { supplierId: s.id, lines: [{ variantId, qty: 1000, costMinor: 50_000 }] });
    expect(made.attachments).toEqual([]);
    const ok = await post(store, `/v1/purchases/${made.id}/attachments`, {
      contentType: 'image/png',
      data: PNG,
      thumb: PNG,
      width: 1,
      height: 1,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const again = (await get(store, `/v1/purchases/${made.id}`)).json<PurchaseDetail>();
    expect(again.attachments).toHaveLength(1);
    expect(again.attachments?.[0]?.url).toBe(ok.json<{ url: string }>().url);
    const served = await get(store, again.attachments![0]!.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('private, max-age=3600');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    expect((await get(store, `${again.attachments![0]!.url}?size=thumb`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: again.attachments![0]!.url })).statusCode).toBe(401);
    const text = Buffer.from('not a picture at all').toString('base64');
    const bad = await post(store, `/v1/purchases/${made.id}/attachments`, {
      contentType: 'image/png',
      data: text,
      thumb: text,
      width: 1,
      height: 1,
    });
    expect(bad.statusCode).toBe(400);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/purchases/${made.id}/attachments/${again.attachments![0]!.id}`,
      headers: as(store),
    });
    expect(removed.statusCode).toBe(204);
    expect((await get(store, `/v1/purchases/${made.id}`)).json<PurchaseDetail>().attachments).toEqual([]);
    const missing = await post(store, '/v1/purchases/00000000-0000-4000-8000-000000000000/attachments', {
      contentType: 'image/png',
      data: PNG,
      thumb: PNG,
      width: 1,
      height: 1,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('returns to the supplier, round 62', () => {
  const sendBack = (store: Store, payload: Record<string, unknown>) =>
    post(store, '/v1/supplier-returns', payload);

  it('caps a no-invoice credit by what this supplier charged, at the exact boundary', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const cheap = await supplier(store, 'مورد رخيص');
    const dear = await supplier(store, 'مورد غالي');
    // Cheap supplier: 40,000 a piece. Dear supplier sold the same item at 90,000 a piece.
    await buy(store, { supplierId: cheap.id, lines: [{ variantId, qty: 5000, costMinor: 200_000 }] });
    await buy(store, { supplierId: dear.id, lines: [{ variantId, qty: 5000, costMinor: 450_000 }] });
    // Average cost is 65,000 a piece. The cheap supplier's cap is the larger of that average and its own 40,000.
    const over = await sendBack(store, {
      supplierId: cheap.id,
      date: '2026-11-21',
      refund: 'cash',
      lines: [{ variantId, qty: 1000, amountMinor: 65_001 }],
    });
    expect(over.statusCode, over.body).toBe(400);
    const exact = await sendBack(store, {
      supplierId: cheap.id,
      date: '2026-11-21',
      refund: 'cash',
      lines: [{ variantId, qty: 1000, amountMinor: 65_000 }],
    });
    expect(exact.statusCode, exact.body).toBe(201);
  });

  it('caps a no-invoice credit for a dollar supplier by its own last price in the base currency', async () => {
    const store = await openStore(app);
    await app.inject({
      method: 'PUT',
      url: '/v1/store/currency',
      headers: as(store),
      payload: { usdEnabled: true, usdRate: '100' },
    });
    const variantId = await product(store, 'فستان');
    const usd = await supplier(store, 'مورد دولار');
    const syp = await supplier(store, 'مورد ليرة');
    // The dollar supplier: $10 a piece = 1,000 a piece at 100. The pound supplier sold it at 3,000.
    await buy(store, {
      supplierId: usd.id,
      currency: 'USD',
      lines: [{ variantId, qty: 4000, costMinor: 4000 }],
    });
    await buy(store, { supplierId: syp.id, lines: [{ variantId, qty: 1000, costMinor: 3000 }] });
    // The dollar supplier charged $10 a piece = 100,000 in base minor units at 100; the average cost is lower (80,600)
    const own = 100_000;
    const over = await sendBack(store, {
      supplierId: usd.id,
      date: '2026-11-21',
      refund: 'credit',
      lines: [{ variantId, qty: 1000, amountMinor: own + 1 }],
    });
    expect(over.statusCode, over.body).toBe(400);
    const exact = await sendBack(store, {
      supplierId: usd.id,
      date: '2026-11-21',
      refund: 'credit',
      lines: [{ variantId, qty: 1000, amountMinor: own }],
    });
    expect(exact.statusCode, exact.body).toBe(201);
  });

  it('filters the list by supplier and by a search, pages by keyset, and gives the branch and the serial numbers', async () => {
    const store = await openStore(app);
    const plain = await product(store, 'فستان');
    const tracked = await product(store, 'هاتف', { tracksSerial: true });
    const one = await supplier(store, 'معمل الأمل');
    const two = await supplier(store, 'شركة النور');
    await buy(store, { supplierId: one.id, lines: [{ variantId: plain, qty: 9000, costMinor: 90_000 }] });
    await buy(store, { supplierId: two.id, lines: [{ variantId: plain, qty: 9000, costMinor: 90_000 }] });
    await buy(store, {
      supplierId: one.id,
      lines: [{ variantId: tracked, qty: 2000, costMinor: 200_000, serials: ['imei-a1', 'imei-a2'] }],
    });
    const made: SupplierReturnDetail[] = [];
    for (const [i, supplierId] of [one.id, two.id, one.id].entries()) {
      const res = await sendBack(store, {
        supplierId,
        date: '2026-11-21',
        refund: 'credit',
        reference: `CN-${i + 1}`,
        lines: [{ variantId: plain, qty: 1000 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      made.push(res.json<SupplierReturnDetail>());
    }
    const withSerials = await sendBack(store, {
      supplierId: one.id,
      date: '2026-11-21',
      refund: 'credit',
      lines: [{ variantId: tracked, qty: 1000, serials: ['IMEI-A1'] }],
    });
    expect(withSerials.statusCode, withSerials.body).toBe(201);
    expect(withSerials.json<SupplierReturnDetail>().branchName).toEqual(expect.any(String));
    const detail = (
      await get(store, `/v1/supplier-returns/${withSerials.json<SupplierReturnDetail>().id}`)
    ).json<SupplierReturnDetail>();
    expect(detail.lines[0]?.serials).toEqual(['IMEI-A1']);
    expect(detail.branchName).toEqual(expect.any(String));

    type Page = { items: SupplierReturnRow[]; nextCursor: string | null };
    const byOne = (await get(store, `/v1/supplier-returns?supplierId=${two.id}`)).json<Page>();
    expect(byOne.items).toHaveLength(1);
    expect(byOne.items[0]?.supplierName).toBe('شركة النور');
    const search = (await get(store, `/v1/supplier-returns?q=${encodeURIComponent('الأمل')}`)).json<Page>();
    expect(search.items).toHaveLength(3);
    const byRef = (await get(store, '/v1/supplier-returns?q=cn-2')).json<Page>();
    expect(byRef.items).toHaveLength(1);
    const odd = (await get(store, '/v1/supplier-returns?q=%25')).json<Page>();
    expect(odd.items).toHaveLength(0);

    // Keyset: a return made between two page reads does not shift the next page nor repeat a row
    const first = (await get(store, '/v1/supplier-returns?limit=2')).json<Page>();
    expect(first.items).toHaveLength(2);
    const extra = await sendBack(store, {
      supplierId: two.id,
      date: '2026-11-22',
      refund: 'credit',
      lines: [{ variantId: plain, qty: 1000 }],
    });
    expect(extra.statusCode, extra.body).toBe(201);
    const rest = (
      await get(store, `/v1/supplier-returns?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)
    ).json<Page>();
    const seen = [...first.items, ...rest.items].map((r) => r.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(extra.json<SupplierReturnDetail>().id);
    expect(rest.items).toHaveLength(2);
    for (const bad of ['zzz', '2026-11-21~x~y', '2026-11-21~1~2~3']) {
      expect((await get(store, `/v1/supplier-returns?cursor=${encodeURIComponent(bad)}`)).statusCode).toBe(
        400,
      );
    }
  });
});

describe('purchase orders, round 62: server counts and keyset paging', () => {
  it('counts the orders per status for the supplier, whatever page or status is asked', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const one = await supplier(store, 'مورد أ');
    const two = await supplier(store, 'مورد ب');
    for (const [supplierId, day] of [
      [one.id, '2026-11-01'],
      [one.id, '2026-11-02'],
      [two.id, '2026-11-03'],
    ] as const) {
      const res = await post(store, '/v1/purchase-orders', {
        supplierId,
        date: day,
        lines: [{ variantId, qty: 1000, costMinor: 40_000, unitCostMinor: 40_000 }],
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const all = (await get(store, '/v1/purchase-orders?limit=1')).json<PurchaseOrderListResponse>();
    expect(all.items).toHaveLength(1);
    expect(all.counts).toEqual({ draft: 3 });
    const mine = (
      await get(store, `/v1/purchase-orders?supplierId=${one.id}&status=sent`)
    ).json<PurchaseOrderListResponse>();
    expect(mine.items).toHaveLength(0);
    expect(mine.counts).toEqual({ draft: 2 });
    // Keyset: no row twice, none skipped, even when an order is made between two reads
    const p1 = (await get(store, '/v1/purchase-orders?limit=2')).json<PurchaseOrderListResponse>();
    const extra = await post(store, '/v1/purchase-orders', {
      supplierId: two.id,
      date: '2026-11-04',
      lines: [{ variantId, qty: 1000, costMinor: 40_000, unitCostMinor: 40_000 }],
    });
    expect(extra.statusCode).toBe(201);
    const p2 = (
      await get(store, `/v1/purchase-orders?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`)
    ).json<PurchaseOrderListResponse>();
    const ids = [...p1.items, ...p2.items].map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
    expect((await get(store, '/v1/purchase-orders?cursor=zzz')).statusCode).toBe(400);
  });
});

describe('round 62: permissions and the other store', () => {
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const photo = { contentType: 'image/png', data: PNG, thumb: PNG, width: 1, height: 1 };

  it('refuses a cashier on the due list, the photos, the serial drift and the serial fix', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, { supplierId: s.id, lines: [{ variantId, qty: 1000, costMinor: 50_000 }] });
    const cashier = await staffUser(
      app,
      {
        tenantId: store.tenantId,
        userId: store.userId,
        accessToken: store.accessToken,
        branchId: await firstBranch(store.tenantId),
      },
      'cashier',
      '0955000001',
    );
    const h = bearer(cashier.accessToken);
    const send = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
      app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });
    expect((await send('GET', '/v1/suppliers/due')).statusCode).toBe(403);
    expect(
      (await send('GET', `/v1/purchases/${made.id}/attachments/00000000-0000-4000-8000-000000000000`))
        .statusCode,
    ).toBe(403);
    expect((await send('POST', `/v1/purchases/${made.id}/attachments`, photo)).statusCode).toBe(403);
    expect(
      (await send('DELETE', `/v1/purchases/${made.id}/attachments/00000000-0000-4000-8000-000000000000`))
        .statusCode,
    ).toBe(403);
    expect((await send('GET', '/v1/serials/drift')).statusCode).toBe(403);
    expect((await send('POST', '/v1/serials/fix', { serial: 'XYZ-1', status: 'lost' })).statusCode).toBe(403);
  });

  it('keeps the photo limits: a count of six, a size cap, a type check, and nothing of another store', async () => {
    const store = await openStore(app);
    const other = await openStore(app, '0912345679');
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, { supplierId: s.id, lines: [{ variantId, qty: 1000, costMinor: 50_000 }] });
    // Another store's owner cannot attach to, or see, this invoice
    expect((await post(other, `/v1/purchases/${made.id}/attachments`, photo)).statusCode).toBe(404);
    // A type outside the three allowed is refused by the schema
    expect(
      (await post(store, `/v1/purchases/${made.id}/attachments`, { ...photo, contentType: 'image/gif' }))
        .statusCode,
    ).toBe(400);
    // A body over the size cap is refused
    const big = Buffer.alloc(2_600_000, 1).toString('base64');
    expect(
      (await post(store, `/v1/purchases/${made.id}/attachments`, { ...photo, data: big })).statusCode,
    ).toBe(400);
    // Six different pictures fit, the seventh is refused
    for (let i = 0; i < 7; i++) {
      const raw = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([i])]);
      const res = await post(store, `/v1/purchases/${made.id}/attachments`, {
        ...photo,
        data: raw.toString('base64'),
      });
      expect(res.statusCode, `photo ${i + 1}`).toBe(i < 6 ? 201 : 400);
    }
    // Nothing of it reaches the other store's invoice list
    expect((await get(other, `/v1/purchases/${made.id}`)).statusCode).toBe(404);
  });
});

describe('round 62: the invoice photo is private', () => {
  const png = (n: number) =>
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]).toString('base64');

  it('is not public, is served to the owner only, and a product picture of the same bytes stays public', async () => {
    const store = await openStore(app);
    const other = await openStore(app, '0912345679');
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, { supplierId: s.id, lines: [{ variantId, qty: 1000, costMinor: 50_000 }] });
    const bytes = png(9);
    const photo = { contentType: 'image/png', data: bytes, thumb: bytes, width: 1, height: 1 };
    const att = (await post(store, `/v1/purchases/${made.id}/attachments`, photo)).json<{
      id: string;
      url: string;
      thumbUrl: string;
    }>();
    expect(att.url).toBe(`/v1/purchases/${made.id}/attachments/${att.id}`);
    const [up] = await ownerDb()<
      { id: string }[]
    >`select upload_id as id from purchase_attachments where id = ${att.id}`;
    const publicUrl = `/v1/images/${store.tenantId}/${up!.id}`;
    expect((await app.inject({ method: 'GET', url: publicUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${publicUrl}?size=thumb` })).statusCode).toBe(404);
    const mine = await get(store, att.thumbUrl);
    expect(mine.statusCode).toBe(200);
    expect(mine.rawPayload.equals(Buffer.from(bytes, 'base64'))).toBe(true);
    expect((await get(other, att.url)).statusCode).toBe(404);
    expect(
      (await get(store, `/v1/purchases/${made.id}/attachments/00000000-0000-4000-8000-000000000000`))
        .statusCode,
    ).toBe(404);

    // The same bytes as a product picture: its own public upload; the invoice photo stays private
    const product2 = await post(store, '/v1/products', {
      nameAr: 'قميص',
      variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
    });
    const productId = product2.json<ProductDetail>().id;
    const img = await post(store, `/v1/products/${productId}/images`, photo);
    expect(img.statusCode, img.body).toBe(201);
    const imageUrl = img.json<{ url: string }>().url;
    expect(imageUrl).not.toBe(publicUrl);
    expect((await app.inject({ method: 'GET', url: imageUrl })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: publicUrl })).statusCode).toBe(404);
  });
});
