import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InventoryResponse, MeResponse, ProfitReport } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { isoDay } from '../../lib/dates';

/** Round 64 (inventory): the stock page says when numbers are out of step, the profit sits in the figures card, the serial page says a cut list */

const keeper = (sectors: MeResponse['tenant']['sectors']): MeResponse => {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [
        ...base.user.permissions,
        'cost.view',
        'inventory.adjust',
        'catalog.manage',
        'reports.financial',
      ],
    },
    tenant: { ...base.tenant, sectors },
  };
};
const stock: InventoryResponse = {
  items: [
    {
      variantId: 'v-1',
      name: 'جوال',
      branchId: 'b-main',
      branchName: 'الفرع الرئيسي',
      branchKind: 'store',
      qty: 3000,
      valueMinor: 3_000_000,
      unitCostMinor: 1000,
      tracksSerial: true,
    },
  ],
  totalValueMinor: 3_000_000,
  baseCurrency: 'SYP',
  asOf: '2026-11-22T10:00:00.000Z',
};
const profit: ProfitReport = {
  netSalesMinor: 5_000_000,
  costOfSalesMinor: 3_000_000,
  grossProfitMinor: 2_000_000,
  stockLossMinor: 0,
} as ProfitReport;
const today = isoDay(Date.now(), makeMe().tenant.timezone);
const common = {
  'POST /v1/auth/refresh': signedInRefresh,
  'GET /v1/inventory': { status: 200, body: stock },
  'GET /v1/stocktakes': { status: 200, body: { items: [], nextCursor: null } },
  [`GET /v1/reports/profit?from=${today.slice(0, 8)}01&to=${today}`]: { status: 200, body: profit },
};

describe('the stock page of a store that tracks numbers', () => {
  it('shows one line with the count of products out of step, linking to the numbers page', async () => {
    mockFetch({
      ...common,
      'GET /v1/me': { status: 200, body: keeper(['electronics']) },
      'GET /v1/serials/drift': {
        status: 200,
        body: {
          items: [{ variantId: 'v-1', name: 'جوال', stockPieces: 3, serialPieces: 2 }],
          truncated: false,
        },
      },
    });
    renderApp('/inventory');
    const chip = await screen.findByTestId('stock-serial-drift');
    expect(chip).toHaveTextContent('أرقامه التسلسلية لا تطابق المخزون');
    expect(chip.querySelector('a')).toHaveAttribute('href', '/serials');
  });

  it('says nothing when the numbers agree, or the store does not track numbers', async () => {
    const calls = mockFetch({
      ...common,
      'GET /v1/me': { status: 200, body: keeper(['clothing']) },
      'GET /v1/serials/drift': { status: 200, body: { items: [], truncated: false } },
    });
    renderApp('/inventory');
    await screen.findByText('طريقة التقييم: المتوسط المرجّح للكلفة.');
    expect(screen.queryByTestId('stock-serial-drift')).not.toBeInTheDocument();
    expect(calls.requestsTo('GET', '/v1/serials/drift')).toHaveLength(0);
  });

  it('keeps the profit inside the figures card as one line that opens', async () => {
    mockFetch({
      ...common,
      'GET /v1/me': { status: 200, body: keeper(['clothing']) },
    });
    const { user } = renderApp('/inventory');
    const link = await screen.findByRole('button', { name: 'التفاصيل' });
    expect(link.closest('.ix-hero')).not.toBeNull();
    await user.click(link);
    await waitFor(() => expect(screen.getByText('كلفة المبيعات')).toBeInTheDocument());
  });
});

describe('the serial page when the drift list was cut', () => {
  it('tells the owner more products are out of step than shown', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper(['electronics']) },
      'GET /v1/serials?': { status: 200, body: { items: [] } },
      'GET /v1/serials/unassigned': { status: 200, body: { items: [] } },
      'GET /v1/serials/drift': {
        status: 200,
        body: {
          items: [{ variantId: 'v-1', name: 'جوال', stockPieces: 3, serialPieces: 2 }],
          truncated: true,
        },
      },
    });
    renderApp('/serials');
    expect(await screen.findByTestId('serials-drift-more')).toBeInTheDocument();
  });
});
