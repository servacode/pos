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
  it("shows today's totals for every branch, by payment method and by cashier", async () => {
    const { requestsTo } = openDay();

    expect(await screen.findByRole('heading', { name: 'مبيعات اليوم', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('المبيعات قبل الحسم والضريبة')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/reports/day?date=${TODAY}`)).toHaveLength(1);
    expect(screen.getByText('كل الفروع · 31 تشرين الأول 2026')).toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'تفصيل المبيعات' });
    expect(text(breakdown)).toContain('المبيعات قبل الحسم والضريبة13,000 ل.س');
    expect(text(breakdown)).toContain('الحسم−500 ل.س');
    expect(text(breakdown)).toContain('الضريبة345 ل.س');
    expect(text(breakdown)).toContain('مجموع الفواتير12,845 ل.س');
    expect(text(breakdown)).toContain('تقريب النقد−5 ل.س');
    expect(text(breakdown)).toContain('الإكرامية20 ل.س');

    const methods = within(screen.getByRole('region', { name: 'حسب طريقة الدفع' })).getAllByRole('row');
    expect(methods.map(text)).toEqual([
      'الطريقةالدفعاتالمبلغبالعملة الأساسية',
      'نقداً · ليرة39,145 ل.س9,145 ل.س',
      'نقداً · دولار120.00 $2,600 ل.س',
      'شام كاش11,100 ل.س1,100 ل.س',
      'المجموع12,845 ل.س',
    ]);

    const cashiers = within(screen.getByRole('region', { name: 'حسب الكاشير' })).getAllByRole('row');
    expect(cashiers.map(text)).toEqual([
      'الكاشيرالفواتيرالمبيعات',
      'سامر29,000 ل.س',
      'لينا13,845 ل.س',
      'المجموع312,845 ل.س',
    ]);
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
    fireEvent.change(screen.getByLabelText('اليوم'), { target: { value: '2026-10-30' } });
    expect(await screen.findByRole('heading', { name: 'مبيعات يوم', level: 1 })).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/reports/day?date=2026-10-30')).toHaveLength(1);
    expect(screen.getByLabelText('اليوم')).toHaveAttribute('max', TODAY);
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

    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'مبيعات اليوم' })).not.toBeInTheDocument();
  });
});
