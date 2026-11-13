import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, StoreResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const store = (sectors: StoreResponse['sectors']): StoreResponse => ({
  name: 'صيدلية الشفاء',
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
  pharmacy: sectors.includes('pharmacy') ? { prescription: 'optional' } : null,
});

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] } };
}

describe('«الصيدلية» in the settings', () => {
  it('makes the prescription required for a pharmacy and saves it', async () => {
    const current = store(['pharmacy']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': (r: MockRequest) => ({
        status: 200,
        body: { ...current, pharmacy: r.body },
      }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    await user.click(within(form).getByRole('switch', { name: /إلزاميان/ }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).toEqual({
      prescription: 'required',
      returns: 'sealed',
      controlledReturns: false,
      autoBatch: true,
    });
  });

  it('sets the return policy and lets the controlled drugs come back, for a pharmacy', async () => {
    const current = store(['pharmacy']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': (r: MockRequest) => ({ status: 200, body: { ...current, pharmacy: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    expect(within(form).getByRole('radio', { name: /المغلقة فقط بتأكيد/ })).toBeChecked();
    await user.click(within(form).getByRole('radio', { name: /لا مرتجع للأدوية/ }));
    await user.click(within(form).getByRole('switch', { name: /الدواء المراقَب/ }));
    await user.click(within(form).getByRole('switch', { name: /اختر الدفعة تلقائياً/ }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).toEqual({
      prescription: 'optional',
      returns: 'none',
      controlledReturns: true,
      autoBatch: false,
    });
  });

  it('gives medical supplies the return policy and a batch switch that is off until turned on', async () => {
    const current = store(['medical_supplies']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': (r: MockRequest) => ({ status: 200, body: { ...current, pharmacy: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    expect(within(form).queryByRole('switch', { name: /الدواء المراقَب/ })).toBeNull();
    const batch = within(form).getByRole('switch', { name: /اختر الدفعة تلقائياً/ });
    expect(batch).not.toBeChecked();
    await user.click(batch);
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).toMatchObject({
      returns: 'sealed',
      autoBatch: true,
    });
  });

  it('gives a store with expiry dates only the batch switch', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: store(['supermarket']) }),
    });
    renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الدفعات والصلاحية' });
    expect(within(form).getByRole('switch', { name: /اختر الدفعة تلقائياً/ })).not.toBeChecked();
    expect(within(form).queryByRole('radio')).toBeNull();
  });

  it('shows the error when saving fails, and is absent for another business type', async () => {
    const current = store(['pharmacy']);
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'تعذّر الحفظ.' } },
      }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/تعذّر الحفظ|حدث خطأ/)).toBeInTheDocument();
  });

  it('is not offered to a shop that is not a pharmacy', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: store(['supermarket']) }),
    });
    renderApp('/settings');
    await screen.findByRole('form', { name: 'نقاط الولاء' });
    expect(screen.queryByRole('form', { name: 'الصيدلية' })).toBeNull();
  });
});
