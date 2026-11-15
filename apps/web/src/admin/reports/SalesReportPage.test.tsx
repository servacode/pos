import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesBreakdown } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { NOW, TODAY } from '../../test/reports';
import {
  changePercent,
  commissionFor,
  CrossTable,
  everyDay,
  salesBreakdownCsv,
  sellThrough,
  softChange,
} from './SalesReportPage';

const report = (by: SalesBreakdown['by'] = 'product'): SalesBreakdown => ({
  from: '2026-11-01',
  to: '2026-11-13',
  previousFrom: '2026-10-19',
  previousTo: '2026-10-31',
  by,
  option: null,
  branchId: null,
  baseCurrency: 'SYP',
  totalMinor: 30_000_000,
  previousTotalMinor: 20_000_000,
  optionNames: ['المقاس', 'اللون'],
  rows: [
    {
      key: 'p1',
      name: 'قميص قطني',
      qty: 3000,
      totalMinor: 30_000_000,
      returnedMinor: 1_000_000,
      invoiceCount: 4,
      previousQty: 2000,
      previousTotalMinor: 20_000_000,
      commissionBp: null,
      commissionMinor: null,
      receivedQty: null,
    },
  ],
  daily: [],
  cross: null,
  commissionTotalMinor: null,
});

describe('تقرير المبيعات', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the rows against the previous period', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: (() => {
          const me = makeMe();
          return { ...me, user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] } };
        })(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=product`]: {
        status: 200,
        body: report(),
      },
    });
    renderApp('/reports/sales');
    expect(await screen.findByRole('heading', { name: 'تقرير المبيعات', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('قميص قطني')).toBeInTheDocument();
    expect(screen.getByText('+50٪')).toBeInTheDocument();
    // On a phone the grouping buttons scroll inside their own box instead of widening the page
    expect(screen.getByRole('radiogroup', { name: 'التجميع' }).parentElement).toHaveClass('overflow-x-auto');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('computes the change and writes a CSV with the commission of a seller', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(5, 0)).toBeNull();
    const csv = salesBreakdownCsv(report('seller'), '10');
    expect(csv).toContain('"العمولة"');
    expect(csv).toContain('"قميص قطني"');
    // (300000 + 10000 returned) sold, less 10000 back, at 10%: 30000.00
    expect(csv).toContain('"300000.00"');
    expect(salesBreakdownCsv(report('product'), '')).not.toContain('العمولة');
  });

  it('pays a seller by the rate of the staff page, and the typed percent only where there is none', () => {
    const row = report('seller').rows[0]!;
    const rated = { ...row, commissionBp: 250, commissionMinor: 750_000 };
    expect(commissionFor(rated, '10')).toBe(750_000);
    expect(commissionFor(rated, '')).toBe(750_000);
    expect(commissionFor(row, '')).toBeNull();
    // 10% of the 300000.00 net, in qirsh
    expect(commissionFor(row, '10')).toBe(3_000_000);
    const csv = salesBreakdownCsv({ ...report('seller'), rows: [rated] }, '');
    expect(csv).toContain('"7500.00"');
  });

  it('groups by season and totals the commissions of the sellers', async () => {
    const seller = { ...report('seller'), commissionTotalMinor: 750_000 };
    seller.rows = [{ ...seller.rows[0]!, commissionBp: 250, commissionMinor: 750_000 }];
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: (() => {
          const me = makeMe();
          return {
            ...me,
            tenant: { ...me.tenant, sectors: ['clothing'] },
            user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] },
          };
        })(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=product`]: {
        status: 200,
        body: report(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=season`]: {
        status: 200,
        body: (() => {
          const r = report('season');
          r.rows = [{ ...r.rows[0]!, qty: 3000, receivedQty: 4000 }];
          return r;
        })(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=seller`]: {
        status: 200,
        body: seller,
      },
    });
    const { user } = renderApp('/reports/sales');
    await screen.findByText('قميص قطني');
    await user.click(screen.getByRole('radio', { name: 'الموسم' }));
    expect(await screen.findByRole('columnheader', { name: 'الموسم' })).toBeInTheDocument();
    // Sold 3 of the 4 received
    expect(await screen.findByText('75٪')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'البائع' }));
    expect(await screen.findByText('عمولات البائعين')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('fills the option picker from another grouping and groups by the first option, hiding empty history', async () => {
    const m = TODAY.slice(0, 8);
    const noHistory = { ...report('option'), option: 'المقاس', previousTotalMinor: 0 };
    noHistory.rows = [{ ...noHistory.rows[0]!, name: 'M', previousTotalMinor: 0, previousQty: 0 }];
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: (() => {
          const me = makeMe();
          return { ...me, user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] } };
        })(),
      },
      [`GET /v1/reports/sales-breakdown?from=${m}01&to=${TODAY}&by=product`]: { status: 200, body: report() },
      [`GET /v1/reports/sales-breakdown?from=${m}01&to=${TODAY}&by=option&option=${encodeURIComponent('المقاس')}`]:
        { status: 200, body: noHistory },
    });
    const { user } = renderApp('/reports/sales');
    await screen.findByText('قميص قطني');
    await user.click(screen.getByRole('radio', { name: /^الخيار/ }));
    expect(await screen.findByRole('option', { name: 'اللون' })).toBeInTheDocument();
    expect(await screen.findByText('M')).toBeInTheDocument();
    // Never asked by option without a name (the server refuses that)
    expect(requests.some((r) => r.path.endsWith('by=option'))).toBe(false);
    expect(screen.queryByText('جديد')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'الفترة السابقة' })).not.toBeInTheDocument();
  });
});

describe('softer changes, sell-through and the cross-table', () => {
  it('softens a doubling and a fall to nothing, and keeps the plain percent otherwise', () => {
    expect(softChange(340)).toEqual({ text: 'أكثر من الضعف', tone: 'success' });
    expect(softChange(-100)).toEqual({ text: 'لا مبيع', tone: 'neutral' });
    expect(softChange(50)).toEqual({ text: '+50٪', tone: 'success' });
    expect(softChange(-20)).toEqual({ text: '−20٪', tone: 'neutral' });
    expect(softChange(-60)).toEqual({ text: '−60٪', tone: 'warning' });
    expect(softChange(0)).toEqual({ text: '0٪', tone: 'success' });
  });

  it('fills the quiet days of the period with zero for the bars, and leaves a very long period as it is', () => {
    expect(everyDay('2026-11-01', '2026-11-04', [{ date: '2026-11-02', totalMinor: 500 }])).toEqual([
      { date: '2026-11-01', totalMinor: 0 },
      { date: '2026-11-02', totalMinor: 500 },
      { date: '2026-11-03', totalMinor: 0 },
      { date: '2026-11-04', totalMinor: 0 },
    ]);
    const long = [{ date: '2026-03-02', totalMinor: 1 }];
    expect(everyDay('2026-01-01', '2026-11-04', long)).toEqual(long);
    expect(everyDay('2026-11-04', '2026-11-01', long)).toEqual(long);
  });

  it('works out the sell-through only where something was received', () => {
    expect(sellThrough(3000, 4000)).toBe(75);
    expect(sellThrough(5000, 4000)).toBe(125);
    expect(sellThrough(-1000, 4000)).toBe(0);
    expect(sellThrough(3000, 0)).toBeNull();
    expect(sellThrough(3000, null)).toBeNull();
  });

  it('draws size by colour with row and column totals', () => {
    render(
      <CrossTable
        cross={{
          rowOption: 'المقاس',
          colOption: 'اللون',
          cells: [
            { row: 'M', col: 'أبيض', qty: 3000, totalMinor: 1 },
            { row: 'M', col: 'أسود', qty: 2000, totalMinor: 1 },
            { row: 'L', col: 'أبيض', qty: 1000, totalMinor: 1 },
          ],
        }}
      />,
    );
    const m = screen.getByRole('row', { name: /^M/ });
    expect(
      within(m)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['3', '2', '5']);
    const l = screen.getByRole('row', { name: /^L/ });
    // A size with no sale in a colour is a dot, never a bare empty cell
    expect(
      within(l)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['1', '·', '1']);
    const total = screen.getAllByRole('row').at(-1)!;
    expect(
      within(total)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '2', '6']);
  });

  it('says so when no piece sold with two options', () => {
    render(<CrossTable cross={{ rowOption: 'المقاس', colOption: 'اللون', cells: [] }} />);
    expect(screen.getByText('لا مبيعات بخيارين في هذه المدة.')).toBeInTheDocument();
  });
});

describe('the daily bars and the other shops', () => {
  const asOwner = (sectors: string[]) => {
    const me = makeMe();
    return {
      ...me,
      tenant: { ...me.tenant, sectors },
      user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('draws a small chart of each day once there are three, and hides the season tab outside clothing', async () => {
    const withDays = {
      ...report(),
      daily: [
        { date: '2026-11-01', totalMinor: 1_000_000 },
        { date: '2026-11-02', totalMinor: 2_000_000 },
        { date: '2026-11-03', totalMinor: 500_000 },
      ],
    };
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: asOwner(['supermarket']) },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=product`]: {
        status: 200,
        body: withDays,
      },
    });
    renderApp('/reports/sales');
    await screen.findByText('قميص قطني');
    expect(await screen.findByRole('heading', { name: 'المبيع كل يوم' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'الموسم' })).not.toBeInTheDocument();
    expect(screen.getByText('بعد المرتجع، مع الضريبة')).toBeInTheDocument();
  });

  it('shows no chart under three days', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: asOwner(['clothing']) },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=product`]: {
        status: 200,
        body: { ...report(), daily: [{ date: '2026-11-01', totalMinor: 1_000_000 }] },
      },
    });
    renderApp('/reports/sales');
    await screen.findByText('قميص قطني');
    expect(screen.queryByRole('heading', { name: 'المبيع كل يوم' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'الموسم' })).toBeInTheDocument();
  });
});
