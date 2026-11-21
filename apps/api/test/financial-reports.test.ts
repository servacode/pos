import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type AccountLedger,
  type BalanceSheet,
  type CashFlow,
  type SupplierAgeingReport,
  type SupplierRow,
  type TaxReport,
  type TrialBalance,
} from '@serva/core';
import { payloadHash } from '@serva/sync';
import {
  cartLine,
  documents,
  makeProduct,
  movement,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser } from './staff';

/**
 * The financial statements (contracts/financial-reports.ts): each one is read-only and must agree
 * with another figure of the books: the balance sheet balances, the cash flow ends on the cash
 * accounts, the tax report equals the invoice lines and the tax accounts.
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

const get = async <T>(store: Pick<Store, 'accessToken'>, url: string): Promise<T> => {
  const res = await app.inject({ method: 'GET', url, headers: bearer(store.accessToken) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};
const post = (store: Pick<Store, 'accessToken'>, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: bearer(store.accessToken), payload: payload as object });

async function taxRate(store: Store, kind: 'sales' | 'consumption', rateBp: number) {
  const res = await post(store, '/v1/tax-rates', { name: `ضريبة ${rateBp / 100}%`, rateBp, kind });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

const CASH = ['111001', '111002', '1115', '112001', '112002', '1130', '1150'];
const Q = 'from=2026-10-30&to=2026-11-30';

/**
 * One store's month: capital into the bank, a shift with a 5 % sale (all of it returned), a 15 %
 * card sale, an untaxed cash sale, a credit sale and its receipt, a pay-in, a drawer expense and a
 * drop to the safe; then a purchase on credit, a part payment from the bank, a safe expense and a
 * drawing of the owner.
 */
async function aMonth(store: Store) {
  const vat = await taxRate(store, 'sales', 500);
  const consumption = await taxRate(store, 'consumption', 1500);
  const customer = (await post(store, '/v1/customers', { name: 'أبو خالد' })).json<{ id: string }>();
  const branchId = (
    await ownerDb()<{ id: string }[]>`select id from branches where tenant_id = ${store.tenantId} limit 1`
  )[0]!.id;
  // Capital into the bank the day before the period
  const capital = await post(store, '/v1/journal/manual', {
    date: '2026-10-29',
    branchId,
    memo: 'رأس المال',
    lines: [
      { accountCode: '1130', debitMinor: 5_000_000 },
      { accountCode: '3100', creditMinor: 5_000_000 },
    ],
  });
  expect(capital.statusCode, capital.body).toBe(201);

  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const salePayload = sale(store, open.id, {
    taxInclusive: false,
    lines: [cartLine(1, 100_000, { taxRateId: vat, taxRateBp: 500, name: 'ضريبة خمسة' })],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 105_000 }],
  });
  const sold = doc('sale', salePayload);
  const card = doc(
    'sale',
    sale(store, open.id, {
      taxInclusive: false,
      lines: [cartLine(1, 200_000, { taxRateId: consumption, taxRateBp: 1500, name: 'استهلاك' })],
      payments: [
        { method: 'card', currency: 'SYP', amountMinor: 230_000, reference: '1', cardLast4: '4821' },
      ],
    }),
  );
  const plain = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 50_000)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 50_000 }],
    }),
  );
  const credit = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 30_000)],
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 30_000 }],
      customerId: customer.id,
      customerName: 'أبو خالد',
    }),
  );
  const receipt = doc('receipt', {
    customerId: customer.id,
    customerName: 'أبو خالد',
    shiftId: open.id,
    cashierId: store.userId,
    currency: 'SYP',
    amountMinor: 12_000,
    method: 'cash',
    reference: null,
    note: null,
  });
  const returnPayload = buildReturnPayload({
    sale: salePayload,
    saleId: sold.id,
    saleNumber: sold.number!,
    shiftId: open.id,
    cashierId: store.userId,
    reason: 'تالف',
    picks: [{ saleLineNo: 1, qty: 1000 }],
    returned: [],
    reference: 'R-1',
  });
  const { hash: _hash, ...retBody } = doc('return', returnPayload);
  const ret = { ...retBody, deps: [sold.id] };
  const payIn = doc('cash_movement', movement(store.userId, open.id, 'pay_in', 50_000));
  const drawerExpense = doc('cash_movement', movement(store.userId, open.id, 'expense', 15_000));
  const drop = doc('cash_movement', movement(store.userId, open.id, 'safe_drop', 100_000));
  await push(app, store.device, [
    open,
    sold,
    card,
    plain,
    credit,
    receipt,
    { ...ret, hash: payloadHash(ret) },
    payIn,
    drawerExpense,
    drop,
  ]);

  // Purchases and what follows, through the screens' routes
  const supplier = (await post(store, '/v1/suppliers', { name: 'مؤسسة الفرات' })).json<SupplierRow>();
  const milk = await makeProduct(app, store, 'حليب', 25_000);
  const bought = await post(store, '/v1/purchases', {
    supplierId: supplier.id,
    date: '2026-09-15',
    payment: 'credit',
    lines: [{ variantId: milk.variantId, qty: 10_000, costMinor: 200_000 }],
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const paid = await post(store, '/v1/supplier-payments', {
    supplierId: supplier.id,
    date: '2026-10-31',
    amountMinor: 50_000,
    method: 'bank',
  });
  expect(paid.statusCode, paid.body).toBe(201);
  const rent = await post(store, '/v1/expenses', {
    date: '2026-11-02',
    branchId,
    accountCode: '6101',
    amountMinor: 20_000,
    currency: 'SYP',
    payFrom: 'safe',
    note: 'إيجار',
  });
  expect(rent.statusCode, rent.body).toBe(201);
  const drawing = await post(store, '/v1/journal/manual', {
    date: '2026-11-03',
    branchId,
    memo: 'مسحوبات',
    lines: [
      { accountCode: '3160', debitMinor: 70_000 },
      { accountCode: '1130', creditMinor: 70_000 },
    ],
  });
  expect(drawing.statusCode, drawing.body).toBe(201);
  return { branchId, supplier, customer };
}

/** What the books hold, read straight from the journal as the owner role (not through the service). */
const net = async (tenantId: string, codes: string[], upTo: string) =>
  Number(
    (
      await ownerDb()<{ n: string }[]>`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as n
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${tenantId} and a.code in ${ownerDb()(codes)} and e.entry_date <= ${upTo}::date`
    )[0]!.n,
  );

describe('balance sheet', () => {
  it('assets equal liabilities plus equity, with the profit folded in, on every date', async () => {
    const store = await openStore(app);
    await aMonth(store);
    for (const asOf of ['2026-09-01', '2026-10-29', '2026-10-30', '2026-11-30', '2026-12-31']) {
      const sheet = await get<BalanceSheet>(store, `/v1/reports/balance-sheet?asOf=${asOf}`);
      expect(sheet.balanced, asOf).toBe(true);
      expect(sheet.differenceMinor).toBe(0);
      expect(sheet.assets.totalMinor).toBe(sheet.liabilitiesAndEquityMinor);
      expect(sheet.liabilitiesAndEquityMinor).toBe(sheet.liabilities.totalMinor + sheet.equity.totalMinor);
      expect(sheet.baseCurrency).toBe('SYP');
    }
    const sheet = await get<BalanceSheet>(
      store,
      '/v1/reports/balance-sheet?asOf=2026-11-30&compareTo=2026-10-29',
    );
    // The profit line equals the profit and loss of the year to the date
    const pnl = await get<{ netProfitMinor: number }>(
      store,
      '/v1/reports/profit-loss?from=2026-01-01&to=2026-11-30',
    );
    const profit = sheet.equity.groups.find((g) => g.code === 'P')!;
    // Nothing before this year: only the year's own line
    expect(profit.accounts.map((a) => a.amountMinor)).toEqual([pnl.netProfitMinor]);
    expect(pnl.netProfitMinor).toBeGreaterThan(0);
    // Capital 50,000.00 less the drawing, and the earlier day shows the bank only
    const capital = sheet.equity.groups.flatMap((g) => g.accounts).find((a) => a.accountCode === '3100')!;
    expect(capital).toMatchObject({ amountMinor: 5_000_000, previousMinor: 5_000_000 });
    const drawings = sheet.equity.groups.flatMap((g) => g.accounts).find((a) => a.accountCode === '3160')!;
    expect(drawings).toMatchObject({ amountMinor: -70_000, previousMinor: 0 });
    expect(sheet.compareTo).toBe('2026-10-29');
    expect(sheet.assets.previousTotalMinor).toBe(5_200_000); // the bank and the stock bought on credit
    expect(sheet.previousLiabilitiesAndEquityMinor).toBe(5_200_000);
    // Each asset line is the journal's own balance
    const bank = sheet.assets.groups.flatMap((g) => g.accounts).find((a) => a.accountCode === '1130')!;
    expect(bank.amountMinor).toBe(await net(store.tenantId, ['1130'], '2026-11-30'));
    const sum = (groups: { totalMinor: number; accounts: { amountMinor: number }[] }[]) =>
      groups.every((g) => g.totalMinor === g.accounts.reduce((s, a) => s + a.amountMinor, 0));
    expect(sum(sheet.assets.groups) && sum(sheet.liabilities.groups) && sum(sheet.equity.groups)).toBe(true);
  });

  it('shows a customer who paid too much under the liabilities and a supplier paid ahead under the assets', async () => {
    const store = await openStore(app);
    const { supplier, customer } = await aMonth(store);
    // The customer pays 1,000.00 more than his 180.00; the supplier is paid 1,000.00 more than the 1,500.00 owed
    const over = await post(store, `/v1/customers/${customer.id}/payments`, {
      amountMinor: 118_000,
      method: 'cash',
      date: '2026-10-30',
    });
    expect(over.statusCode, over.body).toBe(201);
    const advance = await post(store, '/v1/supplier-payments', {
      supplierId: supplier.id,
      date: '2026-11-11',
      amountMinor: 250_000,
      method: 'bank',
      advance: true,
    });
    expect(advance.statusCode, advance.body).toBe(201);
    const sheet = await get<BalanceSheet>(store, '/v1/reports/balance-sheet?asOf=2026-11-30');
    expect(sheet.balanced).toBe(true);
    const liabilities = sheet.liabilities.groups.flatMap((g) => g.accounts);
    const assets = sheet.assets.groups.flatMap((g) => g.accounts);
    expect(liabilities.find((a) => a.accountCode === '1200')?.amountMinor).toBe(100_000);
    expect(assets.find((a) => a.accountCode === '2100')?.amountMinor).toBe(100_000);
    expect(assets.find((a) => a.accountCode === '1200')?.amountMinor ?? 0).toBe(0);
  });

  it('is empty and balanced for a new store, and one store never sees another’s books', async () => {
    const a = await openStore(app);
    await aMonth(a);
    const b = await openStore(app, '0922222222');
    const empty = await get<BalanceSheet>(b, '/v1/reports/balance-sheet?asOf=2026-11-30');
    expect(empty.balanced).toBe(true);
    expect(empty.assets.totalMinor).toBe(0);
    expect(empty.assets.groups).toEqual([]);
    expect(JSON.stringify(empty)).not.toContain('رأس المال');
    const mine = await get<BalanceSheet>(a, '/v1/reports/balance-sheet?asOf=2026-11-30');
    expect(mine.assets.totalMinor).toBeGreaterThan(0);
  });
});

describe('cash flow', () => {
  it('ends on the cash accounts’ balances, by account and by category', async () => {
    const store = await openStore(app);
    await aMonth(store);
    const flow = await get<CashFlow>(store, `/v1/reports/cash-flow?${Q}`);
    expect(flow.balanced).toBe(true);
    // Opening: the capital in the bank; closing: every cash account as the journal holds it
    expect(flow.totals.openingMinor).toBe(5_000_000);
    expect(flow.totals.openingMinor).toBe(await net(store.tenantId, CASH, '2026-10-29'));
    expect(flow.totals.closingMinor).toBe(await net(store.tenantId, CASH, '2026-11-30'));
    for (const account of flow.accounts) {
      expect(account.closingMinor, account.accountCode).toBe(
        await net(store.tenantId, [account.accountCode], '2026-11-30'),
      );
      expect(account.closingMinor).toBe(account.openingMinor + account.inMinor - account.outMinor);
    }
    // And against the trial balance of the same day
    const tb = await get<TrialBalance>(store, `/v1/reports/trial-balance?${Q}`);
    const tbCash = tb.rows
      .filter((r) => CASH.includes(r.accountCode))
      .reduce((s, r) => s + r.closingMinor, 0);
    expect(flow.totals.closingMinor).toBe(tbCash);
    // The categories add up to the change
    const change = flow.categories.reduce((s, c) => s + c.netMinor, 0);
    expect(change).toBe(flow.totals.closingMinor - flow.totals.openingMinor);
    const by = Object.fromEntries(flow.categories.map((c) => [c.category, c]));
    expect(by.sales).toMatchObject({ inMinor: 155_000, outMinor: 105_000 });
    expect(by.customer_receipts).toMatchObject({ inMinor: 12_000, outMinor: 0 });
    expect(by.supplier_payments).toMatchObject({ inMinor: 0, outMinor: 50_000 });
    expect(by.owner).toMatchObject({ inMinor: 0, outMinor: 70_000 });
    // The drop to the safe and the pay-in from it move cash between the store's own accounts: shown whole, net nothing
    expect(by.transfer).toMatchObject({ inMinor: 150_000, outMinor: 150_000, netMinor: 0 });
    // A drawer expense and a safe expense
    expect(by.expenses!.outMinor).toBe(15_000 + 20_000);
  });

  it('refuses a backwards range and answers an empty range with zeros', async () => {
    const store = await openStore(app);
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/reports/cash-flow?from=2026-12-01&to=2026-11-01',
      headers: bearer(store.accessToken),
    });
    expect(bad.statusCode).toBe(400);
    const flow = await get<CashFlow>(store, `/v1/reports/cash-flow?${Q}`);
    expect(flow).toMatchObject({ accounts: [], categories: [], balanced: true });
  });
});

describe('account ledger', () => {
  it('lists the movements with a running balance that ends on the account’s balance', async () => {
    const store = await openStore(app);
    await aMonth(store);
    const bank = await get<AccountLedger>(
      store,
      '/v1/reports/account-ledger?code=1130&from=2026-10-30&to=2026-11-30',
    );
    expect(bank.openingMinor).toBe(5_000_000);
    expect(bank.lines.at(-1)!.balanceMinor).toBe(bank.closingMinor);
    expect(bank.closingMinor).toBe(await net(store.tenantId, ['1130'], '2026-11-30'));
    expect(bank.closingMinor).toBe(5_000_000 - 50_000 - 70_000);
    expect(bank.lines.map((l) => l.sourceType)).toEqual(['supplier_payment', 'manual']);
    expect(bank.totalDebitMinor - bank.totalCreditMinor).toBe(bank.closingMinor - bank.openingMinor);
    expect(bank.truncated).toBe(false);
    // A credit-side account runs on its own side: the capital is a credit balance
    const capital = await get<AccountLedger>(
      store,
      '/v1/reports/account-ledger?code=3100&from=2026-01-01&to=2026-12-31',
    );
    expect(capital.closingMinor).toBe(5_000_000);
    // A group takes in the accounts under it
    const drawers = await get<AccountLedger>(
      store,
      '/v1/reports/account-ledger?code=1110&from=2026-10-30&to=2026-11-30',
    );
    expect(drawers.account.isGroup).toBe(true);
    expect(drawers.lines.every((l) => l.accountCode.startsWith('1110'))).toBe(true);
    expect(drawers.closingMinor).toBe(await net(store.tenantId, ['111001', '111002'], '2026-11-30'));
    // The day an entry falls on moves it in or out of the opening
    const later = await get<AccountLedger>(
      store,
      '/v1/reports/account-ledger?code=1130&from=2026-11-01&to=2026-11-30',
    );
    expect(later.openingMinor).toBe(5_000_000 - 50_000);
    expect(later.lines).toHaveLength(1);
  });

  it('answers 404 for an account that does not exist and 400 for a bad code', async () => {
    const store = await openStore(app);
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/reports/account-ledger?code=9999&from=2026-10-30&to=2026-11-30',
      headers: bearer(store.accessToken),
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/reports/account-ledger?code=abc&from=2026-10-30&to=2026-11-30',
      headers: bearer(store.accessToken),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('shows no line of another store', async () => {
    const a = await openStore(app);
    await aMonth(a);
    const b = await openStore(app, '0922222222');
    const ledger = await get<AccountLedger>(
      b,
      '/v1/reports/account-ledger?code=1130&from=2026-01-01&to=2026-12-31',
    );
    expect(ledger).toMatchObject({ openingMinor: 0, closingMinor: 0, lines: [] });
  });
});

describe('tax report', () => {
  it('adds up the invoice and return lines by rate and agrees with the tax accounts', async () => {
    const store = await openStore(app);
    await aMonth(store);
    const report = await get<TaxReport>(store, `/v1/reports/tax?${Q}`);
    const rate = (bp: number) => report.rows.find((r) => r.rateBp === bp)!;
    expect(rate(500)).toMatchObject({
      kind: 'sales',
      salesTaxableMinor: 100_000,
      salesTaxMinor: 5_000,
      returnsTaxMinor: 5_000,
      netTaxMinor: 0,
    });
    expect(rate(1500)).toMatchObject({ kind: 'consumption', salesTaxMinor: 30_000, netTaxMinor: 30_000 });
    expect(rate(0)).toMatchObject({ name: 'بدون ضريبة', salesTaxMinor: 0 });
    // The report is the sum of the tax lines stored on the invoices, less the returns'
    const [sold] = await ownerDb()<{ tax: string }[]>`
      select coalesce(sum(il.tax_minor), 0)::text as tax from invoice_lines il where il.tenant_id = ${store.tenantId}`;
    const [back] = await ownerDb()<{ tax: string }[]>`
      select coalesce(sum(rl.tax_minor), 0)::text as tax from sale_return_lines rl where rl.tenant_id = ${store.tenantId}`;
    expect(report.totals.salesTaxMinor).toBe(Number(sold!.tax));
    expect(report.totals.returnsTaxMinor).toBe(Number(back!.tax));
    expect(report.totals.netTaxMinor).toBe(Number(sold!.tax) - Number(back!.tax));
    expect(report.totals.netTaxMinor).toBe(report.rows.reduce((s, r) => s + r.netTaxMinor, 0));
    // …and the tax accounts the entries credited
    expect(report.ledgerOutputTaxMinor).toBe(report.totals.netTaxMinor);
    expect(report.reconciled).toBe(true);
    expect(report.netPayableMinor).toBe(report.totals.netTaxMinor - report.inputTaxMinor);
    // A day with nothing in it
    const quiet = await get<TaxReport>(store, '/v1/reports/tax?from=2026-01-01&to=2026-01-31');
    expect(quiet.rows).toEqual([]);
    expect(quiet).toMatchObject({ reconciled: true, netPayableMinor: 0 });
  });

  it('counts only the branch asked for and refuses a branch the caller does not hold', async () => {
    const store = await openStore(app);
    const { branchId } = await aMonth(store);
    const one = await get<TaxReport>(store, `/v1/reports/tax?${Q}&branchId=${branchId}`);
    const all = await get<TaxReport>(store, `/v1/reports/tax?${Q}`);
    expect(one.totals).toEqual(all.totals);
    const other = await openStore(app, '0922222222');
    const foreign = await app.inject({
      method: 'GET',
      url: `/v1/reports/tax?${Q}&branchId=${branchId}`,
      headers: bearer(other.accessToken),
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('supplier ageing', () => {
  it('ages what is owed to each supplier from the oldest purchase, a payment settling the oldest first', async () => {
    const store = await openStore(app);
    const { supplier } = await aMonth(store);
    const report = await get<SupplierAgeingReport>(store, '/v1/reports/supplier-ageing?asOf=2026-11-30');
    // 10 × 200.00 bought on 15 September, 500.00 paid on 31 October
    expect(report.totals.balanceMinor).toBe(200_000 - 50_000);
    expect(report.items).toEqual([
      expect.objectContaining({
        supplierId: supplier.id,
        balanceMinor: 150_000,
        buckets: { d0_30: 0, d31_60: 0, d61_90: 150_000, d90_plus: 0 },
      }),
    ]);
    const today = await get<SupplierAgeingReport>(store, '/v1/reports/supplier-ageing?asOf=2026-09-20');
    expect(today.totals).toMatchObject({ balanceMinor: 200_000, d0_30: 200_000 });
    const none = await openStore(app, '0922222222');
    expect((await get<SupplierAgeingReport>(none, '/v1/reports/supplier-ageing')).items).toEqual([]);
  });
});

describe('permissions', () => {
  it('every statement needs accounting.view, and the suppliers’ ageing purchases.manage', async () => {
    const store = await openStore(app);
    await aMonth(store);
    const key = 'custom_sales';
    await ownerDb()`
      insert into roles (tenant_id, key, name, permissions, max_discount_bp, is_system)
      values (${store.tenantId}, ${key}, 'دور تجريبي', ${['report.view', 'customers.view']}, 0, false)`;
    const branchId = (
      await ownerDb()<{ id: string }[]>`select id from branches where tenant_id = ${store.tenantId} limit 1`
    )[0]!.id;
    const person = await staffUser(
      app,
      { tenantId: store.tenantId, userId: store.userId, accessToken: store.accessToken, branchId },
      key,
      '0933333333',
    );
    for (const url of [
      '/v1/reports/balance-sheet?asOf=2026-11-30',
      `/v1/reports/cash-flow?${Q}`,
      `/v1/reports/account-ledger?code=1130&${Q}`,
      `/v1/reports/tax?${Q}`,
      '/v1/reports/supplier-ageing',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(person.accessToken) });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('a person held to one branch cannot ask for another’s', async () => {
    const store = await openStore(app);
    await aMonth(store);
    const [extra] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, name, code) values (${store.tenantId}, 'فرع ثانٍ', '002') returning id`;
    const mine = (
      await ownerDb()<{ id: string }[]>`
        select id from branches where tenant_id = ${store.tenantId} and id <> ${extra!.id} limit 1`
    )[0]!.id;
    const key = 'custom_books';
    await ownerDb()`
      insert into roles (tenant_id, key, name, permissions, max_discount_bp, is_system)
      values (${store.tenantId}, ${key}, 'محاسب فرع', ${['accounting.view']}, 0, false)`;
    const person = await staffUser(
      app,
      { tenantId: store.tenantId, userId: store.userId, accessToken: store.accessToken, branchId: mine },
      key,
      '0944444444',
      { branchId: mine },
    );
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/balance-sheet?asOf=2026-11-30&branchId=${extra!.id}`,
      headers: bearer(person.accessToken),
    });
    expect(res.statusCode).toBe(403);
    const own = await app.inject({
      method: 'GET',
      url: `/v1/reports/balance-sheet?asOf=2026-11-30&branchId=${mine}`,
      headers: bearer(person.accessToken),
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json<BalanceSheet>().balanced).toBe(true);
  });
});
