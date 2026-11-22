import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InventoryResponse, MeResponse, Permission, StocktakeDetail } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** Round 60, inventory: the valuation method, the reorder level, the serial numbers of a count, the counts on a tab */

const withPermissions = (extra: Permission[]): MeResponse => {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, ...extra] } };
};
const row = (over: Partial<InventoryResponse['items'][number]>): InventoryResponse['items'][number] => ({
  variantId: 'v-1',
  name: 'قميص',
  branchId: 'b-main',
  branchName: 'الفرع الرئيسي',
  branchKind: 'store',
  qty: 10_000,
  valueMinor: 400_000,
  unitCostMinor: 40,
  ...over,
});
const stockOf = (items: InventoryResponse['items']): InventoryResponse => ({
  items,
  totalValueMinor: items.reduce((sum, r) => sum + r.valueMinor, 0),
  baseCurrency: 'SYP',
  asOf: '2026-11-22T10:00:00.000Z',
});

describe('valuation and reorder level', () => {
  it('names the method, and flags a piece at or under its reorder level', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view', 'inventory.adjust']) }),
      'GET /v1/inventory': {
        status: 200,
        body: stockOf([row({ qty: 2000, minStockQty: 5000 }), row({ variantId: 'v-2', name: 'بنطال' })]),
      },
      'GET /v1/stocktakes': { status: 200, body: { items: [], nextCursor: null } },
    });
    const { user } = renderApp('/inventory');
    expect(await screen.findByText('طريقة التقييم: المتوسط المرجّح للكلفة.')).toBeInTheDocument();
    expect(await screen.findByText('تحت الحد')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'تحت حد الطلب' }));
    const table = screen.getByRole('table', { name: 'المخزون' });
    expect(within(table).getByText('قميص')).toBeInTheDocument();
    expect(within(table).queryByText('بنطال')).not.toBeInTheDocument();
  });
});

describe('a count that finds fewer phones', () => {
  it('asks which numbers left and posts them with the line', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view', 'inventory.adjust']) }),
      'GET /v1/inventory': {
        status: 200,
        body: stockOf([row({ name: 'جوال', qty: 3000, tracksSerial: true, valueMinor: 3_000_000 })]),
      },
      'GET /v1/stocktakes': { status: 200, body: { items: [], nextCursor: null } },
      'GET /v1/inventory/serials?variantId=v-1&branchId=b-main': {
        status: 200,
        body: { items: ['IMEI-1', 'IMEI-2', 'IMEI-3'], truncated: false },
      },
      'POST /v1/stocktakes': {
        status: 201,
        body: {
          id: 's-1',
          number: 'STK-1',
          date: '2026-11-22',
          branchId: 'b-main',
          lines: [],
          diffValueMinor: -1_000_000,
          baseCurrency: 'SYP',
        } satisfies StocktakeDetail,
      },
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('button', { name: 'جرد الرفوف' }));
    await user.type(await screen.findByLabelText('المعدود من جوال'), '2');
    await user.click(screen.getByRole('button', { name: 'راجع الجرد' }));
    const save = await screen.findByRole('button', { name: 'سجّل الجرد' });
    // No number picked yet: the count cannot be recorded
    expect(save).toBeDisabled();
    await user.click(await screen.findByRole('checkbox', { name: 'IMEI-2' }));
    expect(save).toBeEnabled();
    await user.click(save);
    await screen.findByText(/سُجّل الجرد/);
    const posted = requestsTo('POST', '/v1/stocktakes')[0]!.body as {
      lines: { variantId: string; countedQty: number; serials?: string[] }[];
    };
    expect(posted.lines[0]).toMatchObject({ countedQty: 2000, serials: ['IMEI-2'] });
  });
});
