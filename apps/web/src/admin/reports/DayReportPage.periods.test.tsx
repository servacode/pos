import { fireEvent, screen, within } from '@testing-library/react';
import { stripBidiControls } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { dayReport, meWith, NOW, OWNER_KEYS, shiftSummary, TODAY } from '../../test/reports';
import { addDays, periodOf, periodRange } from './periods';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

function openDay(routes: Record<string, MockReply | (() => MockReply)>, branchId?: string) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS, { branchId }) },
    ...routes,
  });
  return { ...mock, ...renderApp('/sales/today') };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the periods of the reports', () => {
  it('gives each chip its range, a week from Saturday and a month from the first', () => {
    // Wednesday 2026-11-18
    expect(periodRange('today', '2026-11-18')).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(periodRange('yesterday', '2026-11-18')).toEqual({ from: '2026-11-17', to: '2026-11-17' });
    expect(periodRange('week', '2026-11-18')).toEqual({ from: '2026-11-14', to: '2026-11-18' });
    expect(periodRange('month', '2026-11-18')).toEqual({ from: '2026-11-01', to: '2026-11-18' });
    // Saturday itself, and Friday (the sixth day of the week)
    expect(periodRange('week', '2026-11-14').from).toBe('2026-11-14');
    expect(periodRange('week', '2026-11-20').from).toBe('2026-11-14');
    expect(periodOf({ from: '2026-11-01', to: '2026-11-18' }, '2026-11-18')).toBe('month');
    expect(periodOf({ from: '2026-11-02', to: '2026-11-18' }, '2026-11-18')).toBeNull();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('«مبيعات اليوم» — the days', () => {
  it('moves a day back and forth with the arrows, never past today', async () => {
    const { requestsTo } = openDay({
      [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport() },
      'GET /v1/reports/day?date=2026-10-30': { status: 200, body: dayReport({ date: '2026-10-30' }) },
    });
    await screen.findByText('المبيعات قبل الحسم والضريبة');
    expect(screen.getByRole('button', { name: 'اليوم التالي' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'اليوم السابق' }));
    expect(await screen.findByText(/30\/10\/2026/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/reports/day?date=2026-10-30')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'اليوم التالي' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'اليوم' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'اليوم التالي' }));
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'اليوم' })).toBeChecked());
  });

  it('opens yesterday from its chip', async () => {
    const { requestsTo } = openDay({
      [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport() },
      'GET /v1/reports/day?date=2026-10-30': { status: 200, body: dayReport({ date: '2026-10-30' }) },
    });
    await screen.findByText('المبيعات قبل الحسم والضريبة');
    expect(screen.getByRole('radio', { name: 'اليوم' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'أمس' }));
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/reports/day?date=2026-10-30')).toHaveLength(1));
    expect(screen.getByRole('radio', { name: 'أمس' })).toBeChecked();
  });

  it('shows the totals of the month with a row per day, and opens a day from its row', async () => {
    const { requestsTo } = openDay({
      [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport() },
      'GET /v1/reports/days?from=2026-10-01&to=2026-10-31': {
        status: 200,
        body: {
          items: [
            { date: '2026-10-29', invoiceCount: 10, totalMinor: 5_000_000, returnsMinor: 500_000 },
            { date: '2026-10-30', invoiceCount: 5, totalMinor: 2_500_000, returnsMinor: 0 },
          ],
        },
      },
      'GET /v1/reports/day?date=2026-10-29': { status: 200, body: dayReport({ date: '2026-10-29' }) },
    });
    await screen.findByText('المبيعات قبل الحسم والضريبة');

    fireEvent.click(screen.getByRole('radio', { name: 'هالشهر' }));
    const table = await screen.findByRole('table', { name: 'مبيعات كل يوم في المدة' });
    expect(requestsTo('GET', '/v1/reports/days?from=2026-10-01&to=2026-10-31')).toHaveLength(1);
    expect(within(table).getAllByRole('row').map(text)).toEqual([
      'اليومالفواتيرالمبيعاتالمرتجعاتالصافي',
      '29/10/20261050,000 ل.س5,000 ل.س45,000 ل.س',
      '30/10/2026525,000 ل.س0 ل.س25,000 ل.س',
      'المجموع1575,000 ل.س5,000 ل.س70,000 ل.س',
    ]);
    // The tiles: net 70,000 over 15 invoices, average 4,667
    expect(text(screen.getAllByText('صافي المبيعات بعد المرتجعات')[0]!.closest('div')!)).toContain(
      '70,000 ل.س',
    );
    expect(text(screen.getByText('متوسط الفاتورة').closest('div')!)).toContain('4,667 ل.س');
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeDisabled();

    fireEvent.click(within(table).getByRole('button', { name: '29/10/2026' }));
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/reports/day?date=2026-10-29')).toHaveLength(1));
    expect(await screen.findByText('المبيعات قبل الحسم والضريبة')).toBeInTheDocument();
  });

  it('offers the last day with sales when the day is empty, and goes there', async () => {
    const { requestsTo } = openDay({
      [`GET /v1/reports/day?date=${TODAY}`]: {
        status: 200,
        body: dayReport({ invoiceCount: 0, byMethod: [], byCashier: [], totalMinor: 0 }),
      },
      'GET /v1/reports/days?from=2026-08-31&to=2026-10-30': {
        status: 200,
        body: {
          items: [
            { date: '2026-10-20', invoiceCount: 3, totalMinor: 100, returnsMinor: 0 },
            { date: '2026-10-28', invoiceCount: 4, totalMinor: 200, returnsMinor: 0 },
            { date: '2026-10-29', invoiceCount: 0, totalMinor: 0, returnsMinor: 50 },
          ],
        },
      },
      'GET /v1/reports/day?date=2026-10-28': { status: 200, body: dayReport({ date: '2026-10-28' }) },
    });
    const link = await screen.findByRole('button', { name: /آخر يوم فيه مبيعات: 28\/10\/2026/ });
    fireEvent.click(link);
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/reports/day?date=2026-10-28')).toHaveLength(1));
    expect(await screen.findByText('المبيعات قبل الحسم والضريبة')).toBeInTheDocument();
  });

  it('counts yesterday’s open shifts of the branch shown, not of every branch', async () => {
    // 08:00 in the store: the day is young
    vi.setSystemTime(new Date('2026-10-31T05:00:00.000Z'));
    const open = shiftSummary({
      id: 'o-1',
      status: 'open',
      closedAt: null,
      salesCount: 7,
      salesTotalMinor: 700_000,
    });
    const { requestsTo } = openDay(
      {
        'GET /v1/reports/day?branchId=branch-1&date=2026-10-31': { status: 200, body: dayReport() },
        'GET /v1/shifts?branchId=branch-1&date=2026-10-30': { status: 200, body: { items: [open] } },
      },
      'branch-1',
    );
    expect(await screen.findByText(/وردية مفتوحة منذ أمس: 7 فاتورة/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/shifts?branchId=branch-1&date=2026-10-30')).toHaveLength(1);
    expect(requestsTo('GET', '/v1/shifts?date=2026-10-30')).toHaveLength(0);
  });
});

describe('who may open the day report and the shifts', () => {
  it.each([
    ['/sales/today', 'reports.financial'],
    ['/shifts', 'reports.financial'],
    ['/shifts', 'shift.close_any'],
  ])('shows %s as not theirs to a role with only %s, as the server answers 403', async (path, key) => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith([key as never]) },
    });
    renderApp(path);
    expect(
      await screen.findByText(
        (text) => text === 'هذه الشاشة ليست ضمن صلاحياتك.' || text === 'ليس لديك صلاحية لهذه الصفحة',
      ),
    ).toBeInTheDocument();
  });
});
