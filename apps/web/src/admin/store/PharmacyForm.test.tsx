import { screen, waitFor, within } from '@testing-library/react';
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

  it('saves «امنع البيع بلا دفعة صالحة», off until turned on', async () => {
    const current = store(['pharmacy']);
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': (r: MockRequest) => ({ status: 200, body: { ...current, pharmacy: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    const block = within(form).getByRole('switch', { name: /امنع البيع بلا دفعة صالحة/ });
    expect(block).not.toBeChecked();
    await user.click(block);
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).toMatchObject({ blockNoBatch: true });
  });

  it('saves «يجوز بيع المنتهي برمز المدير»: off for a pharmacy that blocks, written only once it is changed', async () => {
    const current: StoreResponse = {
      ...store(['pharmacy']),
      pharmacy: { prescription: 'optional', blockNoBatch: true },
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/pharmacy': (r: MockRequest) => ({ status: 200, body: { ...current, pharmacy: r.body } }),
    });
    const { user } = renderApp('/settings');
    const formNow = () => screen.findByRole('form', { name: 'الصيدلية' });
    const allow = within(await formNow()).getByRole('switch', { name: /يجوز بيع المنتهي برمز المدير/ });
    expect(allow).not.toBeChecked();
    // Another change saved on its own: the setting is not written, so the store keeps its older rule
    await user.click(within(await formNow()).getByRole('switch', { name: /إلزاميان/ }));
    await user.click(within(await formNow()).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText(/حُفظ/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).not.toHaveProperty('allowExpiredWithCode');
    await user.click(within(await formNow()).getByRole('switch', { name: /يجوز بيع المنتهي برمز المدير/ }));
    await user.click(within(await formNow()).getByRole('button', { name: 'احفظ' }));
    await waitFor(() => expect(requestsTo('PUT', '/v1/store/pharmacy')).toHaveLength(2));
    expect(requestsTo('PUT', '/v1/store/pharmacy').at(-1)?.body).toMatchObject({
      allowExpiredWithCode: true,
    });
  });

  it('reads an owner’s earlier choice, and a store that never chose as allowing the manager', async () => {
    const current: StoreResponse = {
      ...store(['pharmacy']),
      pharmacy: { prescription: 'optional', blockNoBatch: false, allowExpiredWithCode: false },
    };
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
    });
    renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصيدلية' });
    expect(within(form).getByRole('switch', { name: /يجوز بيع المنتهي برمز المدير/ })).not.toBeChecked();
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
    const form = await screen.findByRole('form', { name: 'الدفعات والصلاحية' });
    expect(within(form).queryByRole('switch', { name: /الدواء المراقَب/ })).toBeNull();
    // No prescription and no «medicines» outside a pharmacy: the policy is worded for medical supplies
    expect(within(form).queryByRole('switch', { name: /إلزاميان/ })).toBeNull();
    expect(within(form).queryByText(/الطبيب|الوصفة/)).toBeNull();
    expect(within(form).getByRole('group', { name: 'مرتجع المستهلكات الطبية' })).toBeInTheDocument();
    expect(within(form).queryByText(/مرتجع الأدوية|للأدوية/)).toBeNull();
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
    // The save bar waits for an edit
    expect(within(form).queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
    await user.click(within(form).getByRole('switch', { name: /إلزاميان/ }));
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
