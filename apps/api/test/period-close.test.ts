import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BalanceSheet, PeriodCloseState, SupplierRow, TrialBalance } from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
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
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore } from './staff';

/**
 * «إقفال الفترة» (round 37, decision 17). The clock of the test app is 2026-10-30, so yesterday is the latest day
 * that can be closed. A dashboard document dated in the closed period is refused; a document a device sends late is
 * accepted, dated as it was, and posted on the first open day, so a closed month's books never change.
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

const as = (store: Pick<Store, 'accessToken'>) => bearer(store.accessToken);
const post = (store: Pick<Store, 'accessToken'>, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(store), payload: payload as object });
const get = async <T>(store: Pick<Store, 'accessToken'>, url: string): Promise<T> => {
  const res = await app.inject({ method: 'GET', url, headers: as(store) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

async function branchOf(store: Store) {
  return (
    await ownerDb()<{ id: string }[]>`select id from branches where tenant_id = ${store.tenantId} limit 1`
  )[0]!.id;
}

/** A shift open since 2026-10-20 and one cash sale that day, as the device sends them */
async function aWeek(store: Store) {
  const doc = documents(store.device, '2026-10-20');
  const open = doc('shift_open', shiftOpen(store.userId));
  const first = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 100_000)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000 }],
    }),
  );
  await push(app, store.device, [open, first]);
  return { open, doc };
}

const entries = (store: Store) =>
  ownerDb()<
    { number: string; entry_date: string; posting_date: string; posted: boolean; source_type: string }[]
  >`
    select number, entry_date::text, posting_date::text, posted_to_open_period as posted, source_type
    from journal_entries where tenant_id = ${store.tenantId} order by year, seq`;

const problems = async (store: Store) =>
  (await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId))).checks.flatMap(
    (c) => c.problems.map((p) => `${c.name}: ${p}`),
  );

describe('closing the period', () => {
  it('without a close every entry posts on its own day, as before', async () => {
    const store = await openStore(app);
    await aWeek(store);
    const rows = await entries(store);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.posting_date === r.entry_date && !r.posted)).toBe(true);
    const state = await get<PeriodCloseState>(store, '/v1/period-close');
    expect(state).toMatchObject({ lockedThrough: null, firstOpenDay: null, latestCloseDate: '2026-10-29' });
    expect(state.checks.every((c) => c.ok)).toBe(true);
  });

  it('refuses a dashboard document dated in the closed period, in plain Arabic, and takes one after it', async () => {
    const store = await openStore(app);
    await aWeek(store);
    const branchId = await branchOf(store);
    const closed = await post(store, '/v1/period-close/close', { through: '2026-10-25' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json<PeriodCloseState>()).toMatchObject({
      lockedThrough: '2026-10-25',
      firstOpenDay: '2026-10-26',
      history: [{ kind: 'close', lockedThrough: '2026-10-25' }],
    });

    const supplier = (await post(store, '/v1/suppliers', { name: 'مورد' })).json<SupplierRow>();
    const item = await makeProduct(app, store, 'حليب', 25_000);
    const attempts = [
      post(store, '/v1/expenses', {
        date: '2026-10-25',
        branchId,
        accountCode: '6102',
        currency: 'SYP',
        amountMinor: 5000,
        payFrom: 'safe',
      }),
      post(store, '/v1/journal/manual', {
        date: '2026-10-10',
        branchId,
        memo: 'قيد',
        lines: [
          { accountCode: '1130', debitMinor: 1000 },
          { accountCode: '3100', creditMinor: 1000 },
        ],
      }),
      post(store, '/v1/purchases', {
        supplierId: supplier.id,
        date: '2026-10-24',
        payment: 'credit',
        lines: [{ variantId: item.variantId, qty: 1000, costMinor: 20_000 }],
      }),
      post(store, '/v1/supplier-payments', {
        supplierId: supplier.id,
        date: '2026-10-01',
        amountMinor: 1000,
        method: 'bank',
      }),
      post(store, '/v1/stocktakes', {
        date: '2026-10-20',
        lines: [{ variantId: item.variantId, countedQty: 1000 }],
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(409);
      const body = res.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>();
      expect(body.error.code).toBe('period_closed');
      expect(body.error.message).toContain('هذه الفترة مقفلة حتى 2026-10-25');
      expect(body.error.fields?.date).toContain('مقفلة');
    }
    // Nothing was written by the refusals
    const [count] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from expenses where tenant_id = ${store.tenantId}`;
    expect(Number(count!.n)).toBe(0);

    // The first open day is fine
    const ok = await post(store, '/v1/expenses', {
      date: '2026-10-26',
      branchId,
      accountCode: '6102',
      currency: 'SYP',
      amountMinor: 5000,
      payFrom: 'safe',
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('accepts a late device document into the first open day, flagged, and a closed month never changes', async () => {
    const store = await openStore(app);
    const { open, doc } = await aWeek(store);
    const asOf = '2026-10-25';
    const sheetBefore = await get<BalanceSheet>(store, `/v1/reports/balance-sheet?asOf=${asOf}`);
    const tbBefore = await get<TrialBalance>(
      store,
      '/v1/reports/trial-balance?from=2026-10-01&to=2026-10-25',
    );

    expect((await post(store, '/v1/period-close/close', { through: asOf })).statusCode).toBe(200);

    // A cash sale of 2026-10-20 that the device held back and sends now, after the close
    const late = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 70_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 70_000 }],
      }),
    );
    const pushed = await push(app, store.device, [late]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted']);

    const rows = await entries(store);
    const lateEntry = rows.find(
      (r) => r.entry_date === '2026-10-20' && r.source_type === 'sale' && r.number !== rows[0]!.number,
    );
    expect(lateEntry).toMatchObject({ posting_date: '2026-10-26', posted: true, source_type: 'sale' });
    // The document keeps its own day everywhere an operational report reads it
    const [inv] = await ownerDb()<{ business_date: string }[]>`
      select business_date::text from invoices where tenant_id = ${store.tenantId} order by created_at desc limit 1`;
    expect(inv!.business_date).toBe('2026-10-20');

    // The closed month's books are exactly what they were; the sale shows from the first open day on
    expect(await get<BalanceSheet>(store, `/v1/reports/balance-sheet?asOf=${asOf}`)).toEqual(sheetBefore);
    expect(await get<TrialBalance>(store, '/v1/reports/trial-balance?from=2026-10-01&to=2026-10-25')).toEqual(
      tbBefore,
    );
    const after = await get<TrialBalance>(store, '/v1/reports/trial-balance?from=2026-10-26&to=2026-10-31');
    expect(after.totals.debitMinor).toBe(after.totals.creditMinor);
    expect(after.totals.debitMinor).toBeGreaterThan(0);
    const sheetAfter = await get<BalanceSheet>(store, '/v1/reports/balance-sheet?asOf=2026-10-31');
    expect(sheetAfter.balanced).toBe(true);

    // The accountant sees it listed
    const state = await get<PeriodCloseState>(store, '/v1/period-close');
    expect(state.late).toEqual([
      expect.objectContaining({ entryDate: '2026-10-20', postingDate: '2026-10-26', sourceType: 'sale' }),
    ]);
    expect(state.lateTotalMinor).toBeGreaterThan(0);
    // The books still agree with themselves
    expect(await problems(store)).toEqual([]);
  });

  it('closes only up to yesterday, only forward, only with the integrity check green', async () => {
    const store = await openStore(app);
    await aWeek(store);
    expect((await post(store, '/v1/period-close/close', { through: '2026-10-30' })).statusCode).toBe(400);
    expect((await post(store, '/v1/period-close/close', { through: '2027-01-01' })).statusCode).toBe(400);
    expect((await post(store, '/v1/period-close/close', { through: '2026-10-25' })).statusCode).toBe(200);
    const again = await post(store, '/v1/period-close/close', { through: '2026-10-24' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain('2026-10-25');

    // A book that does not agree with itself is not closed: break the stock on purpose
    const variant = await makeProduct(app, store, 'صنف', 10_000);
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${store.tenantId}, ${await branchOf(store)}, ${variant.variantId}, 5000)`;
    const refused = await post(store, '/v1/period-close/close', { through: '2026-10-27' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('فحص السلامة');
    expect((await get<PeriodCloseState>(store, '/v1/period-close')).lockedThrough).toBe('2026-10-25');
  });

  it('the owner reopens with a reason, audited; nobody else closes or reopens', async () => {
    const store = await testStore(app);
    const manager = await staffUser(app, store, 'manager', '0922222222');
    const accountant = await staffUser(app, store, 'accountant', '0933333333');
    const denied = await post(manager, '/v1/period-close/close', { through: '2026-10-25' });
    expect(denied.statusCode).toBe(403);
    expect((await post(accountant, '/v1/period-close/close', { through: '2026-10-25' })).statusCode).toBe(
      403,
    );
    // The accountant reads the state
    expect(
      (await app.inject({ method: 'GET', url: '/v1/period-close', headers: as(accountant) })).statusCode,
    ).toBe(200);

    expect((await post(store, '/v1/period-close/close', { through: '2026-10-25' })).statusCode).toBe(200);
    expect(
      (await post(manager, '/v1/period-close/reopen', { through: null, reason: 'تصحيح' })).statusCode,
    ).toBe(403);
    expect((await post(store, '/v1/period-close/reopen', { through: null })).statusCode).toBe(400);
    // Forward is not a reopen
    expect(
      (await post(store, '/v1/period-close/reopen', { through: '2026-10-28', reason: 'تصحيح' })).statusCode,
    ).toBe(400);
    const back = await post(store, '/v1/period-close/reopen', {
      through: '2026-10-20',
      reason: 'فاتورة منسية',
    });
    expect(back.statusCode, back.body).toBe(200);
    const state = back.json<PeriodCloseState>();
    expect(state.lockedThrough).toBe('2026-10-20');
    expect(state.history.map((h) => [h.kind, h.lockedThrough, h.previousThrough])).toEqual([
      ['reopen', '2026-10-20', '2026-10-25'],
      ['close', '2026-10-25', null],
    ]);
    expect(state.history[0]!.reason).toBe('فاتورة منسية');

    const audits = await ownerDb()<{ action: string; reason: string | null }[]>`
      select action, reason from audit_logs where tenant_id = ${store.tenantId} and action like 'period.%' order by created_at`;
    expect(audits).toEqual([
      { action: 'period.close', reason: null },
      { action: 'period.reopen', reason: 'فاتورة منسية' },
    ]);

    // Open everything: a document of a closed day is taken again
    expect(await post(store, '/v1/period-close/reopen', { through: null, reason: 'فتح الكل' })).toBeTruthy();
    const branchId = store.branchId;
    const ok = await post(store, '/v1/expenses', {
      date: '2026-10-10',
      branchId,
      accountCode: '6102',
      currency: 'SYP',
      amountMinor: 5000,
      payFrom: 'safe',
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('reverses an expense of a closed period on the first open day and says so', async () => {
    const store = await testStore(app);
    const branchId = store.branchId;
    const made = await post(store, '/v1/expenses', {
      date: '2026-10-10',
      branchId,
      accountCode: '6102',
      currency: 'SYP',
      amountMinor: 5000,
      payFrom: 'safe',
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json<{ id: string }>().id;
    expect((await post(store, '/v1/period-close/close', { through: '2026-10-25' })).statusCode).toBe(200);
    const voided = await post(store, `/v1/expenses/${id}/void`, { reason: 'خطأ' });
    expect(voided.statusCode, voided.body).toBe(200);
    const rows = await ownerDb()<
      { posting_date: string; entry_date: string; memo: string; posted: boolean }[]
    >`
      select posting_date::text, entry_date::text, memo, posted_to_open_period as posted
      from journal_entries where tenant_id = ${store.tenantId} and kind = 'reversal'`;
    expect(rows).toEqual([
      {
        posting_date: '2026-10-26',
        entry_date: '2026-10-10',
        memo: expect.stringContaining('تصحيح فترة سابقة'),
        posted: true,
      },
    ]);
    // The closed month still shows the expense; the reversal is in the open month
    const tb = await get<TrialBalance>(store, '/v1/reports/trial-balance?from=2026-10-01&to=2026-10-25');
    expect(tb.totals.debitMinor).toBe(tb.totals.creditMinor);
    expect(tb.rows.find((r) => r.accountCode === '6102')?.debitMinor).toBe(5000);
  });
});
