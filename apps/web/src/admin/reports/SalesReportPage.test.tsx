import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesBreakdown } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { NOW, TODAY } from '../../test/reports';
import { changePercent, commissionFor, salesBreakdownCsv } from './SalesReportPage';

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
    },
  ],
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
          return { ...me, user: { ...me.user, permissions: [...me.user.permissions, 'report.view'] } };
        })(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=product`]: {
        status: 200,
        body: report(),
      },
      [`GET /v1/reports/sales-breakdown?from=${TODAY.slice(0, 8)}01&to=${TODAY}&by=season`]: {
        status: 200,
        body: report('season'),
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
    await user.click(screen.getByRole('radio', { name: 'البائع' }));
    expect(await screen.findByText('عمولات البائعين')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});
