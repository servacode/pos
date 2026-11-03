import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, OnlineOrder, OnlineStoreSettings } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage', 'customers.view'] },
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
};

const order = (status: OnlineOrder['status']): OnlineOrder => ({
  id: 'o-1',
  number: 'ONL-000001',
  status,
  source: 'whatsapp',
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
      'POST /v1/online-orders/o-1/status': (r: MockRequest) => {
        current = { ...current, status: (r.body as { status: OnlineOrder['status'] }).status, version: 2 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
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
