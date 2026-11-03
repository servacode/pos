import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InventoryResponse, MeResponse, StocktakeDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'cost.view', 'inventory.adjust'] },
  };
}

const stock: InventoryResponse = {
  items: [
    {
      variantId: 'v-1',
      name: 'بندورة',
      branchId: 'b-1',
      qty: 12_500,
      valueMinor: 250_000,
      unitCostMinor: 20,
    },
  ],
  totalValueMinor: 250_000,
  baseCurrency: 'SYP',
};

describe('«سجّل هدراً» (03 › الخضار والمخابز)', () => {
  it('takes what spoiled out of stock as a count of what is left, noted «هدر»', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory': () => ({ status: 200, body: stock }),
      'POST /v1/stocktakes': (_r: MockRequest) => ({
        status: 201,
        body: {
          id: 's-1',
          number: 'STK-0001',
          date: '2026-10-30',
          branchId: 'b-1',
          lines: [],
          diffValueMinor: -50_000,
          baseCurrency: 'SYP',
        } satisfies StocktakeDetail,
      }),
    });
    const { user } = renderApp('/inventory');
    const form = await screen.findByRole('form', { name: 'سجّل هدراً' });
    await user.selectOptions(within(form).getByLabelText('الصنف التالف'), 'b-1:v-1');
    await user.type(within(form).getByLabelText('كمية الهدر'), '2.5');
    await user.click(within(form).getByRole('button', { name: 'سجّل الهدر' }));
    expect(await screen.findByText(/سُجّل الجرد STK-0001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/stocktakes').at(-1)?.body).toMatchObject({
      branchId: 'b-1',
      note: 'هدر',
      lines: [{ variantId: 'v-1', countedQty: 10_000 }],
    });
  });
});
