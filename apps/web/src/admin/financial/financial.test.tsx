import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  stripBidiControls,
  type AccountLedger,
  type BalanceSheet,
  type CashFlow,
  type SupplierAgeingReport,
  type TaxReport,
} from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { ACCOUNTS, MANAGER_KEYS, meWith, NOW, OWNER_KEYS, TODAY } from '../../test/reports';
import { accountLedgerTable, balanceSheetTable, cashFlowTable, supplierAgeingTable, taxTable } from './csv';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');
const PERIOD = `from=2026-10-01&to=${TODAY}`;

function signIn(
  path: string,
  routes: Record<string, MockReply | (() => MockReply)> = {},
  keys: readonly Parameters<typeof meWith>[0][number][] = OWNER_KEYS,
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys) },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const sheet = (overrides: Partial<BalanceSheet> = {}): BalanceSheet => ({
  asOf: TODAY,
  compareTo: null,
  branchId: null,
  baseCurrency: 'SYP',
  yearStart: '2026-01-01',
  assets: {
    groups: [
      {
        code: '11',
        name: 'الأصول المتداولة',
        accounts: [
          { accountCode: '1130', accountName: 'البنك', amountMinor: 5_000_000, previousMinor: null },
          { accountCode: '1300', accountName: 'المخزون', amountMinor: 200_000, previousMinor: null },
        ],
        totalMinor: 5_200_000,
        previousTotalMinor: null,
      },
    ],
    totalMinor: 5_200_000,
    previousTotalMinor: null,
  },
  liabilities: {
    groups: [
      {
        code: '21',
        name: 'الخصوم المتداولة',
        accounts: [
          {
            accountCode: '2100',
            accountName: 'الموردون (الدائنون)',
            amountMinor: 200_000,
            previousMinor: null,
          },
        ],
        totalMinor: 200_000,
        previousTotalMinor: null,
      },
    ],
    totalMinor: 200_000,
    previousTotalMinor: null,
  },
  equity: {
    groups: [
      {
        code: '31',
        name: 'رأس المال والاحتياطيات وجاري المالك',
        accounts: [
          { accountCode: '3100', accountName: 'رأس المال', amountMinor: 4_800_000, previousMinor: null },
        ],
        totalMinor: 4_800_000,
        previousTotalMinor: null,
      },
      {
        code: 'P',
        name: 'ربح الفترة غير المرحّل',
        accounts: [
          {
            accountCode: '',
            accountName: 'ربح السنة الحالية حتى التاريخ',
            amountMinor: 200_000,
            previousMinor: null,
          },
        ],
        totalMinor: 200_000,
        previousTotalMinor: null,
      },
    ],
    totalMinor: 5_000_000,
    previousTotalMinor: null,
  },
  liabilitiesAndEquityMinor: 5_200_000,
  previousLiabilitiesAndEquityMinor: null,
  differenceMinor: 0,
  balanced: true,
  ...overrides,
});

describe('«الميزانية العمومية»', () => {
  const path = `GET /v1/reports/balance-sheet?asOf=${TODAY}`;

  it('shows assets, liabilities and equity with the profit inside, balanced, and each account opens its ledger', async () => {
    signIn('/accounting/reports/balance-sheet', { [path]: { status: 200, body: sheet() } });
    expect(await screen.findByRole('heading', { name: 'الميزانية العمومية', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('الأصول', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('الخصوم', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('حقوق الملكية', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('ربح السنة الحالية حتى التاريخ')).toBeInTheDocument();
    expect(screen.getByText('الأصول = الخصوم + الملكية')).toBeInTheDocument();
    const bank = screen.getByRole('link', { name: /البنك/ });
    expect(bank).toHaveAttribute('href', `/accounting/reports/ledger?code=1130&from=2026-01-01&to=${TODAY}`);
    // The profit is a computed line: no ledger to open
    expect(screen.queryByRole('link', { name: /ربح السنة الحالية/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'صدّر إلى إكسل' })).toBeEnabled();
  });

  it('asks for a second date and shows it beside the first', async () => {
    const compared = sheet({
      compareTo: '2026-09-30',
      assets: { ...sheet().assets, previousTotalMinor: 1_000_000 },
      previousLiabilitiesAndEquityMinor: 1_000_000,
    });
    const { requests } = signIn('/accounting/reports/balance-sheet', {
      [path]: { status: 200, body: sheet() },
      [`${path}&compareTo=2026-09-30`]: { status: 200, body: compared },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'قارن بتاريخ سابق' }));
    await waitFor(() => expect(requests.some((r) => r.path.includes('compareTo=2026-09-30'))).toBe(true));
    expect(await screen.findByRole('button', { name: 'بدون مقارنة' })).toBeInTheDocument();
    expect(screen.getByLabelText('قارن مع')).toBeInTheDocument();
  });

  it('says so when the books do not balance', async () => {
    signIn('/accounting/reports/balance-sheet', {
      [path]: { status: 200, body: sheet({ balanced: false, differenceMinor: 500 }) },
    });
    expect(await screen.findByText('الميزانية غير متوازنة')).toBeInTheDocument();
  });

  it('is closed to a manager without accounting.view', async () => {
    signIn('/accounting/reports/balance-sheet', {}, MANAGER_KEYS);
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
  });

  it('exports each section and the total as CSV rows', () => {
    const table = balanceSheetTable(sheet());
    expect(table.headers).toEqual(['البند', 'رمز الحساب', `في ${TODAY}`]);
    expect(table.rows[0]).toEqual(['الأصول', '', '52000.00']);
    expect(table.rows).toContainEqual(['    البنك', '1130', '50000.00']);
    expect(table.rows.at(-1)).toEqual(['الخصوم وحقوق الملكية', '', '52000.00']);
    const withPrev = balanceSheetTable(
      sheet({ compareTo: '2026-09-30', previousLiabilitiesAndEquityMinor: 100 }),
    );
    expect(withPrev.headers).toHaveLength(4);
    expect(withPrev.rows.every((r) => r.length === 4)).toBe(true);
  });
});

const flow = (): CashFlow => ({
  from: '2026-10-01',
  to: TODAY,
  branchId: null,
  baseCurrency: 'SYP',
  accounts: [
    {
      accountCode: '111001',
      accountName: 'الصندوق — ليرة سورية',
      openingMinor: 0,
      inMinor: 300_000,
      outMinor: 100_000,
      closingMinor: 200_000,
    },
    {
      accountCode: '1130',
      accountName: 'البنك',
      openingMinor: 1_000_000,
      inMinor: 0,
      outMinor: 50_000,
      closingMinor: 950_000,
    },
  ],
  categories: [
    { category: 'sales', inMinor: 300_000, outMinor: 0, netMinor: 300_000 },
    { category: 'supplier_payments', inMinor: 0, outMinor: 50_000, netMinor: -50_000 },
    { category: 'transfer', inMinor: 100_000, outMinor: 100_000, netMinor: 0 },
  ],
  totals: { openingMinor: 1_000_000, inMinor: 400_000, outMinor: 150_000, closingMinor: 1_150_000 },
  balanced: true,
});

describe('«التدفق النقدي»', () => {
  it('shows receipts and payments by kind and each cash account from opening to closing', async () => {
    signIn('/accounting/reports/cash-flow', {
      [`GET /v1/reports/cash-flow?${PERIOD}`]: { status: 200, body: flow() },
    });
    expect(await screen.findByRole('heading', { name: 'التدفق النقدي', level: 1 })).toBeInTheDocument();
    const kinds = await screen.findByRole('table', { name: 'القبض والدفع حسب النوع' });
    expect(text(kinds)).toContain('المبيعات');
    expect(text(kinds)).toContain('دفعات الموردين');
    expect(text(kinds)).toContain('تحويل بين الصندوق والخزنة والبنك');
    const accounts = screen.getByRole('table', { name: 'الصندوق والخزنة والبنك والمحافظ' });
    expect(text(accounts)).toContain('الصندوق — ليرة سورية');
    expect(within(accounts).getByRole('link', { name: /البنك/ })).toHaveAttribute(
      'href',
      `/accounting/reports/ledger?code=1130&from=2026-10-01&to=${TODAY}`,
    );
    expect(screen.getByText('الرصيد الأخير يطابق الحركة')).toBeInTheDocument();
  });

  it('is empty for a period with no cash movement and exports rows with totals', () => {
    const table = cashFlowTable(flow());
    expect(table.rows).toContainEqual(['المبيعات', '', '', '3000.00', '0.00', '']);
    expect(table.rows).toContainEqual(['المجموع', '', '10000.00', '4000.00', '1500.00', '11500.00']);
  });
});

const ledger = (overrides: Partial<AccountLedger> = {}): AccountLedger => ({
  account: { code: '1130', name: 'البنك', type: 'asset', isGroup: false },
  from: '2026-10-01',
  to: TODAY,
  branchId: null,
  baseCurrency: 'SYP',
  openingMinor: 500_000,
  lines: [
    {
      date: '2026-10-20',
      entryId: 'e1',
      entryNumber: '2026-0000007',
      accountCode: '1130',
      accountName: 'البنك',
      sourceType: 'supplier_payment',
      sourceId: 'p1',
      sourceNumber: 'PAY-2026-000001',
      memo: 'دفعة للفرات',
      debitMinor: 0,
      creditMinor: 50_000,
      balanceMinor: 450_000,
    },
  ],
  totalDebitMinor: 0,
  totalCreditMinor: 50_000,
  closingMinor: 450_000,
  truncated: false,
  ...overrides,
});

describe('«دفتر الأستاذ»', () => {
  it('opens on the account named in the address with its running balance', async () => {
    const { requests } = signIn(`/accounting/reports/ledger?code=1130&from=2026-10-01&to=${TODAY}`, {
      'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } },
      [`GET /v1/reports/account-ledger?code=1130&${PERIOD}`]: { status: 200, body: ledger() },
    });
    expect(await screen.findByRole('heading', { name: 'دفتر الأستاذ', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'حركة الحساب' });
    expect(text(table)).toContain('2026-0000007');
    expect(text(table)).toContain('دفعة للفرات');
    expect(requests.some((r) => r.path.includes('account-ledger?code=1130'))).toBe(true);
  });

  it('warns when the range holds more movements than it shows', async () => {
    signIn(`/accounting/reports/ledger?code=1130&from=2026-10-01&to=${TODAY}`, {
      'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } },
      [`GET /v1/reports/account-ledger?code=1130&${PERIOD}`]: {
        status: 200,
        body: ledger({ truncated: true }),
      },
    });
    expect(await screen.findByText(/اختر فترة أقصر/)).toBeInTheDocument();
  });

  it('exports the opening line, every movement and the totals', () => {
    const table = accountLedgerTable(ledger());
    expect(table.rows[0]).toEqual(['2026-10-01', '', '', '', 'رصيد أول المدة', '', '', '5000.00']);
    expect(table.rows.at(-1)).toEqual([TODAY, '', '', '', 'المجموع', '0.00', '500.00', '4500.00']);
  });
});

const tax = (overrides: Partial<TaxReport> = {}): TaxReport => ({
  from: '2026-10-01',
  to: TODAY,
  branchId: null,
  baseCurrency: 'SYP',
  rows: [
    {
      rateId: 'r5',
      name: 'ضريبة 5%',
      kind: 'sales',
      rateBp: 500,
      salesTaxableMinor: 1_000_000,
      salesTaxMinor: 50_000,
      returnsTaxableMinor: 100_000,
      returnsTaxMinor: 5_000,
      netTaxableMinor: 900_000,
      netTaxMinor: 45_000,
    },
    {
      rateId: null,
      name: 'بدون ضريبة',
      kind: null,
      rateBp: 0,
      salesTaxableMinor: 200_000,
      salesTaxMinor: 0,
      returnsTaxableMinor: 0,
      returnsTaxMinor: 0,
      netTaxableMinor: 200_000,
      netTaxMinor: 0,
    },
  ],
  totals: {
    salesTaxableMinor: 1_200_000,
    salesTaxMinor: 50_000,
    returnsTaxableMinor: 100_000,
    returnsTaxMinor: 5_000,
    netTaxableMinor: 1_100_000,
    netTaxMinor: 45_000,
  },
  inputTaxMinor: 10_000,
  netPayableMinor: 35_000,
  ledgerOutputTaxMinor: 45_000,
  reconciled: true,
  ...overrides,
});

describe('«تقرير الضريبة»', () => {
  const path = `GET /v1/reports/tax?${PERIOD}`;

  it('lists each rate with sales, returns and the net, and agrees with the tax accounts', async () => {
    signIn('/accounting/reports/tax', { [path]: { status: 200, body: tax() } });
    expect(await screen.findByRole('heading', { name: 'تقرير الضريبة', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'الضريبة حسب النسبة' });
    expect(text(table)).toContain('ضريبة 5%');
    expect(text(table)).toContain('ضريبة مبيعات');
    expect(text(table)).toContain('بدون ضريبة');
    expect(screen.getByText('يطابق حسابات الضريبة')).toBeInTheDocument();
    expect(screen.getByText('المستحق للدولة')).toBeInTheDocument();
  });

  it('flags a report that does not agree with the tax accounts', async () => {
    signIn('/accounting/reports/tax', { [path]: { status: 200, body: tax({ reconciled: false }) } });
    expect(await screen.findByText('لا يطابق حسابات الضريبة')).toBeInTheDocument();
  });

  it('exports the rates, the totals, the input tax and the net payable', () => {
    const table = taxTable(tax());
    expect(table.rows[0]).toEqual([
      'ضريبة 5%',
      5,
      '10000.00',
      '500.00',
      '1000.00',
      '50.00',
      '9000.00',
      '450.00',
    ]);
    expect(table.rows.at(-1)).toEqual(['الصافي المستحق للدولة', '', '', '', '', '', '', '350.00']);
  });
});

const ageing = (): SupplierAgeingReport => ({
  asOf: TODAY,
  baseCurrency: 'SYP',
  items: [
    {
      supplierId: 'sup1',
      name: 'مؤسسة الفرات',
      phone: null,
      balanceMinor: 150_000,
      buckets: { d0_30: 0, d31_60: 50_000, d61_90: 100_000, d90_plus: 0 },
    },
  ],
  totals: { d0_30: 0, d31_60: 50_000, d61_90: 100_000, d90_plus: 0, balanceMinor: 150_000 },
});

describe('«ذمم الموردين»', () => {
  it('shows what the store owes each supplier by the age of the debt, with a link to his statement', async () => {
    signIn('/accounting/reports/payables', {
      [`GET /v1/reports/supplier-ageing?asOf=${TODAY}`]: { status: 200, body: ageing() },
    });
    const table = await screen.findByRole('table', { name: 'أعمار ديون الموردين' });
    expect(within(table).getByRole('link', { name: 'مؤسسة الفرات' })).toHaveAttribute(
      'href',
      '/suppliers/sup1/statement',
    );
    expect(text(table)).toContain('61-90 يوماً');
    expect(supplierAgeingTable(ageing()).rows.at(-1)).toEqual([
      'الإجمالي',
      '',
      '0.00',
      '500.00',
      '1000.00',
      '0.00',
      '1500.00',
    ]);
  });

  it('shows the server’s refusal when the person may not read the suppliers', async () => {
    signIn('/accounting/reports/payables', {
      [`GET /v1/reports/supplier-ageing?asOf=${TODAY}`]: {
        status: 403,
        body: { error: { code: 'forbidden', message: 'لا تملك صلاحية هذا الإجراء.' } },
      },
    });
    expect(await screen.findByText('لا تملك صلاحية هذا الإجراء.')).toBeInTheDocument();
  });
});

describe('the accounting addresses', () => {
  it('lists the statements as tabs of the section and sends an unknown kind to the balance sheet', async () => {
    signIn('/accounting/reports/nothing', {
      [`GET /v1/reports/balance-sheet?asOf=${TODAY}`]: { status: 200, body: sheet() },
    });
    expect(await screen.findByRole('heading', { name: 'الميزانية العمومية', level: 1 })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'أقسام المحاسبة' });
    expect(within(tabs).getByRole('link', { name: 'الميزانية' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends an unknown accounting address to the chart', async () => {
    signIn('/accounting/whatever', { 'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } } });
    expect(await screen.findByRole('heading', { name: 'دليل الحسابات', level: 1 })).toBeInTheDocument();
  });
});
