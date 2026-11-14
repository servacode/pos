import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { stripBidiControls, type ExpenseRow, type PartyStatement, type ProfitLoss } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { ACCOUNTS, meWith, NOW, OWNER_KEYS, TODAY } from '../../test/reports';
import type { AccessKey } from '../reports/access';
import { profitLossCsv, statementCsv } from './csv';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

function signIn(
  path: string,
  routes: Record<string, MockReply | (() => MockReply)>,
  keys: readonly AccessKey[],
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

const statement = (overrides: Partial<PartyStatement> = {}): PartyStatement => ({
  type: 'customer',
  party: { id: 'c1', name: 'أبو خالد', phone: '0933111222' },
  from: '2026-01-01',
  to: TODAY,
  openingMinor: 100_000,
  lines: [
    {
      date: '2026-10-20',
      sourceType: 'sale',
      sourceId: 's1',
      number: 'INV-001-002-0000001',
      memo: 'فاتورة مبيعات',
      debitMinor: 300_000,
      creditMinor: 0,
      balanceMinor: 400_000,
    },
    {
      date: '2026-10-25',
      sourceType: 'receipt',
      sourceId: 'r1',
      number: 'RCV-001-002-0000001',
      memo: 'سند قبض',
      debitMinor: 0,
      creditMinor: 120_000,
      balanceMinor: 280_000,
    },
  ],
  totalDebitMinor: 300_000,
  totalCreditMinor: 120_000,
  closingMinor: 280_000,
  baseCurrency: 'SYP',
  ...overrides,
});

describe('«كشف حساب»', () => {
  it('shows the opening balance, each movement with its running balance, and the closing balance', async () => {
    signIn(
      '/customers/c1/statement',
      { [`GET /v1/customers/c1/statement?from=2026-01-01&to=${TODAY}`]: { status: 200, body: statement() } },
      ['customers.view'],
    );
    expect(await screen.findByRole('heading', { name: 'كشف حساب زبون', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'كشف حساب زبون' });
    const rows = within(table).getAllByRole('row').slice(1).map(text);
    expect(rows).toHaveLength(3); // two movements and the totals row
    expect(rows[0]).toContain('فاتورة آجل');
    expect(rows[1]).toContain('سند قبض');
    expect(screen.getByText('رصيد أول المدة')).toBeInTheDocument();
    expect(screen.getByText('رصيد آخر المدة')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'صدّر CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeEnabled();
  });

  it('is closed to someone without customers.view', async () => {
    signIn('/customers/c1/statement', {}, ['sale.create']);
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
  });

  it('writes the CSV with a byte-order mark, the opening line, every movement and the closing line', () => {
    const csv = statementCsv(statement());
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2 + 1 + 1 + 2 + 1);
    expect(csv).toContain('"رصيد أول المدة"');
    expect(lines.at(-1)).toContain('"المجموع"');
    expect(lines.at(-1)).toContain('"2800.00"');
  });
});

describe('«المصاريف»', () => {
  const row = (overrides: Partial<ExpenseRow> = {}): ExpenseRow => ({
    id: 'x1',
    number: 'EXP-2026-000001',
    date: '2026-10-20',
    branchId: 'branch-1',
    accountCode: '6101',
    accountName: 'الإيجار',
    currency: 'SYP',
    amountMinor: 250_000,
    baseAmountMinor: 250_000,
    rate: null,
    payFrom: 'safe',
    note: 'إيجار تشرين',
    entryNumber: '2026-0000007',
    voided: false,
    voidReason: null,
    ...overrides,
  });
  const list = (items: ExpenseRow[], totalMinor: number) => ({
    items,
    nextCursor: null,
    totalMinor,
    byAccount: [{ accountCode: '6101', accountName: 'الإيجار', totalMinor, count: items.length }],
    baseCurrency: 'SYP',
  });
  const PATH = `GET /v1/expenses?from=2026-10-01&to=${TODAY}&limit=200`;
  const KEYS = [...OWNER_KEYS, 'expenses.manage'] as AccessKey[];

  it('lists with totals, records a new expense once with its own id, and refreshes', async () => {
    let calls = 0;
    const { requestsTo } = signIn(
      '/expenses',
      {
        'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } },
        [PATH]: () => {
          calls += 1;
          return { status: 200, body: calls === 1 ? list([], 0) : list([row()], 250_000) };
        },
        'POST /v1/expenses': { status: 201, body: row() },
      },
      KEYS,
    );
    expect(await screen.findByText('لا مصاريف في هذه الفترة.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'مصروف جديد' }));
    const dialog = await screen.findByRole('dialog', { name: 'مصروف جديد' });
    fireEvent.change(within(dialog).getByLabelText('المبلغ'), { target: { value: '2500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'سجّل المصروف' }));
    expect(await screen.findByText('سُجّل المصروف.')).toBeInTheDocument();

    const posted = requestsTo('POST', '/v1/expenses')[0]!;
    expect(posted.body).toMatchObject({
      accountCode: '6101',
      amountMinor: 250_000,
      currency: 'SYP',
      payFrom: 'safe',
      date: TODAY,
    });
    expect(typeof (posted.body as { id: string }).id).toBe('string');
    const table = await screen.findByRole('table', { name: 'المصاريف' });
    await waitFor(() => expect(text(table)).toContain('EXP-2026-000001'));
    expect(text(table)).toContain('إيجار تشرين');
  });

  it('shows a cancelled expense struck out with its badge, and offers no cancel button on it', async () => {
    signIn(
      '/expenses',
      {
        'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } },
        [PATH]: { status: 200, body: list([row({ voided: true, voidReason: 'سُجّل مرتين' })], 0) },
      },
      KEYS,
    );
    expect(await screen.findByText('ملغى')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ألغِ' })).not.toBeInTheDocument();
  });

  it('is closed to someone without expenses.manage', async () => {
    signIn('/expenses', {}, OWNER_KEYS);
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
  });
});

describe('«قائمة الدخل»', () => {
  const pnl: ProfitLoss = {
    from: '2026-10-01',
    to: TODAY,
    branchId: null,
    baseCurrency: 'SYP',
    revenue: {
      accounts: [{ accountCode: '4100', accountName: 'المبيعات', amountMinor: 1_000_000 }],
      totalMinor: 1_000_000,
    },
    costOfSales: {
      accounts: [{ accountCode: '5100', accountName: 'كلفة المبيعات', amountMinor: 600_000 }],
      totalMinor: 600_000,
    },
    grossProfitMinor: 400_000,
    otherIncome: { accounts: [], totalMinor: 0 },
    expenses: {
      groups: [
        {
          code: '61',
          name: 'المصروفات التشغيلية والإدارية',
          accounts: [{ accountCode: '6101', accountName: 'الإيجار', amountMinor: 150_000 }],
          totalMinor: 150_000,
        },
      ],
      totalMinor: 150_000,
    },
    netProfitMinor: 250_000,
  };

  it('shows revenue, cost, gross profit, expenses by group and the net, and prints and exports', async () => {
    signIn(
      '/accounting/profit-loss',
      { [`GET /v1/reports/profit-loss?from=2026-10-01&to=${TODAY}`]: { status: 200, body: pnl } },
      OWNER_KEYS,
    );
    expect(await screen.findByRole('heading', { name: 'قائمة الدخل', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('مجمل الربح', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('صافي الربح', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('المصروفات التشغيلية والإدارية')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeEnabled();
  });

  it('exports every section and the net as CSV', () => {
    const csv = profitLossCsv(pnl);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"صافي الربح","","2500.00"');
    expect(csv).toContain('"مجمل الربح","","4000.00"');
  });
});
