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
    // The form is in a window opened by its own button, not the first block of the page
    expect(screen.queryByRole('form', { name: 'سجّل هدراً' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'سجّل هدراً' }));
    const form = await screen.findByRole('form', { name: 'سجّل هدراً' });
    await user.selectOptions(within(form).getByLabelText('الصنف التالف'), 'b-1:v-1');
    await user.type(within(form).getByLabelText('كمية الهدر'), '2.5');
    await user.click(within(form).getByRole('button', { name: 'سجّل الهدر' }));
    // Nothing leaves the stock until it is confirmed
    expect(requestsTo('POST', '/v1/stocktakes')).toHaveLength(0);
    await user.click(within(form).getByRole('button', { name: 'أكّد الهدر' }));
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

describe('شبكة المقاس واللون في المخزون', () => {
  it('lays a model out with sizes down and colours across, and goes back to the list', async () => {
    const piece = (id: string, size: string, colour: string, qty: number) => ({
      variantId: id,
      name: `قميص ${size} · ${colour}`,
      productId: 'p-1',
      productName: 'قميص',
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: colour },
      ],
      branchId: 'b-1',
      qty,
      valueMinor: 0,
      unitCostMinor: null,
    });
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory': () => ({
        status: 200,
        body: {
          items: [piece('a', 'M', 'أبيض', 3000), piece('b', 'L', 'أبيض', 0), piece('c', 'M', 'أزرق', 5000)],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies InventoryResponse,
      }),
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('radio', { name: 'شبكة المقاس واللون' }));
    const grid = await screen.findByRole('region', { name: 'شبكة قميص' });
    expect(within(grid).getByRole('columnheader', { name: 'أزرق' })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: 'L' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'قائمة' }));
    expect(await screen.findByRole('table', { name: 'المخزون' })).toBeInTheDocument();
  });
});

describe('a clothing shop’s inventory', () => {
  it('opens on the size × colour grids, thinnest model first, with row and column totals', async () => {
    const piece = (id: string, product: string, size: string, color: string, qty: number) => ({
      variantId: id,
      productId: product,
      productName: product === 'p-1' ? 'قميص' : 'بنطال',
      name: `${product} ${size} ${color}`,
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: color },
      ],
      branchId: 'b-1',
      qty,
      valueMinor: 0,
      unitCostMinor: 0,
    });
    const base = owner();
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: { ...base, tenant: { ...base.tenant, sectors: ['clothing'] } },
      }),
      'GET /v1/inventory': () => ({
        status: 200,
        body: {
          ...stock,
          items: [
            piece('a', 'p-1', 'S', 'أحمر', 3000),
            piece('b', 'p-1', 'M', 'أحمر', 4000),
            piece('c', 'p-1', 'S', 'أزرق', 1000),
            piece('d', 'p-1', 'M', 'أزرق', 2000),
            piece('e', 'p-2', 'S', 'أسود', 0),
            piece('f', 'p-2', 'M', 'أسود', 9000),
          ],
        } satisfies InventoryResponse,
      }),
    });
    renderApp('/inventory');
    const grids = await screen.findAllByRole('region', { name: /شبكة/ });
    // «بنطال» has a size at zero: it comes first
    expect(grids[0]).toHaveAccessibleName('شبكة بنطال');
    const shirt = within(screen.getByRole('region', { name: 'شبكة قميص' }));
    // Totals: the S row 3 + 1, the whole grid 10
    expect(shirt.getAllByText('المجموع').length).toBeGreaterThan(0);
    expect(shirt.getByText('10')).toBeInTheDocument();
    // 4 is a cell (M red) and also the S row's total
    expect(shirt.getAllByText('4')).toHaveLength(2);
  });
});
