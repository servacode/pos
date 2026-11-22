import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  PartyStatement,
  ProductDetail,
  PurchaseDetail,
  PurchaseDraft,
  PurchaseListResponse,
  SupplierDueResponse,
  SupplierRow,
} from '@serva/core';
import { balances, openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { firstBranch } from './devices';
import { staffUser } from './staff';

/**
 * Round 64 (purchases): a due date corrected after posting (a log beside the append-only invoice, audited, nothing posted),
 * the due list only looking at suppliers that have a due invoice and its branch meaning, a dollar invoice with a discount
 * at the rounding edge, and the statement carrying the paper's due date, discount and charges.
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

type Who = { accessToken: string };
const send = (
  who: Who,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${who.accessToken}` },
    ...(payload ? { payload } : {}),
  });

async function product(store: Store, nameAr: string) {
  const res = await send(store, 'POST', '/v1/products', {
    nameAr,
    variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>().variants[0]!.id;
}

async function supplier(store: Store, name: string) {
  const res = await send(store, 'POST', '/v1/suppliers', { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

async function buy(store: Store, body: Record<string, unknown>) {
  const res = await send(store, 'POST', '/v1/purchases', { payment: 'credit', date: '2026-11-20', ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

const due = async (who: Who, query = 'days=90') =>
  (await send(who, 'GET', `/v1/suppliers/due?${query}`)).json<SupplierDueResponse>();

const patchDue = (who: Who, id: string, payload: Record<string, unknown>) =>
  send(who, 'PATCH', `/v1/purchases/${id}/due`, payload);

describe('round 64: a due date corrected after posting', () => {
  it('changes, clears and logs the date; the list, detail, due list and a corrected draft all show the new one', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, {
      supplierId: s.id,
      dueDate: '2026-12-01',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    const before = await balances(store.tenantId);
    const changed = await patchDue(store, made.id, { dueDate: '2026-12-15', reason: 'اتفاق جديد' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({
      purchaseId: made.id,
      dueDate: '2026-12-15',
      previousDueDate: '2026-12-01',
    });
    // The posting is untouched
    expect(await balances(store.tenantId)).toEqual(before);
    const detail = (await send(store, 'GET', `/v1/purchases/${made.id}`)).json<PurchaseDetail>();
    expect(detail.dueDate).toBe('2026-12-15');
    const listed = (await send(store, 'GET', '/v1/purchases')).json<PurchaseListResponse>();
    expect(listed.items.find((p) => p.id === made.id)?.dueDate).toBe('2026-12-15');
    expect((await due(store)).items.map((i) => i.dueDate)).toEqual(['2026-12-15']);
    // The same date again is no change and makes no row; a second change keeps the first in the log
    expect((await patchDue(store, made.id, { dueDate: '2026-12-15' })).statusCode).toBe(200);
    expect((await patchDue(store, made.id, { dueDate: '2026-12-20' })).statusCode).toBe(200);
    const rows = await ownerDb()<
      { due_date: string | null; previous_due_date: string | null; reason: string | null }[]
    >`select due_date::text, previous_due_date::text, reason from purchase_due_changes where purchase_id = ${made.id} order by created_at, id`;
    expect(rows).toEqual([
      { due_date: '2026-12-15', previous_due_date: '2026-12-01', reason: 'اتفاق جديد' },
      { due_date: '2026-12-20', previous_due_date: '2026-12-15', reason: null },
    ]);
    const audited = await ownerDb()<
      { n: string }[]
    >`select count(*)::text as n from audit_logs where action = 'purchase.due_changed' and entity_id = ${made.id}`;
    expect(audited[0]!.n).toBe('2');
    // Cleared: no date, so it is off the due list
    const cleared = await patchDue(store, made.id, { dueDate: null });
    expect(cleared.json()).toMatchObject({ dueDate: null, previousDueDate: '2026-12-20' });
    expect((await send(store, 'GET', `/v1/purchases/${made.id}`)).json<PurchaseDetail>().dueDate).toBeNull();
    expect((await due(store)).items).toEqual([]);
    // Back again, then the invoice is corrected: the draft keeps the corrected date
    await patchDue(store, made.id, { dueDate: '2026-12-25' });
    const correction = await send(store, 'POST', `/v1/purchases/${made.id}/correct`, { date: '2026-11-21' });
    expect(correction.statusCode, correction.body).toBe(201);
    expect(correction.json<{ draft: PurchaseDraft }>().draft.dueDate).toBe('2026-12-25');
    // A corrected invoice owes nothing: its date is left alone
    expect((await patchDue(store, made.id, { dueDate: '2026-12-30' })).statusCode).toBe(400);
  });

  it('refuses a cash invoice, a day before the invoice, a bad body, and a branch the user may not see', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const cash = await buy(store, {
      supplierId: s.id,
      payment: 'cash',
      lines: [{ variantId, qty: 1000, costMinor: 10_000 }],
    });
    const credit = await buy(store, {
      supplierId: s.id,
      dueDate: '2026-12-01',
      lines: [{ variantId, qty: 1000, costMinor: 10_000 }],
    });
    const onCash = await patchDue(store, cash.id, { dueDate: '2026-12-01' });
    expect(onCash.statusCode).toBe(400);
    expect(onCash.json()).toMatchObject({ error: { fields: { dueDate: expect.any(String) } } });
    expect((await patchDue(store, credit.id, { dueDate: '2026-11-19' })).statusCode).toBe(400);
    expect((await patchDue(store, credit.id, { dueDate: 'غد' })).statusCode).toBe(400);
    expect((await patchDue(store, credit.id, {})).statusCode).toBe(400);
    expect(
      (await patchDue(store, '00000000-0000-4000-8000-000000000000', { dueDate: null })).statusCode,
    ).toBe(404);
    const main = await firstBranch(store.tenantId);
    const [mall] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع المول') returning id`;
    const keeper = await staffUser(app, { ...store, branchId: main }, 'storekeeper', '0955000002', {
      branchId: mall!.id,
    });
    // He works the mall only: this invoice is the main branch's
    expect((await patchDue(keeper, credit.id, { dueDate: '2026-12-09' })).statusCode).toBe(404);
    const cashier = await staffUser(app, { ...store, branchId: main }, 'cashier', '0955000003');
    expect((await patchDue(cashier, credit.id, { dueDate: '2026-12-09' })).statusCode).toBe(403);
  });
});

describe('round 64: the due list', () => {
  it('looks only at suppliers with an invoice due, and «all» also lists the ones far ahead', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const soon = await supplier(store, 'قريب');
    const far = await supplier(store, 'بعيد');
    const none = await supplier(store, 'بلا موعد');
    const line = (costMinor: number) => [{ variantId, qty: 1000, costMinor }];
    await buy(store, { supplierId: soon.id, dueDate: '2026-11-25', lines: line(10_000) });
    await buy(store, { supplierId: far.id, dueDate: '2030-01-01', lines: line(20_000) });
    await buy(store, { supplierId: none.id, lines: line(30_000) });
    expect((await due(store, 'days=90')).items.map((i) => i.supplierName)).toEqual(['قريب']);
    const all = await due(store, 'all=1');
    expect(all.items.map((i) => i.supplierName)).toEqual(['قريب', 'بعيد']);
    expect(all.totalMinor).toBe(30_000);
    expect((await send(store, 'GET', '/v1/suppliers/due?all=yes')).statusCode).toBe(400);
  });

  it('works out the open amount over all branches; a user of one branch sees the rows of his own', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const main = await firstBranch(store.tenantId);
    const [mall] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع المول') returning id`;
    // An older invoice in the main branch, a newer one in the mall; 120,000 of 300,000 is paid. Payments settle the oldest
    // first, so the balance (180,000) sits on the newest invoice and the old one is settled
    await buy(store, {
      supplierId: s.id,
      branchId: main,
      date: '2026-11-01',
      dueDate: '2026-11-10',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    const newMall = await buy(store, {
      supplierId: s.id,
      branchId: mall!.id,
      date: '2026-11-05',
      dueDate: '2026-11-12',
      lines: [{ variantId, qty: 1000, costMinor: 200_000 }],
    });
    const paid = await send(store, 'POST', '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-11-06',
      amountMinor: 120_000,
      method: 'cash',
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect((await due(store)).items.map((i) => [i.number, i.openMinor])).toEqual([[newMall.number, 180_000]]);
    // A storekeeper of the main branch sees none of it (the open invoice is the mall's); one of the mall sees it with
    // the same amount: the supplier's debt is the store's, not a branch's
    const base = { ...store, branchId: main };
    const mainKeeper = await staffUser(app, base, 'storekeeper', '0955000004', { branchId: main });
    const mallKeeper = await staffUser(app, base, 'storekeeper', '0955000005', { branchId: mall!.id });
    expect((await due(mainKeeper)).items).toEqual([]);
    const theirs = await due(mallKeeper);
    expect(theirs.items.map((i) => [i.number, i.openMinor])).toEqual([[newMall.number, 180_000]]);
    expect(theirs.totalMinor).toBe(180_000);
  });
});

describe('round 64: a dollar invoice with a discount at the rounding edge', () => {
  it('spreads a discount that does not divide evenly; the lines, the total and the books agree to the qirsh', async () => {
    const store = await openStore(app);
    const rate = await send(store, 'PUT', '/v1/store/currency', { usdEnabled: true, usdRate: '14567.5' });
    expect(rate.statusCode, rate.body).toBe(200);
    const a = await product(store, 'قميص');
    const b = await product(store, 'بنطال');
    const c = await product(store, 'جاكيت');
    const s = await supplier(store, 'مورد دولار');
    // 33.33 + 33.33 + 33.34 dollars, a 0.01 discount and 0.02 charges: a cent cannot be shared three ways
    const made = await buy(store, {
      supplierId: s.id,
      currency: 'USD',
      discountMinor: 1,
      chargesMinor: 2,
      lines: [
        { variantId: a, qty: 1000, costMinor: 3333 },
        { variantId: b, qty: 1000, costMinor: 3333 },
        { variantId: c, qty: 1000, costMinor: 3334 },
      ],
    });
    expect(made.foreignTotalMinor).toBe(10_001);
    const foreignLines = made.lines.map((l) => l.foreignCostMinor ?? 0);
    expect(foreignLines.reduce((x, y) => x + y, 0)).toBe(10_001);
    expect(Math.min(...foreignLines)).toBeGreaterThan(0);
    expect(made.totalMinor).toBe(made.lines.reduce((x, l) => x + l.costMinor, 0));
    const books = await balances(store.tenantId);
    expect(books.get('1300')?.base).toBe(made.totalMinor);
    expect(books.get('2100')?.base).toBe(-made.totalMinor);
    expect(made.discountMinor).toBe(1);
    expect(made.chargesMinor).toBe(2);
    // A discount larger than the paper is refused in dollars too
    const over = await send(store, 'POST', '/v1/purchases', {
      supplierId: s.id,
      currency: 'USD',
      date: '2026-11-20',
      payment: 'credit',
      discountMinor: 10_000,
      lines: [{ variantId: a, qty: 1000, costMinor: 3333 }],
    });
    expect(over.statusCode).toBe(400);
  });
});

describe('round 64: the statement carries the paper', () => {
  it('gives a purchase line its corrected due date, discount, charges and the supplier number', async () => {
    const store = await openStore(app);
    const variantId = await product(store, 'فستان');
    const s = await supplier(store, 'مورد');
    const made = await buy(store, {
      supplierId: s.id,
      reference: 'INV-77',
      dueDate: '2026-12-01',
      discountMinor: 10_000,
      chargesMinor: 5_000,
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    await patchDue(store, made.id, { dueDate: '2026-12-09' });
    await send(store, 'POST', '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-11-21',
      amountMinor: 1_000,
      method: 'cash',
    });
    const st = (
      await send(store, 'GET', `/v1/suppliers/${s.id}/statement?from=2026-11-01&to=2026-11-30`)
    ).json<PartyStatement>();
    expect(st.lines.find((l) => l.sourceType === 'purchase')?.purchase).toEqual({
      dueDate: '2026-12-09',
      discountMinor: 10_000,
      chargesMinor: 5_000,
      reference: 'INV-77',
    });
    expect(st.lines.find((l) => l.sourceType !== 'purchase')?.purchase).toBeUndefined();
    expect(st.closingMinor).toBe(95_000 - 1_000);
  });
});
