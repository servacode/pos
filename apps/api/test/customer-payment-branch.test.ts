import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildSchedule,
  INSTALMENT_FEE_NAME,
  INSTALMENT_FEE_PRODUCT_ID,
  INSTALMENT_FEE_VARIANT_ID,
  type CustomerDetail,
  type CustomerMoneyResult,
  type InstalmentPlanInput,
  type PlanDetail,
  type TrialBalance,
} from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
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
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Round 36 (decision 20, X1): a customer's payment from the admin names its branch. The receipt posts
 * with that branchId, so the branch's reports include it and «كل الفروع» is unchanged. A payment
 * that names no branch posts exactly as it always did.
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

const newId = createUuidV7();
const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const Q = 'from=2026-10-30&to=2026-11-30';

async function setup() {
  const store = await openStore(app);
  const [main] = await ownerDb()<
    { id: string }[]
  >`select id from branches where tenant_id = ${store.tenantId}`;
  const [second] = await ownerDb()<{ id: string }[]>`
    insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع المزة') returning id`;
  const customer = (
    await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: as(store),
      payload: { name: 'أبو خالد' },
    })
  ).json<CustomerDetail>();
  const debt = await app.inject({
    method: 'POST',
    url: `/v1/customers/${customer.id}/opening-debt`,
    headers: as(store),
    payload: { amountMinor: 80_000, date: '2026-11-01' },
  });
  expect(debt.statusCode, debt.body).toBe(201);
  return { store, main: main!.id, second: second!.id, customer };
}

const pay = (store: Store, customerId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/v1/customers/${customerId}/payments`,
    headers: as(store),
    payload: { method: 'cash', date: '2026-10-30', ...body },
  });

const trial = async (store: Store, branchId?: string) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/reports/trial-balance?${Q}${branchId ? `&branchId=${branchId}` : ''}`,
      headers: as(store),
    })
  ).json<TrialBalance>();

/** The movement of the customers' account (1200) and the safe (1120…) in a trial balance */
const moves = (tb: TrialBalance) => {
  const rows = tb.rows.filter((r) => r.accountCode === '1200' || r.accountCode.startsWith('1120'));
  return {
    owed: rows.filter((r) => r.accountCode === '1200').reduce((n, r) => n + r.creditMinor, 0),
    safe: rows.filter((r) => r.accountCode.startsWith('1120')).reduce((n, r) => n + r.debitMinor, 0),
  };
};

describe('a customer payment from the admin names its branch', () => {
  it('posts with the branch, shows in that branch’s report, and «كل الفروع» is the sum of all payments', async () => {
    const { store, main, second, customer } = await setup();
    const a = await pay(store, customer.id, { amountMinor: 30_000, branchId: main });
    const b = await pay(store, customer.id, { amountMinor: 10_000, branchId: second });
    // An old-style payment names no branch
    const c = await pay(store, customer.id, { amountMinor: 5_000 });
    for (const r of [a, b, c]) expect(r.statusCode, r.body).toBe(201);
    expect(a.json<CustomerMoneyResult>().branchId).toBe(main);
    expect(c.json<CustomerMoneyResult>().branchId).toBeUndefined();

    const entries = await ownerDb()<{ number: string; branch_id: string | null }[]>`
      select number, branch_id from journal_entries
      where tenant_id = ${store.tenantId} and memo like 'سند قبض%' order by seq`;
    expect(entries.map((e) => e.branch_id)).toEqual([main, second, null]);

    // Each branch's own report holds its payment; the money is in the safe against 1200
    expect(moves(await trial(store, main))).toEqual({ owed: 30_000, safe: 30_000 });
    expect(moves(await trial(store, second))).toEqual({ owed: 10_000, safe: 10_000 });
    // «كل الفروع»: every payment, the branchless one included, exactly the total as before
    const all = await trial(store);
    expect(moves(all)).toEqual({ owed: 45_000, safe: 45_000 });
    expect(all.balanced).toBe(true);
    expect((await trial(store, main)).balanced).toBe(true);
    expect((await trial(store, second)).balanced).toBe(true);

    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${customer.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(80_000 - 45_000);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
    const sum = [...(await balances(store.tenantId)).values()].reduce((n, x) => n + x.base, 0);
    expect(sum).toBe(0);
  });

  it('sent twice with the same id it posts once, with its branch', async () => {
    const { store, second, customer } = await setup();
    const id = newId();
    await pay(store, customer.id, { id, amountMinor: 7_000, branchId: second });
    const again = await pay(store, customer.id, { id, amountMinor: 7_000, branchId: second });
    expect(again.statusCode).toBe(201);
    const rows = await ownerDb()<{ branch_id: string | null }[]>`
      select branch_id from journal_entries where tenant_id = ${store.tenantId} and source_id = ${id}`;
    expect(rows).toEqual([{ branch_id: second }]);
  });

  it('refuses a branch that is not the store’s, in Arabic', async () => {
    const { store, customer } = await setup();
    const res = await pay(store, customer.id, { amountMinor: 1_000, branchId: newId() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { fields: { branchId: 'الفرع غير موجود' } } });
    const [n] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from journal_entries where tenant_id = ${store.tenantId} and memo like 'سند قبض%'`;
    expect(n?.n).toBe('0');
  });

  it('the admin instalment receive names its branch the same way', async () => {
    const { store, second } = await setup();
    const built = buildSchedule({
      totalMinor: 100_000,
      downPaymentMinor: 20_000,
      count: 3,
      frequency: 'monthly',
      firstDueDate: '2026-11-30',
      markupMinor: 4_000,
    });
    const plan: InstalmentPlanInput = {
      id: newId(),
      count: 3,
      frequency: 'monthly',
      firstDueDate: '2026-11-30',
      downPaymentMinor: 20_000,
      principalMinor: built.principalMinor,
      markupMinor: 4_000,
      financedMinor: built.financedMinor,
      markupBp: 500,
      guarantor: { name: 'أبو سامر', phone: '0933000111' },
      borrower: { nationalId: '01010101010' },
      notesMode: 'each',
      schedule: built.instalments,
    };
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const [cust] = await ownerDb()<
      { id: string }[]
    >`select id from customers where tenant_id = ${store.tenantId}`;
    const sold = doc('sale', {
      ...sale(store, open.id, {
        lines: [
          cartLine(1, 100_000),
          cartLine(2, plan.markupMinor, {
            productId: INSTALMENT_FEE_PRODUCT_ID,
            variantId: INSTALMENT_FEE_VARIANT_ID,
            name: INSTALMENT_FEE_NAME,
            noInvoiceDiscount: true,
          }),
        ],
        payments: [
          { method: 'cash', currency: 'SYP', amountMinor: 20_000 },
          { method: 'credit', currency: 'SYP', amountMinor: plan.financedMinor },
        ],
        customerId: cust!.id,
        customerName: 'أبو خالد',
      }),
      installmentPlan: plan,
    });
    await push(app, store.device, [open, sold]);
    const [p] = await ownerDb()<{ id: string }[]>`select id from installment_plans`;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${p!.id}/collect`,
      headers: as(store),
      payload: { amountMinor: 30_000, method: 'cash', branchId: second, date: '2026-10-30' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PlanDetail>().instalments.map((i) => i.paidMinor)).toEqual([28_000, 2_000, 0]);
    const receipt = (await postedEntries(store.tenantId)).find(
      (e) =>
        e.number &&
        e.sourceType === 'manual' &&
        e.lines.some((l) => l.code === '1200' && l.credit === 30_000),
    );
    expect(receipt).toBeDefined();
    const [row] = await ownerDb()<{ branch_id: string | null }[]>`
      select branch_id from journal_entries where tenant_id = ${store.tenantId} and number = ${receipt!.number}`;
    expect(row?.branch_id).toBe(second);
    expect(moves(await trial(store, second)).owed).toBe(30_000);
  });
});
