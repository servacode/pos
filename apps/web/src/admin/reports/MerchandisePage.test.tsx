import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, MerchandiseReport } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { daysAgo, shareOf } from './MerchandisePage';

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
  lowStock: [
    {
      variantId: 'v-mw',
      productId: 'p-shirt',
      name: 'قميص كتان',
      label: 'M · أبيض',
      attributes: [
        { name: 'المقاس', value: 'M' },
        { name: 'اللون', value: 'أبيض' },
      ],
      stockQty: 1000,
      soldQty: 6000,
      minStockQty: null,
    },
  ],
  byDepartment: [
    {
      categoryId: 'c-men',
      name: 'رجالي',
      soldQty: 30_000,
      totalMinor: 3_200_000,
      returnedQty: 1000,
      returnedMinor: 200_000,
    },
    {
      categoryId: 'c-kids',
      name: 'ولادي',
      soldQty: 10_000,
      totalMinor: 1_000_000,
      returnedQty: 0,
      returnedMinor: 0,
    },
  ],
  bySeller: [
    {
      userId: 'u-1',
      fullName: 'رنا',
      invoiceCount: 12,
      totalMinor: 5_400_000,
      returnedMinor: 400_000,
      commissionBp: null,
    },
  ],
  seasons: [],
});

const url = (period: number, idle: number) =>
  `/v1/reports/merchandise?from=${daysAgo(period)}&to=${daysAgo(0)}&idleDays=${idle}`;

describe('«حركة الأصناف»', () => {
  it('shows sales by size and colour with what came back, each model’s pieces, and what sleeps', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/categories': {
        status: 200,
        body: {
          items: [
            { id: 'c-kids', name: 'ولادي', parentId: null, sortOrder: 0, productCount: 3, archivedAt: null },
          ],
        },
      },
      [`GET ${url(30, 60)}&categoryId=c-kids`]: () => ({
        status: 200,
        body: { ...report(60, true), bySeller: [] },
      }),
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

    // One M white left of six sold: reorder it
    const low = screen.getByRole('table', { name: 'يوشك على النفاد' });
    expect(within(low).getByRole('link', { name: 'قميص كتان M · أبيض' })).toHaveAttribute(
      'href',
      '/products/p-shirt',
    );

    // Men's 30,000 net of 40,000 in all
    const departments = screen.getByRole('table', { name: 'المبيعات حسب القسم' });
    expect(within(departments).getAllByRole('row')[1]).toHaveTextContent('رجالي');
    expect(within(departments).getAllByRole('row')[1]).toHaveTextContent('75٪');
    expect(within(departments).getAllByRole('row')[2]).toHaveTextContent('25٪');
    expect(shareOf(0, [])).toBe('—');

    // 5% of what Rana sold less what came back: 5% of 50,000
    await user.type(screen.getByLabelText('نسبة العمولة ٪'), '5');
    expect(within(screen.getByRole('table', { name: 'البائعون' })).getAllByRole('row')[1]).toHaveTextContent(
      '2,500',
    );
    // One department
    await screen.findByRole('option', { name: 'ولادي' });
    await user.selectOptions(screen.getByLabelText('القسم'), 'ولادي');
    await vi.waitFor(() => expect(requestsTo('GET', `${url(30, 60)}&categoryId=c-kids`)).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText('القسم'), 'كل الأقسام');

    // Without «التكلفة» the cost is not there
    await user.click(screen.getByRole('radio', { name: '3 أشهر' }));
    await screen.findByRole('table', { name: 'القطع الراكدة' });
    expect(requestsTo('GET', url(30, 90))).toHaveLength(1);
    expect(screen.queryByText('رأس مال نائم فيها')).not.toBeInTheDocument();
  });
});
