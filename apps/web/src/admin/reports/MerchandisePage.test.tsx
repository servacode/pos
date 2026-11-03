import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, MerchandiseReport } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { daysAgo } from './MerchandisePage';

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'report.view'] } };
}

const report = (idleDays: number, withCost: boolean): MerchandiseReport => ({
  from: daysAgo(30),
  to: daysAgo(0),
  branchId: null,
  idleDays,
  today: daysAgo(0),
  baseCurrency: 'SYP',
  byOption: [
    {
      name: 'المقاس',
      values: [
        { value: 'M', soldQty: 8000, returnedQty: 0, totalMinor: 3_600_000 },
        { value: 'L', soldQty: 4000, returnedQty: 1000, totalMinor: 1_800_000 },
      ],
    },
    { name: 'اللون', values: [{ value: 'أبيض', soldQty: 12_000, returnedQty: 1000, totalMinor: 5_400_000 }] },
  ],
  models: [
    {
      productId: 'p-shirt',
      name: 'قميص كتان',
      soldQty: 12_000,
      totalMinor: 5_400_000,
      pieces: [
        { variantId: 'v-m', label: 'M · أبيض', soldQty: 8000, stockQty: 0 },
        { variantId: 'v-l', label: 'L · أبيض', soldQty: 4000, stockQty: 6000 },
      ],
    },
  ],
  slowMovers: [
    {
      variantId: 'v-x',
      productId: 'p-jacket',
      name: 'سترة XL · كحلي',
      stockQty: 3000,
      valueMinor: withCost ? 300_000 : null,
      lastSoldOn: null,
      lastReceivedOn: '2026-07-01',
    },
  ],
  slowValueMinor: withCost ? 300_000 : null,
});

const url = (period: number, idle: number) =>
  `/v1/reports/merchandise?from=${daysAgo(period)}&to=${daysAgo(0)}&idleDays=${idle}`;

describe('«حركة الأصناف»', () => {
  it('shows sales by size and colour with what came back, each model’s pieces, and what sleeps', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      [`GET ${url(30, 60)}`]: () => ({ status: 200, body: report(60, true) }),
      [`GET ${url(30, 90)}`]: () => ({ status: 200, body: report(90, false) }),
    });
    const { user } = renderApp('/reports/merchandise');
    const sizes = await screen.findByRole('table', { name: 'المبيعات حسب المقاس' });
    const rows = within(sizes).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('M');
    expect(rows[2]).toHaveTextContent('L');
    // One L in four came back
    expect(rows[2]).toHaveTextContent('25٪');
    expect(screen.getByRole('table', { name: 'المبيعات حسب اللون' })).toBeInTheDocument();
    const model = screen.getByRole('table', { name: 'قميص كتان' });
    expect(within(model).getAllByRole('row')[1]).toHaveTextContent('نفد');
    const slow = screen.getByRole('table', { name: 'القطع الراكدة' });
    expect(within(slow).getByRole('link', { name: 'سترة XL · كحلي' })).toHaveAttribute(
      'href',
      '/products/p-jacket',
    );
    expect(slow).toHaveTextContent('لم يُبع');
    expect(screen.getByText('رأس مال نائم فيها')).toBeInTheDocument();

    // Without «التكلفة» the cost is not there
    await user.click(screen.getByRole('radio', { name: '3 أشهر' }));
    await screen.findByRole('table', { name: 'القطع الراكدة' });
    expect(requestsTo('GET', url(30, 90))).toHaveLength(1);
    expect(screen.queryByText('رأس مال نائم فيها')).not.toBeInTheDocument();
  });
});
