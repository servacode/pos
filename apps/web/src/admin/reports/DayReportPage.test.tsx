import { fireEvent, screen, within } from '@testing-library/react';
import { stripBidiControls } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { dayReport, MANAGER_KEYS, meWith, NOW, OWNER_KEYS, TODAY } from '../../test/reports';
import type { AccessKey } from './access';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

function openDay(
  reply: MockReply | ((path: string) => MockReply) = { status: 200, body: dayReport() },
  keys: readonly AccessKey[] = OWNER_KEYS,
  branchId?: string,
) {
  const day = (path: string) => (typeof reply === 'function' ? reply(path) : reply);
  const routes: Record<string, MockReply | (() => MockReply)> = {
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys, { branchId }) },
  };
  for (const query of [
    `date=${TODAY}`,
    `branchId=branch-1&date=${TODAY}`,
    `branchId=branch-2&date=${TODAY}`,
    'date=2026-10-30',
  ]) {
    const path = `/v1/reports/day?${query}`;
    routes[`GET ${path}`] = () => day(path);
  }
  const mock = mockFetch(routes);
  return { ...mock, ...renderApp('/sales/today') };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('«مبيعات اليوم»', () => {
  it('averages the invoice net of the returns, and says the payments table is before them', async () => {
    openDay({
      status: 200,
      body: dayReport({
        returns: { count: 1, totalMinor: 100_000, taxMinor: 0, byMethod: [] },
        netSalesMinor: 1_184_500,
      }),
    });
    const average = (await screen.findByText('متوسط الفاتورة')).closest('div');
    // (12,845 - 1,000) / 3 = 3,948, the same average the home page shows
    expect(text(average as HTMLElement)).toContain('3,948 ل.س');
    const net = screen.getAllByText('صافي المبيعات بعد المرتجعات')[0]?.closest('div');
    expect(text(net as HTMLElement)).toContain('قبل المرتجعات 12,845 ل.س');
    // The payments add up before the returns; the walk to the net names what was really taken after them
    const methods = screen.getByRole('region', { name: 'حسب طريقة الدفع' });
    expect(text(methods)).toContain('مجموع الدفعات12,845 ل.س');
    const walk = screen.getByRole('region', { name: 'من المبيعات إلى الصافي' });
    expect(text(walk)).toContain('المرتجعات (1)−1,000 ل.س');
    expect(text(walk)).toContain('المقبوض فعلاً بعد المرتجعات11,845 ل.س');
  });

  it('names the returns tile «المرتجعات» (the discount is under it), not both', async () => {
    openDay({
      status: 200,
      body: dayReport({ returns: { count: 1, totalMinor: 100_000, taxMinor: 0, byMethod: [] } }),
    });
    expect(await screen.findByText('المرتجعات')).toBeInTheDocument();
    expect(screen.queryByText('المرتجعات والحسم')).not.toBeInTheDocument();
  });

  it('explains a few liras between the payments and the invoices', async () => {
    openDay({
      status: 200,
      body: dayReport({
        cashRoundingMinor: 200,
        tipsMinor: 0,
        byMethod: [
          { method: 'cash', currency: 'SYP', amountMinor: 1_284_700, baseAmountMinor: 1_284_700, count: 3 },
        ],
      }),
    });
    const methods = await screen.findByRole('region', { name: 'حسب طريقة الدفع' });
    expect(text(methods)).toContain('مجموع الدفعات يختلف عن مجموع الفواتير بـ 2 ل.س: تقريب النقد 2 ل.س');
  });

  it('heads the sellers table «البائع» with a real total row', async () => {
    openDay({
      status: 200,
      body: dayReport({
        bySalesperson: [{ userId: 'u-9', fullName: 'مهنّد', invoiceCount: 3, totalMinor: 1_284_500 }],
      }),
    });
    const sellers = text(await screen.findByRole('region', { name: 'حسب البائع' }));
    expect(sellers).toContain('مهنّد12,845 ل.س3 فاتورة');
    expect(sellers).toContain('3 فاتورة · 12,845 ل.س');
  });

  it("shows today's totals for every branch, by payment method and by cashier", async () => {
    const { requestsTo } = openDay();

    expect(await screen.findByRole('heading', { name: 'مبيعات اليوم', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('المبيعات قبل الحسم والضريبة')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/reports/day?date=${TODAY}`)).toHaveLength(1);
    expect(screen.getByText('كل الفروع · 31 تشرين الأول 2026')).toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'من المبيعات إلى الصافي' });
    expect(text(breakdown)).toContain('المبيعات قبل الحسم والضريبة13,000 ل.س');
    expect(text(breakdown)).toContain('الحسم−500 ل.س');
    expect(text(breakdown)).toContain('الضريبة345 ل.س');
    expect(text(breakdown)).toContain('مجموع الفواتير12,845 ل.س');
    expect(text(breakdown)).toContain('تقريب النقد−5 ل.س');
    expect(text(breakdown)).toContain('الإكرامية20 ل.س');

    const methods = within(screen.getByRole('region', { name: 'حسب طريقة الدفع' })).getAllByRole('listitem');
    expect(methods.map(text)).toEqual([
      'نقداً · ليرة3 دفعة9,145 ل.س71%',
      'نقداً · دولار1 دفعة20.00 $20%',
      'شام كاش1 دفعة1,100 ل.س8.6%',
    ]);
    expect(text(screen.getByRole('region', { name: 'حسب طريقة الدفع' }))).toContain(
      'مجموع الدفعات12,845 ل.س',
    );

    const cashiers = text(screen.getByRole('region', { name: 'حسب الكاشير' }));
    expect(cashiers).toContain('سامر9,000 ل.س2 فاتورة');
    expect(cashiers).toContain('لينا3,845 ل.س1 فاتورة');
    expect(cashiers).toContain('3 فاتورة · 12,845 ل.س');
    expect(screen.getByRole('link', { name: 'مبيعات اليوم' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('asks again for the branch and the day picked', async () => {
    const { requestsTo } = openDay();
    await screen.findByText('المبيعات قبل الحسم والضريبة');

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: 'branch-2' } });
    expect(await screen.findByText('دوار النعيم · 31 تشرين الأول 2026')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/reports/day?branchId=branch-2&date=${TODAY}`)).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2026-10-30' } });
    expect(await screen.findByRole('heading', { name: 'مبيعات يوم', level: 1 })).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/reports/day?date=2026-10-30')).toHaveLength(1);
    // The field is day-first text; the calendar behind its button carries the limit
    expect(document.querySelector('input[type="date"]')).toHaveAttribute('max', TODAY);
  });

  it('opens on the branch of a manager tied to one, with no «كل الفروع»', async () => {
    const { requestsTo } = openDay(undefined, MANAGER_KEYS, 'branch-1');
    await screen.findByText('المبيعات قبل الحسم والضريبة');

    expect(requestsTo('GET', `/v1/reports/day?branchId=branch-1&date=${TODAY}`)).toHaveLength(1);
    const options = within(screen.getByLabelText('الفرع')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['الفرع الرئيسي']);
  });

  it('says there are no sales yet today', async () => {
    openDay({
      status: 200,
      body: dayReport({ invoiceCount: 0, byMethod: [], byCashier: [], totalMinor: 0 }),
    });

    expect(await screen.findByText('لا مبيعات اليوم بعد.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'حسب الكاشير' })).not.toBeInTheDocument();
  });

  it('shows the error with a retry that asks again', async () => {
    let calls = 0;
    const { requestsTo } = openDay(() => {
      calls += 1;
      return calls === 1
        ? apiError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.')
        : { status: 200, body: dayReport() };
    });

    expect(await screen.findByText('الخادم مشغول حالياً. حاول بعد قليل.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('المبيعات قبل الحسم والضريبة')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/reports/day?date=${TODAY}`)).toHaveLength(2);
  });

  it('prints the day on A4', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    openDay();
    await screen.findByText('المبيعات قبل الحسم والضريبة');

    fireEvent.click(screen.getByRole('button', { name: 'اطبع' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const sheet = document.querySelector('[data-print-sheet="A4"]');
    expect(sheet).not.toBeNull();
    expect(text(sheet!)).toContain('سوبرماركت الياسمين');
    expect(text(sheet!)).toContain('مجموع الفواتير12,845 ل.س');
  });

  it('is closed to a cashier, and missing from their menu', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['sale.create', 'shift.close_own']) },
    });
    renderApp('/sales/today');

    expect(
      await screen.findByText(
        (text) => text === 'هذه الشاشة ليست ضمن صلاحياتك.' || text === 'ليس لديك صلاحية لهذه الصفحة',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'مبيعات اليوم' })).not.toBeInTheDocument();
  });
});
