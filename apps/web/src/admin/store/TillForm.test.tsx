import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, StoreResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const store = (sectors: StoreResponse['sectors']): StoreResponse => ({
  name: 'محل الأزياء',
  legalName: null,
  taxNumber: null,
  sectors,
  address: null,
  phone: null,
  receiptFooter: null,
  baseCurrency: 'SYP',
  enabledCurrencies: ['SYP'],
  taxInclusive: true,
  usdRate: null,
  onboarding: { step: 4, done: true },
  scaleBarcode: null,
  service: null,
  loyalty: null,
  pharmacy: null,
  till: null,
});

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] } };
}

describe('«الصندوق» in the settings', () => {
  it('shows the default window of the business type, saves the owner’s number and the card rule', async () => {
    const current = store(['clothing']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/till': (r: MockRequest) => ({ status: 200, body: { ...current, till: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصندوق' });
    expect(within(form).getByText(/30 يوماً/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText('أيام قبول المرتجع'), '14');
    await user.click(within(form).getByRole('switch', { name: /رقم الموافقة إلزامي/ }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/till').at(-1)?.body).toMatchObject({
      returnWindowDays: 14,
      cardApprovalRequired: true,
      // The warranty rules: off for a supermarket until the owner turns them on
      warrantyAskCustomer: false,
      warrantyTerms: null,
    });
  });

  it('saves «امنع البيع فوق المخزون», off until turned on', async () => {
    const current = store(['supermarket']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/till': (r: MockRequest) => ({ status: 200, body: { ...current, till: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصندوق' });
    const block = within(form).getByRole('switch', { name: /امنع البيع فوق المخزون/ });
    expect(block).not.toBeChecked();
    await user.click(block);
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/till').at(-1)?.body).toMatchObject({ blockNegativeStock: true });
  });

  it('refuses a window outside 1 to 365 and shows a failed save', async () => {
    const current = store(['supermarket']);
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/till': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'تعذّر الحفظ.' } },
      }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصندوق' });
    expect(within(form).getByText(/7 يوماً/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText('أيام قبول المرتجع'), '999');
    expect(within(form).getByText('اكتب عدداً من 1 إلى 365')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'احفظ' })).toBeDisabled();
    await user.clear(within(form).getByLabelText('أيام قبول المرتجع'));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/تعذّر الحفظ|حدث خطأ/)).toBeInTheDocument();
  });
});
