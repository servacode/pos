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

    it('compares today with yesterday, shows the payment mix and the expiring batches', async () => {
      const days = [6, 5, 4, 3, 2].map((back) => `2026-10-${String(31 - back).padStart(2, '0')}`);
      const routes: Parameters<typeof mockFetch>[0] = {
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith([...OWNER_KEYS, 'purchases.manage']) },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport({ totalMinor: 1_500_000 }) },
        'GET /v1/reports/day?date=2026-10-30': { status: 200, body: dayReport({ totalMinor: 1_000_000 }) },
        'GET /v1/inventory/expiry?days=30': {
          status: 200,
          body: {
            today: TODAY,
            items: [
              {
                variantId: 'v-1',
                name: 'حليب',
                batchNo: null,
                expiryDate: '2026-11-05',
                purchaseNumber: 'PUR-1',
                receivedOn: '2026-10-01',
                qty: 5000,
                daysLeft: 5,
              },
            ],
          },
        },
      };
      for (const date of days) routes[`GET /v1/reports/day?date=${date}`] = { status: 200, body: dayReport() };
      mockFetch(routes);
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect((await within(sales).findAllByText('عن أمس', { exact: false }, { timeout: 5000 })).length).toBeGreaterThan(0);
      expect(within(sales).getAllByText('50%', { exact: false }).length).toBeGreaterThan(0);
      expect(await screen.findByText('دفعة قرّب انتهاؤها')).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'الفترة' })).toBeInTheDocument();
      expect(screen.getByText('طرق الدفع اليوم')).toBeInTheDocument();
    });

    it('welcomes a store with no sales yet', async () => {
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 200,
          body: dayReport({ invoiceCount: 0, totalMinor: 0, topProducts: [], byMethod: [] }),
        },
      });
      renderApp('/');

      expect(await screen.findByText('ما في مبيعات بعد')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'ابدأ أول عملية بيع' })).toHaveAttribute('href', '/pos');
    });

    it('offers a retry when the day report fails', async () => {
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 500,
          body: { error: { code: 'server_error', message: 'تعذّر الاتصال' } },
        },
      });
      renderApp('/');

      expect(await screen.findByText('تعذّر تحميل مبيعات اليوم')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'حاول مرة ثانية' })).toBeInTheDocument();
    });
  });
});
