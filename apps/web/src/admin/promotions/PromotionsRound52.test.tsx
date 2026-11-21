import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, OnlineStoreSettings, Promotion, PromotionReport } from '@serva/core';
import { isoDay } from '../../lib/dates';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { periodRange } from '../reports/periods';

/** Round 52: the end date from the list, removing a stopped offer for good, the free-delivery line. */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage', 'settings.manage'] },
  };
}

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p-1',
  name: 'تنزيلات الشتاء',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'all',
  categoryIds: [],
  productIds: [],
  startsAt: null,
  endsAt: '2030-11-30T21:00:00.000Z',
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  couponCode: null,
  archived: false,
  version: 1,
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

const month = () => periodRange('month', isoDay(Date.now(), makeMe().tenant.timezone));
const emptyReport: PromotionReport = { ...month(), items: [] };

const shop = (over: Partial<OnlineStoreSettings> = {}): OnlineStoreSettings => ({
  version: 1,
  enabled: true,
  slug: 'nour',
  whatsapp: '0933123456',
  delivery: true,
  pickup: true,
  note: null,
  showOutOfStock: false,
  orderMode: 'whatsapp',
  showPrices: true,
  deliveryFeeMinor: 10_000,
  deliveryAreas: [],
  ...over,
});

function open(items: Promotion[], store: OnlineStoreSettings | null = shop()) {
  let list = items;
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: owner() },
    'GET /v1/promotions': () => ({ status: 200, body: { items: list } }),
    'GET /v1/categories': { status: 200, body: { items: [] } },
    'GET /v1/products?limit=200': { status: 200, body: { items: [], nextCursor: null } },
    'GET /v1/online-store': store
      ? { status: 200, body: store }
      : apiError(403, 'forbidden', 'ليس لديك صلاحية'),
    [`GET /v1/promotions/report?from=${month().from}&to=${month().to}`]: { status: 200, body: emptyReport },
    'POST /v1/promotions/p-1/end-date': (r: MockRequest) => {
      const body = r.body as { endsAt: string | null };
      list = list.map((p) => (p.id === 'p-1' ? { ...p, endsAt: body.endsAt, version: p.version + 1 } : p));
      return { status: 200, body: list[0] };
    },
    'DELETE /v1/promotions/p-1?version=1': () => {
      list = [];
      return { status: 204 };
    },
  });
  return { ...mock, ...renderApp('/promotions') };
}

describe('round 52: the offers list', () => {
  it('moves the end date of an offer from the list, sending only the end', async () => {
    const { user, requestsTo } = open([promo()]);
    await user.click(await screen.findByRole('button', { name: 'تاريخ انتهاء تنزيلات الشتاء' }));
    const form = await screen.findByRole('form', { name: 'تاريخ الانتهاء' });
    const field = within(form).getByLabelText('حتى تاريخ');
    // The stored end is the first moment after the last day: the field shows the last day itself
    expect(field).toHaveValue('30/11/2030');
    await user.clear(field);
    await user.type(field, '31/12/2030');
    await user.click(within(form).getByRole('button', { name: 'احفظ التاريخ' }));
    expect(
      await screen.findByText(/صار «تنزيلات الشتاء» ينتهي في آخر يوم من 31\/12\/2030/),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/promotions/p-1/end-date').at(-1)?.body).toEqual({
      version: 1,
      endsAt: '2030-12-31T21:00:00.000Z',
    });
  });

  it('a stopped offer has no delete button, only start', async () => {
    const { user, requestsTo } = open([promo({ archived: true })]);
    await user.click(await screen.findByRole('button', { name: /أظهر المتوقفة والمنتهية/ }));
    expect(await screen.findByRole('button', { name: 'شغّل' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /نهائياً/ })).toBeNull();
    expect(requestsTo('DELETE', '/v1/promotions/p-1?version=1')).toHaveLength(0);
  });

  it('shows the free-delivery line of the store with a way to change it', async () => {
    open([promo()], shop({ freeDeliveryOverMinor: 5_000_000 }));
    const panel = await screen.findByText('توصيل مجاني فوق مبلغ');
    expect(panel).toBeInTheDocument();
    expect(await screen.findByText(/يوصَّل بلا أجرة في المتجر/)).toHaveTextContent('50,000');
    expect(screen.getByRole('link', { name: 'غيّر المبلغ' })).toHaveAttribute('href', '/online-store');
  });

  it('offers to turn it on when there is none', async () => {
    open([promo()], shop());
    expect(await screen.findByRole('link', { name: 'فعّله' })).toBeInTheDocument();
  });

  it('hides the line for someone who cannot read the store', async () => {
    open([promo()], null);
    expect(await screen.findByRole('button', { name: 'تاريخ انتهاء تنزيلات الشتاء' })).toBeInTheDocument();
    expect(screen.queryByText('توصيل مجاني فوق مبلغ')).toBeNull();
  });
});
