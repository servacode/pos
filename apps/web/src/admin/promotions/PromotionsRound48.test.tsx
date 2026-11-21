import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, Promotion, PromotionReport } from '@serva/core';
import { isoDay } from '../../lib/dates';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { periodRange } from '../reports/periods';

/** Round 48: the name error first, the products an offer reaches, the stopped list, the report. */

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
  endsAt: null,
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
const reportKey = () => `GET /v1/promotions/report?from=${month().from}&to=${month().to}`;
const report = (items: PromotionReport['items']): PromotionReport => ({ ...month(), items });

describe('round 48: the offers page', () => {
  it('says the name is missing on its own field, before anything is sent', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/promotions': { status: 200, body: { items: [] } },
      'GET /v1/categories': { status: 200, body: { items: [] } },
      'GET /v1/products?limit=200': { status: 200, body: { items: [], nextCursor: null } },
      'POST /v1/promotions/preview': {
        status: 200,
        body: { products: 12, shopProducts: 10, sample: ['حليب', 'جبنة'] },
      },
      [reportKey()]: { status: 200, body: report([]) },
    });
    const { user } = renderApp('/promotions');
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('نسبة الخصم %'), '10');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    const name = within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال');
    expect(await within(form).findByText('اسم العرض مطلوب')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(requestsTo('POST', '/v1/promotions')).toHaveLength(0);
    expect(within(form).getByTestId('promotion-sample')).toHaveTextContent('90,000');
    // The products the offer reaches are counted while the owner decides
    expect(await within(form).findByTestId('promotion-reach')).toHaveTextContent('يطال 12 منتجاً في الكاشير');
  });

  it('keeps stopped offers out of sight until asked, and shows what each offer did in the month', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/promotions': {
        status: 200,
        body: {
          items: [
            promo(),
            promo({ id: 'p-2', name: 'تجربة قديمة', archived: true }),
            promo({ id: 'p-3', name: 'تجربة 2', archived: true }),
          ],
        },
      },
      [reportKey()]: {
        status: 200,
        body: report([
          {
            name: 'تنزيلات الشتاء',
            currency: 'SYP',
            invoices: 4,
            pieces: 9,
            returnedPieces: 0,
            discountMinor: 9_000_000,
            netMinor: 81_000_000,
            freePieces: 0,
          },
        ]),
      },
    });
    const { user } = renderApp('/promotions');
    const list = await screen.findByRole('table', { name: 'العروض' });
    expect(await within(list).findByText('تنزيلات الشتاء')).toBeInTheDocument();
    expect(within(list).queryByText('تجربة قديمة')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /أظهر المتوقفة والمنتهية \(2\)/ }));
    expect(await within(list).findByText('تجربة قديمة')).toBeInTheDocument();
    const perf = await screen.findByRole('table', { name: 'أداء العروض' });
    expect(await within(perf).findByText('تنزيلات الشتاء')).toBeInTheDocument();
    expect(perf).toHaveTextContent('90,000');
    expect(perf).toHaveTextContent('810,000');
  });

  it('says why an offer could not be restarted', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/promotions': {
        status: 200,
        body: { items: [promo({ archived: true, couponCode: 'OLD10', repOnly: true })] },
      },
      'POST /v1/promotions/p-1/archive': (_r: MockRequest) =>
        apiError(400, 'validation_failed', 'تحقّق', { couponCode: 'الكود لا يعمل مع عرض مخصص لفئة' }),
      [reportKey()]: { status: 200, body: report([]) },
    });
    const { user } = renderApp('/promotions');
    await user.click(await screen.findByRole('button', { name: /أظهر المتوقفة والمنتهية/ }));
    await user.click(await screen.findByRole('button', { name: 'شغّل' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
