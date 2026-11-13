import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('counting the shelf by scanning (03 › الألبسة)', () => {
  it('adds a piece for each scan and a whole pack for a pack code, then saves what was counted', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory': () => ({ status: 200, body: stock }),
      'GET /v1/barcodes/2900000000018': {
        status: 200,
        body: { productId: 'p', variantId: 'v-1', barcode: { code: '2900000000018', packQty: 1000 } },
      },
      'GET /v1/barcodes/6281000000001': {
        status: 200,
        body: { productId: 'p', variantId: 'v-1', barcode: { code: '6281000000001', packQty: 12_000 } },
      },
      'GET /v1/barcodes/999': { status: 404, body: { error: { code: 'not_found', message: 'لا' } } },
      'POST /v1/stocktakes': {
        status: 201,
        body: {
          id: 's-2',
          number: 'STK-0002',
          date: '2026-10-30',
          branchId: 'b-1',
          lines: [],
          diffValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies StocktakeDetail,
      },
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('button', { name: 'جرد الرفوف' }));
    const field = screen.getByLabelText('امسح الباركود');
    await user.type(field, '2900000000018{Enter}');
    await user.type(field, '2900000000018{Enter}');
    const form = screen.getByRole('form', { name: 'العدّ بالمسح' });
    await vi.waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('بندورة: 2'));
    await user.type(field, '6281000000001{Enter}');
    await vi.waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('بندورة: 14'));
    expect(screen.getByLabelText('المعدود من بندورة')).toHaveValue('14');
    await user.type(field, '999{Enter}');
    expect(await screen.findByText('لا صنف بالباركود 999.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'راجع الجرد' }));
    expect(await screen.findByRole('table', { name: 'فروق الجرد' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل الجرد' }));
    expect(await screen.findByText(/سُجّل الجرد STK-0002/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/stocktakes')[0]?.body).toMatchObject({
      lines: [{ variantId: 'v-1', countedQty: 14_000 }],
    });
  });
});

describe('counting the shelf by hand', () => {
  it('refuses a negative count with a message and keeps the review closed', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory': () => ({ status: 200, body: stock }),
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('button', { name: 'جرد الرفوف' }));
    await user.type(screen.getByLabelText('المعدود من بندورة'), '-3');
    expect(await screen.findByText(/العدد لا يكون سالباً/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'راجع الجرد' })).toBeDisabled();
  });
});
