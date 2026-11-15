import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { daysAgo } from '../admin/reports/MerchandisePage';
import { clearReportCache } from '../admin/reports/useReport';
import { dayReport, meWith, OWNER_KEYS, TODAY, NOW } from '../test/reports';

/** The first day of the week the home page asks the sales report for: six days before */
const shiftWeek = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
};

const dayBack = (back: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};

/** The one request that brings the six days before today: its route and the days that sold */
const WEEK = `GET /v1/reports/days?from=${dayBack(6)}&to=${dayBack(1)}`;
const weekOf = (sold: Record<string, number>) => ({
  status: 200,
  body: {
    items: Object.entries(sold).map(([date, totalMinor]) => ({
      date,
      invoiceCount: 1,
      totalMinor,
      returnsMinor: 0,
    })),
  },
});

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
      // The last answers are kept per screen: one test must not open with another's numbers
      clearReportCache();
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
      const { user } = renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect(await within(sales).findByText('الفواتير')).toBeInTheDocument();
      expect(requestsTo('GET', `/v1/reports/day?date=${TODAY}`)).toHaveLength(1);
      // The pending orders are asked once, though the shell and the page both want them
      expect(requestsTo('GET', '/v1/online-orders?status=pending')).toHaveLength(1);
      expect(await screen.findByText('×2')).toBeInTheDocument();
      expect(await screen.findByText('طلبات جديدة من المتجر الإلكتروني')).toBeInTheDocument();
      expect(screen.getByText('قطعة محجوزة بعربون')).toBeInTheDocument();
      // «تحتاج انتباهك» is one card: what waits first, the stock under its second tab
      expect(screen.getByRole('heading', { name: 'تحتاج انتباهك' })).toBeInTheDocument();
      await user.click(screen.getByRole('tab', { name: /المخزون/ }));
      expect(await screen.findByText('· M · أبيض', { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'منتج جديد' })).toHaveAttribute('href', '/products/new');
      expect(screen.getByRole('link', { name: 'افتح الكاشير' })).toHaveAttribute('href', '/pos');
    });

    it('a clothing store sees the week’s top five and which size ran out', async () => {
      const me = meWith([...OWNER_KEYS, 'catalog.manage']);
      const row = (key: string, name: string, totalMinor: number) => ({
        key,
        name,
        qty: 2000,
        totalMinor,
        returnedMinor: 0,
        invoiceCount: 2,
        previousQty: 0,
        previousTotalMinor: 0,
        commissionBp: null,
        commissionMinor: null,
      });
      const week = `from=${shiftWeek(TODAY)}&to=${TODAY}&by=product`;
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: { ...me, tenant: { ...me.tenant, sectors: ['clothing'] } } },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 200,
          body: dayReport({
            topProducts: [{ productId: 'p-1', name: 'قميص كتان', qty: 2000, totalMinor: 900_000 }],
          }),
        },
        [`GET /v1/reports/sales-breakdown?${week}`]: {
          status: 200,
          body: {
            rows: [row('p-1', 'قميص كتان', 900_000), row('p-2', 'بنطال جينز', 500_000)],
            baseCurrency: 'SYP',
          },
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
                attributes: [
                  { name: 'المقاس', value: 'M' },
                  { name: 'اللون', value: 'أبيض' },
                ],
                stockQty: 0,
                soldQty: 6000,
                minStockQty: null,
              },
            ],
          },
        },
      });
      renderApp('/');

      const top = await screen.findByRole('list', { name: 'الأكثر مبيعاً هذا الأسبوع' });
      expect(within(top).getAllByRole('listitem')).toHaveLength(2);
      expect(within(top).getByRole('link', { name: 'بنطال جينز' })).toHaveAttribute('href', '/products/p-2');
      expect(
        await screen.findByText('المقاس M (أبيض) من قميص كتان نفد', { exact: false }),
      ).toBeInTheDocument();
    });

    it('names the returns, notes the vouchers in the payment mix, and counts recalled batches', async () => {
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith([...OWNER_KEYS, 'purchases.manage']) },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 200,
          body: dayReport({
            returns: { count: 1, totalMinor: 22_340, taxMinor: 0, byMethod: [] },
            byMethod: [
              { method: 'cash', currency: 'SYP', amountMinor: 50_000, baseAmountMinor: 50_000, count: 1 },
              { method: 'voucher', currency: 'SYP', amountMinor: 13_900, baseAmountMinor: 13_900, count: 1 },
            ],
          }),
        },
        'GET /v1/inventory/expiry?days=30': {
          status: 200,
          body: {
            today: TODAY,
            items: [
              {
                variantId: 'v-1',
                name: 'مضاد',
                batchNo: 'B7',
                expiryDate: '2027-05-05',
                purchaseNumber: 'PUR-1',
                receivedOn: '2026-10-01',
                qty: 5000,
                daysLeft: 150,
                blocked: true,
                blockReason: 'استدعاء',
              },
            ],
          },
        },
      });
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect(await within(sales).findByText(/المرتجعات/)).toBeInTheDocument();
      expect(sales).not.toHaveTextContent('بعد مرتجع');
      expect(await screen.findByText(/منها قسائم مستردّة/)).toBeInTheDocument();
      const recalled = await screen.findByRole('link', { name: /دفعة موقوفة عن البيع/ });
      expect(recalled).toHaveAttribute('href', '/recall');
    });

    it('compares today with yesterday, shows the payment mix and the expiring batches', async () => {
      const routes: Parameters<typeof mockFetch>[0] = {
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith([...OWNER_KEYS, 'purchases.manage']) },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport({ totalMinor: 1_500_000 }) },
        [WEEK]: weekOf(Object.fromEntries([1, 2, 3, 4, 5, 6].map((back) => [dayBack(back), 1_000_000]))),
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
      mockFetch(routes);
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect(
        (await within(sales).findAllByText('عن أمس', { exact: false }, { timeout: 5000 })).length,
      ).toBeGreaterThan(0);
      expect(within(sales).getAllByText('50%', { exact: false }).length).toBeGreaterThan(0);
      expect(await screen.findByText('دفعة يقترب انتهاؤها')).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'الفترة' })).toBeInTheDocument();
      expect(screen.getByText('طرق الدفع اليوم')).toBeInTheDocument();
    });

    it('says there is no history instead of drawing a climb from zero when only today has sold', async () => {
      const routes: Parameters<typeof mockFetch>[0] = {
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport({ totalMinor: 1_500_000 }) },
        [WEEK]: weekOf({}),
      };
      mockFetch(routes);
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      // Said once, in the hero; no week bars, sparklines or one-point chart repeat it
      expect(await within(sales).findAllByText('لا بيانات قبل اليوم')).toHaveLength(1);
      expect(within(sales).queryByText('آخر 7 أيام')).not.toBeInTheDocument();
      expect(screen.queryByText('اتجاه المبيعات')).not.toBeInTheDocument();
    });

    it('says «لا مبيعات بعد» on a morning with no sale instead of a red fall of 100%', async () => {
      const routes: Parameters<typeof mockFetch>[0] = {
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
        [`GET /v1/reports/day?date=${TODAY}`]: {
          status: 200,
          body: dayReport({ totalMinor: 0, invoiceCount: 0, topProducts: [], byMethod: [] }),
        },
      };
      routes[WEEK] = weekOf(Object.fromEntries([1, 2, 3, 4, 5, 6].map((back) => [dayBack(back), 1_000_000])));
      mockFetch(routes);
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      expect(await within(sales).findByText('لا مبيعات بعد')).toBeInTheDocument();
      expect(within(sales).queryByText('100%', { exact: false })).not.toBeInTheDocument();
      expect(within(sales).queryByText('عن أمس', { exact: false })).not.toBeInTheDocument();
    });

    it('draws no trend card or sparklines while fewer than three days have sold', async () => {
      const routes: Parameters<typeof mockFetch>[0] = {
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport({ totalMinor: 1_500_000 }) },
        [WEEK]: weekOf({ '2026-10-30': 1_000_000 }),
      };
      mockFetch(routes);
      renderApp('/');

      const sales = await screen.findByRole('region', { name: 'مبيعات اليوم' });
      await within(sales).findByText('الفواتير');
      await within(sales).findAllByText('عن أمس', { exact: false }, { timeout: 5000 });
      expect(screen.queryByText('اتجاه المبيعات')).not.toBeInTheDocument();
      expect(within(sales).queryByRole('img')).not.toBeInTheDocument();
    });

    it('names a negative piece once, in «يوشك على النفاد», with «ناقص» opening the count on it', async () => {
      const me = meWith([...OWNER_KEYS, 'catalog.manage']);
      const low = {
        variantId: 'v-1',
        productId: 'p-1',
        name: 'قميص كتان',
        label: 'M · أبيض',
        attributes: [
          { name: 'المقاس', value: 'M' },
          { name: 'اللون', value: 'أبيض' },
        ],
        stockQty: -11_000,
        soldQty: 6000,
        minStockQty: null,
      };
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: { ...me, tenant: { ...me.tenant, sectors: ['clothing'] } } },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport() },
        [`GET /v1/reports/merchandise?from=${daysAgo(30)}&to=${daysAgo(0)}&idleDays=60`]: {
          status: 200,
          body: { lowStock: [low] },
        },
      });
      renderApp('/');

      const chip = await screen.findByRole('link', { name: 'اجرد قميص كتان' });
      expect(chip).toHaveAttribute('href', '/inventory?count=v-1');
      expect(chip).toHaveTextContent('ناقص 11');
      // It is not named a second time under «ما ينتظرك»
      expect(screen.getAllByText('ناقص 11')).toHaveLength(1);
      expect(screen.queryByText(/من قميص كتان/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'اجرد المخزون' })).toHaveAttribute(
        'href',
        '/inventory?count=v-1',
      );
    });

    it('greets «أبو» and «أم» names whole', async () => {
      const me = meWith(OWNER_KEYS);
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, fullName: 'أبو سامر الحلبي' } } },
        [`GET /v1/reports/day?date=${TODAY}`]: { status: 200, body: dayReport() },
      });
      renderApp('/');
      expect(await screen.findByRole('heading', { name: 'أهلاً، أبو سامر' })).toBeInTheDocument();
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

      expect(await screen.findByText('لا مبيعات بعد')).toBeInTheDocument();
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
