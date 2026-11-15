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

  it('edits the banknotes: adds one, removes one, refuses a repeat, and sends only a changed list', async () => {
    const current = {
      ...store(['supermarket']),
      enabledCurrencies: ['SYP', 'USD'] as StoreResponse['enabledCurrencies'],
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
      'PUT /v1/store/till': (r: MockRequest) => ({ status: 200, body: { ...current, till: r.body } }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصندوق' });
    const syp = within(form).getByRole('group', { name: 'فئات ليرة سورية' });
    const usd = within(form).getByRole('group', { name: 'فئات دولار أمريكي' });
    const chips = (group: HTMLElement) =>
      within(group)
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(chips(syp)).toEqual(['5000', '2000', '1000', '500', '200', '100', '50', '25', '10']);

    await user.type(within(syp).getByLabelText('أضف فئة ليرة سورية'), '20000');
    await user.click(within(syp).getByRole('button', { name: 'أضف' }));
    await user.type(within(syp).getByLabelText('أضف فئة ليرة سورية'), '100{Enter}');
    expect(within(syp).getByText('هذه الفئة موجودة')).toBeInTheDocument();
    await user.clear(within(syp).getByLabelText('أضف فئة ليرة سورية'));
    await user.type(within(syp).getByLabelText('أضف فئة ليرة سورية'), '0{Enter}');
    expect(within(syp).getByText('اكتب عدداً صحيحاً أكبر من صفر')).toBeInTheDocument();
    await user.click(within(syp).getByRole('button', { name: 'احذف فئة 25 ل.س' }));
    expect(chips(syp)).toEqual(['20000', '5000', '2000', '1000', '500', '200', '100', '50', '10']);

    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ/)).toBeInTheDocument();
    expect((requestsTo('PUT', '/v1/store/till').at(-1)?.body as { cashNotes: unknown }).cashNotes).toEqual({
      SYP: [20000, 5000, 2000, 1000, 500, 200, 100, 50, 10],
    });

    await user.click(within(syp).getByRole('button', { name: 'أعد الافتراضي' }));
    expect(chips(syp)).toEqual(['5000', '2000', '1000', '500', '200', '100', '50', '25', '10']);
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await within(form).findByText(/حُفظ/);
    expect(requestsTo('PUT', '/v1/store/till').at(-1)?.body).not.toHaveProperty('cashNotes');
    expect(chips(usd)).toEqual(['100', '50', '20', '10', '5', '1']);
  });

  it('will not save a currency with no note left', async () => {
    const current = store(['supermarket']);
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: current }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصندوق' });
    for (const v of [5000, 2000, 1000, 500, 200, 100, 50, 25, 10]) {
      await user.click(within(form).getByRole('button', { name: `احذف فئة ${v} ل.س` }));
    }
    expect(within(form).getByText('أبقِ فئة واحدة على الأقل.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'احفظ' })).toBeDisabled();
  });
});
