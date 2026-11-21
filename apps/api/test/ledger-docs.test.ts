import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ExpenseListResponse,
  ExpenseRow,
  ManualEntryRow,
  PartyStatement,
  ProfitLoss,
  SupplierRow,
  TrialBalance,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import {
  balances,
  cartLine,
  compact,
  documents,
  makeProduct,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { firstBranch } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Statements, expenses, manual entries and the profit and loss (contracts/ledger-docs.ts; 29): all
 * of it read from, or posted into, the one ledger — balanced, once, and never edited.
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
const PIECE = 1000;

const get = <T>(store: Pick<Store, 'accessToken'>, url: string) =>
  app.inject({ method: 'GET', url, headers: as(store) }).then((res) => {
    expect(res.statusCode, res.body).toBe(200);
    return res.json<T>();
  });
const post = (store: Pick<Store, 'accessToken'>, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(store), payload: payload as Record<string, unknown> });

const integrity = (store: Store) =>
  withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId)).then((r) =>
    r.checks.flatMap((c) => c.problems),
  );

async function addCustomer(store: Store, name = 'أبو خالد') {
  const res = await post(store, '/v1/customers', { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>();
}

async function addSupplier(store: Store) {
  const res = await post(store, '/v1/suppliers', { name: 'مؤسسة الفرات' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

const expense = (branchId: string, extra: Record<string, unknown> = {}) => ({
  date: '2026-10-30',
  branchId,
  accountCode: '6101',
  amountMinor: 250_000,
  currency: 'SYP',
  payFrom: 'safe',
  note: 'إيجار تشرين',
  ...extra,
});

const manual = (branchId: string, extra: Record<string, unknown> = {}) => ({
  date: '2026-10-30',
  branchId,
  memo: 'تسوية صندوق',
  lines: [
    { accountCode: '6190', debitMinor: 5000 },
    { accountCode: '1120', creditMinor: 5000 },
  ],
  ...extra,
});

describe('customer statement', () => {
  it('opening balance, each movement with its running balance, and the closing balance, for any range', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 30_000)],
        payments: [{ method: 'credit', currency: 'SYP', amountMinor: 30_000 }],
        customerId: c.id,
        customerName: 'أبو خالد',
      }),
    );
    const paid = doc('receipt', {
      customerId: c.id,
      customerName: 'أبو خالد',
      shiftId: open.id,
      cashierId: store.userId,
      currency: 'SYP',
      amountMinor: 12_000,
      method: 'cash',
      reference: null,
      note: null,
    });
    await push(app, store.device, [open, sold, paid]);

    const all = await get<PartyStatement>(
      store,
      `/v1/customers/${c.id}/statement?from=2026-01-01&to=2026-12-31`,
    );
    expect(all).toMatchObject({
      type: 'customer',
      openingMinor: 0,
      closingMinor: 18_000,
      baseCurrency: 'SYP',
    });
    expect(all.lines.map((l) => [l.sourceType, l.debitMinor, l.creditMinor, l.balanceMinor])).toEqual([
      ['sale', 30_000, 0, 30_000],
      ['receipt', 0, 12_000, 18_000],
    ]);
    expect(all.totalDebitMinor).toBe(30_000);
    expect(all.totalCreditMinor).toBe(12_000);

    // A range after the movements: everything is the opening balance.
    const later = await get<PartyStatement>(
      store,
      `/v1/customers/${c.id}/statement?from=2026-11-01&to=2026-11-30`,
    );
    expect(later).toMatchObject({ openingMinor: 18_000, closingMinor: 18_000, lines: [] });

    // The closing balance is the balance the customer's page shows.
    const detail = await get<{ balanceMinor: number }>(store, `/v1/customers/${c.id}`);
    expect(all.closingMinor).toBe(detail.balanceMinor);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/customers/${c.id}/statement?from=2026-12-01&to=2026-01-01`,
          headers: as(store),
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('supplier statement', () => {
  it('purchases raise what is owed, payments lower it, and an opening balance carries from before the range', async () => {
    const store = await openStore(app);
    const s = await addSupplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const bought = await post(store, '/v1/purchases', {
      supplierId: s.id,
      date: '2026-10-01',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    expect(bought.statusCode, bought.body).toBe(201);
    const paid = await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-10-15',
      amountMinor: 80_000,
      method: 'cash',
    });
    expect(paid.statusCode, paid.body).toBe(201);

    const st = await get<PartyStatement>(
      store,
      `/v1/suppliers/${s.id}/statement?from=2026-10-10&to=2026-10-31`,
    );
    expect(st).toMatchObject({ type: 'supplier', openingMinor: 200_000, closingMinor: 120_000 });
    expect(st.lines.map((l) => [l.sourceType, l.debitMinor, l.creditMinor, l.balanceMinor])).toEqual([
      ['supplier_payment', 80_000, 0, 120_000],
    ]);
    const listed = await get<{ items: SupplierRow[] }>(store, '/v1/suppliers');
    expect(st.closingMinor).toBe(listed.items.find((x) => x.id === s.id)!.balanceMinor);
  });
});

describe('expenses', () => {
  it('posts Dr expense / Cr the safe once, lists with totals, and a replay with the same id posts nothing new', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const body = expense(branchId, { id: '0197a2c0-0000-7000-8000-0000000000a1' });
    const made = await post(store, '/v1/expenses', body);
    expect(made.statusCode, made.body).toBe(201);
    const row = made.json<ExpenseRow>();
    expect(row).toMatchObject({
      number: 'EXP-2026-000001',
      accountCode: '6101',
      baseAmountMinor: 250_000,
      voided: false,
    });
    const entries = (await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'expense');
    expect(entries).toHaveLength(1);
    expect(compact(entries[0])).toEqual([
      ['6101', 250_000, 0],
      ['112001', 0, 250_000],
    ]);

    const again = await post(store, '/v1/expenses', body);
    expect(again.json<ExpenseRow>().id).toBe(row.id);
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'expense')).toHaveLength(1);

    await post(
      store,
      '/v1/expenses',
      expense(branchId, { accountCode: '6102', amountMinor: 50_000, payFrom: 'bank' }),
    );
    const list = await get<ExpenseListResponse>(store, '/v1/expenses?from=2026-10-01&to=2026-10-31');
    expect(list.items).toHaveLength(2);
    expect(list.totalMinor).toBe(300_000);
    expect(list.byAccount.map((a) => [a.accountCode, a.totalMinor])).toEqual([
      ['6101', 250_000],
      ['6102', 50_000],
    ]);
    const filtered = await get<ExpenseListResponse>(store, '/v1/expenses?accountCode=6102');
    expect(filtered.items.map((e) => e.accountCode)).toEqual(['6102']);
    expect(filtered.totalMinor).toBe(50_000);
    expect(await integrity(store)).toEqual([]);
  });

  it('a dollar expense keeps its dollars on the paying line and books the pounds at the rate', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    await ownerDb()`update tenant_settings set enabled_currencies = array['SYP', 'USD'] where tenant_id = ${store.tenantId}`;
    const made = await post(
      store,
      '/v1/expenses',
      expense(branchId, {
        accountCode: '6102',
        amountMinor: 1250,
        currency: 'USD',
        rate: { unit: 'USD', quote: 'SYP', rate: '130' },
        payFrom: 'bank',
      }),
    );
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<ExpenseRow>()).toMatchObject({ baseAmountMinor: 162_500, currency: 'USD' });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'expense');
    expect(entry!.lines).toMatchObject([
      { code: '6102', debit: 162_500, credit: 0, currency: 'SYP' },
      { code: '1130', debit: 0, credit: 162_500, currency: 'USD', amount: -1250 },
    ]);
  });

  it('refuses a non-expense account, a group, another currency than the store trades, and a missing rate', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    expect((await post(store, '/v1/expenses', expense(branchId, { accountCode: '1110' }))).statusCode).toBe(
      400,
    );
    expect((await post(store, '/v1/expenses', expense(branchId, { accountCode: '6100' }))).statusCode).toBe(
      400,
    );
    expect((await post(store, '/v1/expenses', expense(branchId, { amountMinor: 0 }))).statusCode).toBe(400);
    expect((await post(store, '/v1/expenses', expense(branchId, { currency: 'USD' }))).statusCode).toBe(400);
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'expense')).toHaveLength(0);
  });

  it('cancelling reverses the entry (dated as the original), shows struck out, leaves the totals, and works once', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const row = (await post(store, '/v1/expenses', expense(branchId))).json<ExpenseRow>();
    const voided = await post(store, `/v1/expenses/${row.id}/void`, { reason: 'سُجّل مرتين' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(voided.json<ExpenseRow>()).toMatchObject({
      voided: true,
      voidReason: expect.stringContaining('سُجّل مرتين'),
    });
    const entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceType === 'reversal'))).toEqual([
      ['112001', 250_000, 0],
      ['6101', 0, 250_000],
    ]);
    const list = await get<ExpenseListResponse>(store, '/v1/expenses');
    expect(list.items[0]!.voided).toBe(true);
    expect(list.totalMinor).toBe(0);
    expect((await post(store, `/v1/expenses/${row.id}/void`, { reason: 'ثانية' })).statusCode).toBe(409);
    expect((await post(store, `/v1/expenses/${row.id}/void`, {})).statusCode).toBe(400);
    const tb = await get<TrialBalance>(store, '/v1/reports/trial-balance?from=2026-10-01&to=2026-10-31');
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.accountCode === '6101')?.closingMinor ?? 0).toBe(0);
  });

  it('is for expenses.manage only: a cashier is refused', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const cashier = await staffUser(app, { ...store, branchId }, 'cashier', '0955123123');
    const res = await post(cashier, '/v1/expenses', expense(branchId));
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/expenses', headers: as(cashier) })).statusCode).toBe(
      403,
    );
  });
});

describe('manual journal entries', () => {
  it('posts a balanced entry (kind manual), refuses an unbalanced one, and the database refuses it too', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const made = await post(store, '/v1/journal/manual', manual(branchId));
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<ManualEntryRow>()).toMatchObject({ kind: 'manual', totalMinor: 5000, reversesId: null });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'manual');
    expect(compact(entry)).toEqual([
      ['6190', 5000, 0],
      ['112001', 0, 5000],
    ]);

    const bad = await post(
      store,
      '/v1/journal/manual',
      manual(branchId, {
        lines: [
          { accountCode: '6190', debitMinor: 5000 },
          { accountCode: '1120', creditMinor: 4999 },
        ],
      }),
    );
    expect(bad.statusCode).toBe(400);

    // Even if the application were wrong, the ledger's own trigger stops an unbalanced entry.
    const [account] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${store.tenantId} and code = '6190'`;
    const accountId = account!.id;
    await expect(
      ownerDb().begin(async (sql) => {
        const [e] = await sql<{ id: string }[]>`
          insert into journal_entries (tenant_id, branch_id, year, seq, number, entry_date, posting_date, kind,
            source_type, source_id, memo, base_currency, total_minor)
          values (${store.tenantId}, ${branchId}, 2026, 9999, '2026-0009999', '2026-10-30', '2026-10-30', 'manual',
            'manual', ${'0197a2c0-0000-7000-8000-0000000000b1'}, 'x', 'SYP', 100) returning id`;
        await sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
          values (${store.tenantId}, ${e!.id}, 1, ${accountId}, 100, 0, 'SYP', 100),
                 (${store.tenantId}, ${e!.id}, 2, ${accountId}, 0, 90, 'SYP', -90)`;
      }),
    ).rejects.toThrow(/balance/);
  });

  it('refuses groups, unknown accounts and accounts only their documents move (customers, suppliers, stock, drawers)', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    for (const code of ['6100', '9999', '1200', '2100', '1300']) {
      const res = await post(
        store,
        '/v1/journal/manual',
        manual(branchId, {
          lines: [
            { accountCode: code, debitMinor: 100 },
            { accountCode: '1120', creditMinor: 100 },
          ],
        }),
      );
      expect(res.statusCode, code).toBe(400);
    }
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'manual')).toHaveLength(0);
  });

  it('reversal: swaps every line, once, never of a reversal or of an automatic entry, and the books stay balanced', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const made = (await post(store, '/v1/journal/manual', manual(branchId))).json<ManualEntryRow>();
    const rev = await post(store, `/v1/journal/${made.id}/reverse`, { reason: 'قيد خاطئ' });
    expect(rev.statusCode, rev.body).toBe(200);
    const reversal = rev.json<ManualEntryRow>();
    expect(reversal).toMatchObject({ kind: 'reversal', reversesId: made.id, totalMinor: 5000 });
    const entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceType === 'reversal'))).toEqual([
      ['112001', 5000, 0],
      ['6190', 0, 5000],
    ]);
    expect((await balances(store.tenantId)).get('6190')?.base).toBe(0);

    expect((await post(store, `/v1/journal/${made.id}/reverse`, { reason: 'ثانية' })).statusCode).toBe(409);
    expect(
      (await post(store, `/v1/journal/${reversal.id}/reverse`, { reason: 'عكس العكس' })).statusCode,
    ).toBe(409);

    const expenseRow = (await post(store, '/v1/expenses', expense(branchId))).json<ExpenseRow>();
    const [auto] = await ownerDb()<{ id: string }[]>`
      select id from journal_entries where tenant_id = ${store.tenantId} and source_id = ${expenseRow.id}`;
    expect((await post(store, `/v1/journal/${auto!.id}/reverse`, { reason: 'من هنا لا' })).statusCode).toBe(
      409,
    );
    expect(await integrity(store)).toEqual([]);
  });

  it('a manual entry is idempotent by its id, and the owner alone may post one', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const body = manual(branchId, { id: '0197a2c0-0000-7000-8000-0000000000c1' });
    const first = (await post(store, '/v1/journal/manual', body)).json<ManualEntryRow>();
    const second = (await post(store, '/v1/journal/manual', body)).json<ManualEntryRow>();
    expect(second.id).toBe(first.id);
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'manual')).toHaveLength(1);

    const manager = await staffUser(app, { ...store, branchId }, 'manager', '0955333444');
    expect((await post(manager, '/v1/journal/manual', manual(branchId))).statusCode).toBe(403);
    expect((await post(manager, `/v1/journal/${first.id}/reverse`, { reason: 'x' })).statusCode).toBe(403);
    // …but a manager records expenses.
    expect((await post(manager, '/v1/expenses', expense(branchId))).statusCode).toBe(201);
  });
});

describe('profit and loss', () => {
  it('revenue less discounts, cost, expenses by group and the net, for a range and a branch', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    // A cash sale of 100.00 plus the cost of sales and a rent, entered by hand and by expense.
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 10_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 10_000 }],
      }),
    );
    await push(app, store.device, [open, sold]);
    await post(
      store,
      '/v1/journal/manual',
      manual(branchId, {
        memo: 'كلفة',
        lines: [
          { accountCode: '5100', debitMinor: 4000 },
          { accountCode: '1120', creditMinor: 4000 },
        ],
      }),
    );
    await post(store, '/v1/expenses', expense(branchId, { amountMinor: 1500 }));
    await post(store, '/v1/expenses', expense(branchId, { amountMinor: 700, accountCode: '6102' }));
    // Outside the range
    await post(store, '/v1/expenses', expense(branchId, { date: '2026-09-01', amountMinor: 99_999 }));

    const pnl = await get<ProfitLoss>(
      store,
      `/v1/reports/profit-loss?from=2026-10-01&to=2026-10-31&branchId=${branchId}`,
    );
    expect(pnl.revenue.totalMinor).toBe(10_000);
    expect(pnl.costOfSales.totalMinor).toBe(4000);
    expect(pnl.grossProfitMinor).toBe(6000);
    expect(pnl.expenses.groups).toMatchObject([
      {
        code: '61',
        totalMinor: 2200,
        accounts: [
          { accountCode: '6101', amountMinor: 1500 },
          { accountCode: '6102', amountMinor: 700 },
        ],
      },
    ]);
    expect(pnl.netProfitMinor).toBe(6000 - 2200);

    // A cancelled expense leaves the profit and loss.
    const row = (
      await post(store, '/v1/expenses', expense(branchId, { amountMinor: 300 }))
    ).json<ExpenseRow>();
    await post(store, `/v1/expenses/${row.id}/void`, { reason: 'خطأ' });
    const after = await get<ProfitLoss>(store, '/v1/reports/profit-loss?from=2026-10-01&to=2026-10-31');
    expect(after.netProfitMinor).toBe(3800);
  });

  it('needs accounting.view: a cashier is refused', async () => {
    const store = await openStore(app);
    const branchId = await firstBranch(store.tenantId);
    const cashier = await staffUser(app, { ...store, branchId }, 'cashier', '0955123123');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/profit-loss?from=2026-10-01&to=2026-10-31',
      headers: as(cashier),
    });
    expect(res.statusCode).toBe(403);
  });
});
