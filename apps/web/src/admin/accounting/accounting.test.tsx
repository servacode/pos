import { fireEvent, screen, within } from '@testing-library/react';
import { stripBidiControls } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import {
  ACCOUNTS,
  journalEntry,
  MANAGER_KEYS,
  meWith,
  NOW,
  OWNER_KEYS,
  TODAY,
  trialBalance,
} from '../../test/reports';
import type { AccessKey } from '../reports/access';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');
const PERIOD = `from=2026-10-01&to=${TODAY}`;

function signIn(
  path: string,
  routes: Record<string, MockReply | (() => MockReply)> = {},
  keys: readonly AccessKey[] = OWNER_KEYS,
  accountingMode?: boolean,
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys, { accountingMode }) },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

const menuLinks = async () =>
  within(await screen.findByRole('navigation', { name: 'القائمة الرئيسية' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('accounting: who sees it', () => {
  it('is in the menu for accounting.view in accounting mode, and opens on the chart', async () => {
    signIn('/accounting', { 'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } } });

    expect(await screen.findByRole('heading', { name: 'دليل الحسابات', level: 1 })).toBeInTheDocument();
    expect(await menuLinks()).toContain('المحاسبة');
    const tabs = screen.getByRole('navigation', { name: 'أقسام المحاسبة' });
    expect(within(tabs).getByRole('link', { name: 'دليل الحسابات' })).toHaveAttribute('aria-current', 'page');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['دليل الحسابات', 'القيود', 'ميزان المراجعة']);
  });

  it('is hidden from a manager without accounting.view, and closed if opened by address', async () => {
    signIn('/accounting/journal', {}, MANAGER_KEYS);

    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
    expect(await menuLinks()).not.toContain('المحاسبة');
  });

  it('is hidden when the store turned accounting mode off', async () => {
    signIn('/accounting/trial-balance', {}, OWNER_KEYS, false);

    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
    expect(await menuLinks()).not.toContain('المحاسبة');
  });
});

describe('«دليل الحسابات»', () => {
  it('shows the chart as a tree that opens, closes and searches', async () => {
    signIn('/accounting/accounts', { 'GET /v1/accounts': { status: 200, body: { items: ACCOUNTS } } });

    const tree = await screen.findByRole('table', { name: 'شجرة الحسابات' });
    const rows = () => within(tree).getAllByRole('row').slice(1).map(text);
    expect(rows()).toEqual([
      '1الأصولمن النظامالأصولتجميعيكل العملات',
      '1110الصندوق (أدراج الكاشير)من النظامالأصولمدينليرة',
      '1111الصندوق بالدولارمن النظامالأصولمديندولار',
      '4الإيراداتمن النظامالإيراداتتجميعيكل العملات',
      '4100المبيعاتمن النظامالإيراداتدائنكل العملات',
    ]);

    const assets = within(tree).getByRole('button', { name: '1 الأصول' });
    expect(assets).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(assets);
    expect(assets).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'اطوِ الكل' }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'وسّع الكل' }));
    expect(rows()).toHaveLength(5);

    // The search folds the hamza seats, and keeps each match's parents.
    const search = screen.getByRole('searchbox', { name: 'ابحث في الحسابات' });
    fireEvent.change(search, { target: { value: 'الاصول' } });
    expect(rows()).toEqual(['1الأصولمن النظامالأصولتجميعيكل العملات']);
    fireEvent.change(search, { target: { value: 'مبيعات' } });
    expect(rows()).toEqual([
      '4الإيراداتمن النظامالإيراداتتجميعيكل العملات',
      '4100المبيعاتمن النظامالإيراداتدائنكل العملات',
    ]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'ابحث في الحسابات' }), {
      target: { value: '111' },
    });
    expect(rows()).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox', { name: 'ابحث في الحسابات' }), {
      target: { value: 'لا شيء' },
    });
    expect(screen.getByText('لا حساب بهذا الاسم أو الرمز.')).toBeInTheDocument();
  });

  it('shows a failed load with a retry', async () => {
    let calls = 0;
    signIn('/accounting/accounts', {
      'GET /v1/accounts': () => {
        calls += 1;
        return calls === 1
          ? apiError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.')
          : { status: 200, body: { items: [] } };
      },
    });

    expect(await screen.findByText('الخادم مشغول حالياً. حاول بعد قليل.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('لا حسابات في الدليل بعد.')).toBeInTheDocument();
  });
});

describe('«القيود»', () => {
  const second = journalEntry({
    id: 'je-2',
    number: 'JRN-2026-0000002',
    source: { type: 'shift_close', id: 'shift-1', number: 'SFT-001-002-0000231' },
    memo: 'عجز الصندوق',
    lines: [
      {
        accountCode: '6300',
        accountName: 'فروقات الصندوق',
        debitMinor: 150_000,
        creditMinor: 0,
        currency: 'SYP',
        amountMinor: 150_000,
        rate: null,
      },
      {
        accountCode: '1110',
        accountName: 'الصندوق (أدراج الكاشير)',
        debitMinor: 0,
        creditMinor: 150_000,
        currency: 'SYP',
        amountMinor: 150_000,
        rate: null,
      },
    ],
    totalMinor: 150_000,
  });

  it('lists the month’s entries and opens one in a drawer with its lines and document', async () => {
    signIn('/accounting/journal', {
      [`GET /v1/journal?${PERIOD}`]: { status: 200, body: { items: [journalEntry()], nextCursor: 'c-2' } },
      [`GET /v1/journal?${PERIOD}&cursor=c-2`]: { status: 200, body: { items: [second], nextCursor: null } },
    });

    const table = await screen.findByRole('table', {
      name: 'القيود من 1 تشرين الأول 2026 إلى 31 تشرين الأول 2026',
    });
    await within(table).findByText('JRN-2026-0000001');
    expect(within(table).getAllByRole('row').map(text)).toEqual([
      'رقم القيدالتاريخالمستندالبيانالمبلغ',
      'JRN-2026-000000131 تشرين الأول 2026فاتورة بيع INV-001-002-0000001فاتورة بيع1,200 ل.س',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'اعرض المزيد' }));
    expect(await within(table).findByText('JRN-2026-0000002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'اعرض المزيد' })).not.toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'إغلاق وردية SFT-001-002-0000231' })).toHaveAttribute(
      'href',
      '/shifts/shift-1',
    );

    fireEvent.click(within(table).getByRole('button', { name: 'JRN-2026-0000001' }));
    const drawer = await screen.findByRole('dialog', { name: 'القيد JRN-2026-0000001' });
    const lines = within(drawer).getAllByRole('row').map(text);
    expect(lines).toEqual([
      'الحسابمديندائن',
      '1110 الصندوق (أدراج الكاشير)30 ل.س',
      '1111 الصندوق بالدولار9.00 $ بسعر 1301,170 ل.س',
      '4100 المبيعات1,200 ل.س',
      'المجموع1,200 ل.س1,200 ل.س',
    ]);
    expect(within(drawer).getByText('متوازن')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('فاتورة بيع');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('flags an entry whose sides differ', async () => {
    const broken = journalEntry({
      lines: journalEntry().lines.map((line) =>
        line.accountCode === '4100' ? { ...line, creditMinor: 100_000 } : line,
      ),
    });
    signIn('/accounting/journal', {
      [`GET /v1/journal?${PERIOD}`]: { status: 200, body: { items: [broken], nextCursor: null } },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'JRN-2026-0000001' }));
    const drawer = await screen.findByRole('dialog');
    expect(
      within(drawer).getByText('مدين هذا القيد لا يساوي دائنه. أرسله للدعم مع رقمه.'),
    ).toBeInTheDocument();
  });

  it('asks again for the period and branch picked, and says when there is nothing', async () => {
    const { requestsTo } = signIn('/accounting/journal', {
      [`GET /v1/journal?${PERIOD}`]: { status: 200, body: { items: [], nextCursor: null } },
      [`GET /v1/journal?from=2026-10-15&to=${TODAY}&branchId=branch-1`]: {
        status: 200,
        body: { items: [journalEntry()], nextCursor: null },
      },
      [`GET /v1/journal?from=2026-10-15&to=${TODAY}`]: { status: 200, body: { items: [], nextCursor: null } },
    });

    expect(await screen.findByText('لا قيود في هذه الفترة.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: 'branch-1' } });
    expect(await screen.findByText('JRN-2026-0000001')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/journal?from=2026-10-15&to=${TODAY}&branchId=branch-1`)).toHaveLength(1);
  });

  it('keeps the loaded entries when the next page fails', async () => {
    signIn('/accounting/journal', {
      [`GET /v1/journal?${PERIOD}`]: { status: 200, body: { items: [journalEntry()], nextCursor: 'c-2' } },
      [`GET /v1/journal?${PERIOD}&cursor=c-2`]: apiError(
        503,
        'unavailable',
        'الخادم مشغول حالياً. حاول بعد قليل.',
      ),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'اعرض المزيد' }));
    expect(await screen.findByText('الخادم مشغول حالياً. حاول بعد قليل.')).toBeInTheDocument();
    expect(screen.getByText('JRN-2026-0000001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اعرض المزيد' })).toBeInTheDocument();
  });
});

describe('«ميزان المراجعة»', () => {
  it('shows each account with «عليه» or «له», the totals and the «متوازن» badge', async () => {
    signIn('/accounting/trial-balance', {
      [`GET /v1/reports/trial-balance?${PERIOD}`]: { status: 200, body: trialBalance() },
    });

    const table = await screen.findByRole('table', { name: 'ميزان المراجعة' });
    await within(table).findByText('المبيعات');
    expect(within(table).getAllByRole('row').map(text)).toEqual([
      'الحسابرصيد أول المدةمديندائنرصيد آخر المدة',
      '1110 الصندوق (أدراج الكاشير)0 ل.س1,200 ل.س0 ل.سعليه 1,200 ل.س',
      '4100 المبيعات0 ل.س0 ل.س1,200 ل.سله 1,200 ل.س',
      'المجموع1,200 ل.س1,200 ل.س',
    ]);
    expect(within(table).queryByText(/−/)).not.toBeInTheDocument();
    expect(screen.getByText('متوازن')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('flags a trial balance that does not balance', async () => {
    signIn('/accounting/trial-balance', {
      [`GET /v1/reports/trial-balance?${PERIOD}`]: {
        status: 200,
        body: trialBalance({ totals: { debitMinor: 120_000, creditMinor: 119_000 }, balanced: false }),
      },
    });

    expect(await screen.findByText('غير متوازن')).toBeInTheDocument();
    expect(screen.queryByText('متوازن')).not.toBeInTheDocument();
  });

  it('exports the trial balance to CSV', async () => {
    const created: Blob[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          created.push(blob);
          return 'blob:trial-balance';
        }),
        revokeObjectURL: vi.fn(),
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    signIn('/accounting/trial-balance', {
      [`GET /v1/reports/trial-balance?${PERIOD}`]: { status: 200, body: trialBalance() },
    });

    await screen.findByText('متوازن');
    fireEvent.click(screen.getByRole('button', { name: 'صدّر CSV' }));

    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(`ميزان-المراجعة-2026-10-01-${TODAY}.csv`);
    expect(link.href).toBe('blob:trial-balance');
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    expect(csv.split('\r\n')[1]).toBe(
      '"1110","الصندوق (أدراج الكاشير)","0.00","0.00","1200.00","0.00","1200.00","0.00"',
    );
    click.mockRestore();
  });

  it('says when no account moved, with export off', async () => {
    signIn('/accounting/trial-balance', {
      [`GET /v1/reports/trial-balance?${PERIOD}`]: {
        status: 200,
        body: trialBalance({ rows: [], totals: { debitMinor: 0, creditMinor: 0 } }),
      },
    });

    expect(await screen.findByText('لا حركة على الحسابات في هذه الفترة.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'صدّر CSV' })).toBeDisabled();
  });
});
