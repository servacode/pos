import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { feeOf } from './OnlineStorePage';
import type { MeResponse, OnlineOrder, OnlineStoreSettings } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'settings.manage', 'customers.view', 'customers.manage'],
    },
  };
}

const settings: OnlineStoreSettings = {
  version: null,
  enabled: false,
  slug: 'shop-123456',
  whatsapp: null,
  delivery: true,
  pickup: true,
  note: null,
  showOutOfStock: false,
  orderMode: 'whatsapp',
  showPrices: true,
  deliveryFeeMinor: 0,
  deliveryAreas: [],
};

const order = (status: OnlineOrder['status']): OnlineOrder => ({
  id: 'o-1',
  number: 'ONL-000001',
  status,
  source: 'whatsapp',
  depositCode: null,
  deliveryFeeMinor: 0,
  deliveryArea: null,
  customerName: 'ريم',
  phone: '+963944555666',
  fulfilment: 'delivery',
  address: 'المزة',
  note: null,
  currency: 'SYP',
  totalMinor: 920_000,
  lines: [
    {
      variantId: 'v',
      productId: 'p',
      name: 'قميص كتان',
      label: 'L · أبيض',
      qty: 2,
      priceMinor: 460_000,
      totalMinor: 920_000,
    },
  ],
  createdAt: '2026-11-03T10:00:00.000Z',
  decidedAt: null,
  version: 1,
});

describe('«المتجر الإلكتروني» on the dashboard', () => {
  it('turns the shop on with its link and number, and accepts an order waiting in the box', async () => {
    let current = order('pending');
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'PUT /v1/online-store': (r: MockRequest) => ({
        status: 200,
        body: { ...(r.body as OnlineStoreSettings), version: 1, whatsapp: '+963933123456' },
      }),
      'GET /v1/online-orders?status=pending': () => ({
        status: 200,
        body: { items: current.status === 'pending' ? [current] : [] },
      }),
      'GET /v1/online-orders/cod': { status: 200, body: { currency: 'SYP', couriers: [] } },
      'POST /v1/online-orders/o-1/status': (r: MockRequest) => {
        current = { ...current, status: (r.body as { status: OnlineOrder['status'] }).status, version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'إعدادات المتجر' }));
    await user.click(await screen.findByRole('switch', { name: /المتجر مفعّل/ }));
    const slug = screen.getByLabelText('رابط المتجر');
    await user.clear(slug);
    await user.type(slug, 'Nour-Fashion');
    await user.type(screen.getByLabelText('رقم واتساب الطلبات'), '0933123456');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByRole('link', { name: 'افتح المتجر' })).toHaveAttribute(
      'href',
      `${window.location.origin}/shop/nour-fashion`,
    );
    expect(requestsTo('PUT', '/v1/online-store')[0]!.body).toMatchObject({
      enabled: true,
      slug: 'nour-fashion',
      whatsapp: '0933123456',
    });

    await user.click(screen.getByRole('radio', { name: 'الطلبات' }));
    const box = await screen.findByRole('list', { name: 'طلبات المتجر' });
    const one = within(box).getByRole('listitem', { name: 'الطلب ONL-000001' });
    expect(one).toHaveTextContent('قميص كتان (L · أبيض) × 2');
    expect(one).toHaveTextContent('توصيل إلى المزة');
    await user.click(within(one).getByRole('button', { name: 'اقبل' }));
    expect(requestsTo('POST', '/v1/online-orders/o-1/status')[0]!.body).toEqual({
      status: 'accepted',
      version: 1,
    });
    expect(await screen.findByText('لا طلبات هنا.')).toBeInTheDocument();
  });
});

describe('«اعرض الأسعار في المتجر الإلكتروني»', () => {
  it('is on by default and is saved off when the owner turns it off', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'PUT /v1/online-store': (r: MockRequest) => ({
        status: 200,
        body: { ...(r.body as OnlineStoreSettings), version: 1 },
      }),
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'إعدادات المتجر' }));
    const toggle = await screen.findByRole('switch', { name: /اعرض الأسعار في المتجر الإلكتروني/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await screen.findByText(/حُفظ/);
    expect(requestsTo('PUT', '/v1/online-store')[0]!.body).toMatchObject({ showPrices: false });
  });
});

describe('the settings’ save bar and the WhatsApp number', () => {
  const open = () =>
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'PUT /v1/online-store': (r: MockRequest) => ({
        status: 200,
        body: { ...(r.body as OnlineStoreSettings), version: 1 },
      }),
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
    });

  it('shows the save bar only while there are unsaved changes', async () => {
    open();
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'إعدادات المتجر' }));
    const toggle = await screen.findByRole('switch', { name: /اعرض القطع التي نفد مخزونها/ });
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'احفظ' })).toBeInTheDocument();
    // Back to what the server holds: nothing to save
    await user.click(toggle);
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
  });

  it('says a number with letters is wrong, as it is typed, and does not save it', async () => {
    const { requestsTo } = open();
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'إعدادات المتجر' }));
    const number = await screen.findByLabelText('رقم واتساب الطلبات');
    await user.type(number, '09ab33');
    expect(screen.getByText(/رقم غير صحيح: اكتب أرقاماً فقط/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'احفظ' })).toBeDisabled();
    await user.clear(number);
    await user.type(number, '0933123456');
    expect(screen.queryByText(/رقم غير صحيح/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await screen.findByText(/حُفظ/);
    expect(requestsTo('PUT', '/v1/online-store')).toHaveLength(1);
    // Saved: the button leaves
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
  });
});

describe('deciding an order', () => {
  it('sends one request on a double click, with the buttons off meanwhile', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let current = order('pending');
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': () => ({
        status: 200,
        body: { items: current.status === 'pending' ? [current] : [] },
      }),
      'POST /v1/online-orders/o-1/status': async () => {
        await gate;
        current = { ...current, status: 'accepted', version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    const one = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    const accept = within(one).getByRole('button', { name: 'اقبل' });
    await user.dblClick(accept);
    expect(within(one).getByRole('button', { name: 'ارفض' })).toBeDisabled();
    release();
    expect(await screen.findByText('لا طلبات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/online-orders/o-1/status')).toHaveLength(1);
  });

  it('warns before accepting an order the shelf cannot cover, and accepts on the second press', async () => {
    let current = order('pending');
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': () => ({
        status: 200,
        body: { items: current.status === 'pending' ? [current] : [] },
      }),
      'GET /v1/inventory': {
        status: 200,
        body: {
          items: [
            {
              variantId: 'v',
              name: 'قميص كتان',
              branchId: 'b',
              qty: 1000,
              valueMinor: 0,
              unitCostMinor: null,
            },
          ],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        },
      },
      'POST /v1/online-orders/o-1/status': () => {
        current = { ...current, status: 'accepted', version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    const one = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    await user.click(within(one).getByRole('button', { name: 'اقبل' }));
    expect(await within(one).findByText(/لا يكفي المخزون لهذه القطع/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/online-orders/o-1/status')).toHaveLength(0);
    await user.click(within(one).getByRole('button', { name: 'اقبل رغم النقص' }));
    expect(await screen.findByText('لا طلبات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/online-orders/o-1/status')).toHaveLength(1);
  });

  it('shows an order its customer asked to cancel, to agree or to keep', async () => {
    let current = order('cancel_requested');
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': () => ({
        status: 200,
        body: { items: current.status === 'cancel_requested' ? [current] : [] },
      }),
      'GET /v1/online-orders/cod': { status: 200, body: { currency: 'SYP', couriers: [] } },
      'POST /v1/online-orders/o-1/status': (r: MockRequest) => {
        current = { ...current, status: (r.body as { status: OnlineOrder['status'] }).status, version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    const one = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    expect(one).toHaveTextContent('طلب الزبون الإلغاء');
    expect(one).toHaveTextContent('الزبون يطلب إلغاء هذا الطلب.');
    await user.click(within(one).getByRole('button', { name: 'وافق على الإلغاء' }));
    expect(requestsTo('POST', '/v1/online-orders/o-1/status')[0]!.body).toEqual({
      status: 'rejected',
      version: 1,
    });
  });
});

describe('round 44: who decides, the server’s stock check, pages and fees', () => {
  const viewer = (): MeResponse => {
    const base = makeMe();
    return {
      ...base,
      user: { ...base.user, permissions: [...base.user.permissions, 'customers.view'] },
    };
  };

  it('shows the orders to one who may only look, with no way to decide them', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: viewer() },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [order('pending')] } },
    });
    renderApp('/online-store');
    const one = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    expect(within(one).queryByRole('button', { name: 'اقبل' })).toBeNull();
    expect(within(one).queryByRole('button', { name: 'ارفض' })).toBeNull();
    expect(screen.queryByText(/النقد عند المندوبين|المندوبين/)).toBeNull();
  });

  it('takes the server’s refusal for the same warning, then accepts with the pieces on their way', async () => {
    let current = order('pending');
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': () => ({
        status: 200,
        body: { items: current.status === 'pending' ? [current] : [] },
      }),
      'GET /v1/inventory': { status: 200, body: { items: [], totalValueMinor: 0, baseCurrency: 'SYP' } },
      'POST /v1/online-orders/o-1/status': (r: MockRequest) => {
        if (!(r.body as { force?: boolean }).force) {
          return apiError(409, 'conflict', 'لا يكفي المخزون', { stock: '«قميص كتان»' });
        }
        current = { ...current, status: 'accepted', version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    const one = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    await user.click(within(one).getByRole('button', { name: 'اقبل' }));
    expect(await within(one).findByText(/«قميص كتان»/)).toBeInTheDocument();
    await user.click(within(one).getByRole('button', { name: 'اقبل رغم النقص' }));
    expect(await screen.findByText('لا طلبات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/online-orders/o-1/status').map((r) => r.body)).toEqual([
      { status: 'accepted', version: 1 },
      { status: 'accepted', version: 1, force: true },
    ]);
  });

  it('pages the orders: the next page is asked with its cursor, never more than the filter on screen', async () => {
    const second = { ...order('pending'), id: 'o-2', number: 'ONL-000002' };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': {
        status: 200,
        body: { items: [order('pending')], nextCursor: '50' },
      },
      'GET /v1/online-orders?status=pending&cursor=50': {
        status: 200,
        body: { items: [second], nextCursor: null },
      },
      'GET /v1/online-orders/cod': { status: 200, body: { currency: 'SYP', couriers: [] } },
    });
    const { user } = renderApp('/online-store');
    await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(await screen.findByRole('listitem', { name: 'الطلب ONL-000002' })).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/online-orders?status=pending&cursor=50')).toHaveLength(1);
  });
});

describe('round 48: the tabs say how many orders each holds', () => {
  it('counts the waiting, the accepted and all orders on the pills, and a skeleton shaped like an order meanwhile', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings },
      'GET /v1/online-orders?status=pending': {
        status: 200,
        body: { items: [order('pending')], nextCursor: null, counts: { pending: 3, accepted: 5, all: 12 } },
      },
      'GET /v1/online-orders/cod': { status: 200, body: { currency: 'SYP', couriers: [] } },
    });
    renderApp('/online-store');
    expect(await screen.findByRole('radio', { name: 'بانتظار المحل (3)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'مقبولة (5)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'الكل (12)' })).toBeInTheDocument();
  });
});

describe('a delivery fee as typed', () => {
  it('reads digits (Arabic too) and refuses what is not a fee instead of making it free or tenfold', () => {
    expect(feeOf('1500', 0)).toBe(1500);
    expect(feeOf('1,500', 0)).toBe(1500);
    expect(feeOf('١٥٠٠', 0)).toBe(1500);
    expect(feeOf('', 0)).toBe(0);
    expect(feeOf('12.5', 2)).toBe(1250);
    expect(feeOf('١٢٫٥', 2)).toBe(1250);
    expect(feeOf('abc', 0)).toBeNull();
    expect(feeOf('1,5', 0)).toBeNull();
    expect(feeOf('1.5', 0)).toBeNull();
    expect(feeOf('-3', 0)).toBeNull();
    expect(feeOf('1..5', 2)).toBeNull();
  });

  it('saves «توصيل مجاني فوق مبلغ» in minor units, refuses a typo, and clears it when emptied', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: { ...settings, version: 1 } },
      'PUT /v1/online-store': (r: MockRequest) => ({
        status: 200,
        body: { ...(r.body as OnlineStoreSettings), version: 2 },
      }),
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders/cod': { status: 200, body: { currency: 'SYP', couriers: [] } },
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'إعدادات المتجر' }));
    const field = await screen.findByLabelText('توصيل مجاني فوق مبلغ');
    // Arabic-Indic digits and the thousands comma are read
    await user.type(field, '٥٠٠٠٠');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await screen.findByText(/حُفظ/);
    expect(requestsTo('PUT', '/v1/online-store')[0]!.body).toMatchObject({
      freeDeliveryOverMinor: 5_000_000,
    });
    // A typo is told on the field and nothing is sent with it
    await user.clear(field);
    await user.type(field, '12ab');
    expect(await screen.findByText(/اكتب رقماً صحيحاً، مثل 500000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'احفظ' })).toBeDisabled();
    // Emptied: no offer
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await screen.findByText(/حُفظ/);
    expect(requestsTo('PUT', '/v1/online-store')[1]!.body).toMatchObject({ freeDeliveryOverMinor: null });
  });
});
