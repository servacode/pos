import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, type MeResponse, type StoreResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** Round 38, #35: the scale label format editor with its live test box */

const store: StoreResponse = {
  name: 'سوبرماركت الفرات',
  legalName: null,
  taxNumber: null,
  sectors: ['supermarket'],
  address: null,
  phone: null,
  receiptFooter: null,
  baseCurrency: 'SYP',
  enabledCurrencies: ['SYP'],
  taxInclusive: true,
  usdRate: null,
  onboarding: { step: 4, done: true },
  scaleBarcode: {
    prefixes: ['21'],
    itemDigits: 5,
    valueKind: 'weight',
    valueDecimals: 3,
  },
  service: null,
  loyalty: null,
};

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] } };
}

const label = (first12: string) => `${first12}${ean13CheckDigit(first12)}`;

function routes(extra: Record<string, (r: MockRequest) => { status: number; body?: unknown }> = {}) {
  return {
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/store': () => ({ status: 200, body: store }),
    'PUT /v1/store/scale': (r: MockRequest) => ({
      status: 200,
      body: { ...store, ...(r.body as Partial<StoreResponse>) },
    }),
    ...extra,
  };
}

describe('the scale format editor', () => {
  it('saves a value length and a label with no check digit, and tells the label length', async () => {
    const { requestsTo } = mockFetch(routes());
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'باركود الميزان' });
    expect(within(form).getByText(/طول الملصق 13 خانة/)).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('خانات الوزن أو السعر'), '6');
    await user.click(within(form).getByRole('switch', { name: /آخر خانة رقم تحقق/ }));
    expect(within(form).getByText(/طول الملصق 13 خانة: بادئة 2 \+ صنف 5 \+ قيمة 6$/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ باركود الميزان/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/scale').at(-1)?.body).toEqual({
      scaleBarcode: {
        prefixes: ['21'],
        itemDigits: 5,
        valueKind: 'weight',
        valueDecimals: 3,
        valueDigits: 6,
        checkDigit: false,
      },
    });
  });

  it('the test box cuts a label into its parts, reads the weight and finds the product', async () => {
    mockFetch(
      routes({
        'GET /v1/barcodes/00123?free=1': () => ({
          status: 200,
          body: {
            productId: 'p-1',
            variantId: 'v-1',
            barcode: { id: 'b-1', code: '00123', kind: 'standard', packQty: 1000 },
          },
        }),
        'GET /v1/products/p-1': () => ({
          status: 200,
          body: {
            id: 'p-1',
            nameAr: 'جبنة بيضاء',
            variants: [{ id: 'v-1', price: { currency: 'SYP', priceMinor: 80_000 } }],
          },
        }),
      }),
    );
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'باركود الميزان' });
    const box = within(form).getByLabelText('جرّب ملصقاً');
    // 1.250 kg of item 00123
    await user.type(box, label('210012301250'));
    expect(await within(form).findByText('جبنة بيضاء')).toBeInTheDocument();
    expect(form.textContent).toMatch(/الوزن\s*1\.250/);
    // 1.25 kg at 800 a kilo = 1,000
    expect(form.textContent).toMatch(/الكاشير يسجّل/);
    expect(form.textContent).toMatch(/1[,٬]?000/);
  });

  it('says why a code is not a label of this format', async () => {
    mockFetch(routes());
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'باركود الميزان' });
    const box = within(form).getByLabelText('جرّب ملصقاً');
    await user.type(box, '12345');
    expect(await within(form).findByText(/ليس ملصق ميزان بهذا الشكل/)).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, label('300012301250'));
    expect(await within(form).findByText(/ليست من بادئات الميزان/)).toBeInTheDocument();
    await user.clear(box);
    await user.type(
      box,
      `${label('210012301250').slice(0, 12)}${(Number(label('210012301250')[12]) + 1) % 10}`,
    );
    expect(await within(form).findByText(/خانة التحقق الأخيرة لا تطابق/)).toBeInTheDocument();
  });
});
