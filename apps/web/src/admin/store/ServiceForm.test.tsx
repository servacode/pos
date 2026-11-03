import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, ModifierGroup, StoreResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { ModifiersEditor } from '../products/ModifiersEditor';

const store: StoreResponse = {
  name: 'مقهى الشام',
  legalName: null,
  taxNumber: null,
  sectors: ['cafe'],
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
};

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] } };
}

describe('«الصالة والمطبخ» in the settings', () => {
  it('turns the hall on with its tables, numbers and kitchen tickets', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: store }),
      'PUT /v1/store/service': (r: MockRequest) => ({
        status: 200,
        body: { ...store, ...(r.body as Partial<StoreResponse>) },
      }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'الصالة والمطبخ' });
    await user.click(within(form).getByRole('switch', { name: /مطعم أو مقهى/ }));
    const tables = within(form).getByLabelText('الطاولات');
    await user.clear(tables);
    await user.type(tables, '1-4، تراس');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظت/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/service').at(-1)?.body).toEqual({
      service: { tables: ['1', '2', '3', '4', 'تراس'], orderNumbers: true, kitchenTickets: true },
    });
  });
});

describe('ModifiersEditor', () => {
  it('adds a group with two options and a price, and removes an option', async () => {
    let last: ModifierGroup[] = [];
    function Harness() {
      const [groups, setGroups] = useState<ModifierGroup[]>([]);
      last = groups;
      return <ModifiersEditor groups={groups} currency="SYP" onChange={setGroups} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'مجموعة خيارات' }));
    await user.type(screen.getByLabelText('اسم المجموعة'), 'الحجم');
    await user.type(screen.getByLabelText('الخيار'), 'وسط');
    await user.click(screen.getByRole('button', { name: 'خيار آخر' }));
    await user.type(screen.getAllByLabelText('الخيار')[1]!, 'كبير');
    await user.type(screen.getAllByLabelText('يزيد السعر')[1]!, '50');
    await user.click(screen.getByRole('switch', { name: 'مطلوب' }));
    expect(last).toEqual([
      {
        name: 'الحجم',
        multiple: false,
        required: true,
        options: [
          { name: 'وسط', priceMinor: 0 },
          { name: 'كبير', priceMinor: 5_000 },
        ],
      },
    ]);
    await user.click(screen.getByRole('button', { name: 'احذف وسط' }));
    expect(last[0]!.options.map((o) => o.name)).toEqual(['كبير']);
  });
});
