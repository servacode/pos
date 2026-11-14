import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, Promotion } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage', 'settings.manage'] },
  };
}

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p-1',
  name: 'خصم الصيف',
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

describe('«كود الخصم» on a promotion', () => {
  it('saves the code the customer types in the shop cart, and shows it on the card', async () => {
    let items: Promotion[] = [];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/promotions': () => ({ status: 200, body: { items } }),
      'GET /v1/categories': { status: 200, body: { items: [] } },
      'GET /v1/products?limit=200': { status: 200, body: { items: [], nextCursor: null } },
      'POST /v1/promotions': (r: MockRequest) => {
        const body = r.body as Partial<Promotion>;
        if (body.couponCode === 'USED')
          return apiError(400, 'validation_failed', 'تحقّق', { couponCode: 'هذا الكود لعرض آخر، اختر غيره' });
        const made = promo({
          ...body,
          couponCode: body.couponCode?.toUpperCase() ?? null,
        } as Partial<Promotion>);
        items = [made];
        return { status: 201, body: made };
      },
    });
    const { user } = renderApp('/promotions');
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'خصم الصيف');
    await user.type(within(form).getByLabelText('نسبة الخصم %'), '10');
    await user.type(within(form).getByLabelText('الكود (اختياري)'), 'USED');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('هذا الكود لعرض آخر، اختر غيره')).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('الكود (اختياري)'));
    await user.type(within(form).getByLabelText('الكود (اختياري)'), 'summer10');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    const list = await screen.findByRole('list', { name: 'العروض' });
    expect(await within(list).findByText('SUMMER10')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({ couponCode: 'summer10' });
  });

  it('sends none when the field is left empty', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/promotions': { status: 200, body: { items: [] } },
      'GET /v1/categories': { status: 200, body: { items: [] } },
      'GET /v1/products?limit=200': { status: 200, body: { items: [], nextCursor: null } },
      'POST /v1/promotions': (r: MockRequest) => ({
        status: 201,
        body: promo(r.body as Partial<Promotion>),
      }),
    });
    const { user } = renderApp('/promotions');
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'خصم');
    await user.type(within(form).getByLabelText('نسبة الخصم %'), '10');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await vi.waitFor(() => expect(requestsTo('POST', '/v1/promotions')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/promotions')[0]!.body).toMatchObject({ couponCode: null });
  });
});
