import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { daysAgo } from '../admin/reports/MerchandisePage';
import { dayReport, meWith, OWNER_KEYS, TODAY, NOW } from '../test/reports';

describe('HomePage', () => {
  it('shows the trial days left, the store and its sectors', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe({ status: 'trialing', daysLeft: 12 }) },
    });
    renderApp('/');

    expect(await screen.findByText('باقي 12 يوماً من الباقة المجانية')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeInTheDocument();
    expect(screen.getByText('سوبرماركت الياسمين')).toBeInTheDocument();
    const sectors = within(screen.getByRole('list', { name: 'نشاط المتجر' }));
    expect(sectors.getByText('سوبرماركت ومولات')).toBeInTheDocument();
    expect(sectors.getByText('مقهى وكافتيريا')).toBeInTheDocument();
  });

  it('hides the trial banner for paid stores', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe({ status: 'active', daysLeft: 200 }) },
    });
    renderApp('/');

    await screen.findByRole('heading', { name: 'أهلاً، أحمد' });
    expect(screen.queryByText(/الباقة المجانية/)).not.toBeInTheDocument();
  });

  it('logs out and returns to the login page', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
      'POST /v1/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: /^حسابي/ }));
    await user.click(await screen.findByRole('button', { name: /خروج/ }));

    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/logout')).toHaveLength(1);
  });

  describe('the dashboard', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it("shows today's sales, the best sellers, what waits and what runs low", async () => {
      const order = (id: string, source: 'shop' | 'hold') => ({ id, source, status: 'pending' });
      const { requestsTo } = mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith([...OWNER_KEYS, 'customers.view', 'catalog.manage']) },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 200,
          body: dayReport({
            topProducts: [{ productId: 'p-1', name: 'قميص كتان', qty: 2000, totalMinor: 900_000 }],
          }),
        },
        'GET /v1/online-orders?status=pending': {
          status: 200,
          body: { items: [order('o-1', 'shop'), order('o-2', 'shop'), order('o-3', 'hold')] },
        },
        [`GET /v1/reports/merchandise?from=${daysAgo(30)}&to=${daysAgo(0)}&idleDays=60`]: {
          status: 200,
          body: {
            lowStock: [
              {
                variantId: 'v-1',
                productId: 'p-1',
                name: 'قميص كتان',
                label: 'M · أبيض',
                stockQty: 1000,
                soldQty: 6000,
                minStockQty: null,
              },
            ],
          },
        },
      });
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect(await within(sales).findByText('الفواتير')).toBeInTheDocument();
      expect(requestsTo('GET', `/v1/reports/day?date=${TODAY}`)).toHaveLength(1);
      expect(await screen.findByText('×2')).toBeInTheDocument();
      expect(await screen.findByText('طلبات جديدة من المتجر الإلكتروني')).toBeInTheDocument();
      expect(screen.getByText('قطعة محجوزة بعربون')).toBeInTheDocument();
      expect(await screen.findByText('· M · أبيض', { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'منتج جديد' })).toHaveAttribute('href', '/products/new');
      expect(screen.getByRole('link', { name: 'افتح الكاشير' })).toHaveAttribute('href', '/pos');
    });
  });
});
