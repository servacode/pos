import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InventoryResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const me = () => {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'cost.view', 'inventory.adjust'] },
  };
};

const piece = (variantId: string, name: string, qty: number) => ({
  variantId,
  name,
  branchId: 'b-1',
  qty,
  valueMinor: 0,
  unitCostMinor: 0,
});

describe('«المخزون» opened from the home page’s «ناقص» chips', () => {
  it('opens the count on the named items only, and can show them all again', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: me() }),
      'GET /v1/inventory': () => ({
        status: 200,
        body: {
          items: [piece('v-1', 'كمامة', -16_000), piece('v-2', 'قفازات', 8000)],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies InventoryResponse,
      }),
    });
    const { user } = renderApp('/inventory?count=v-1');
    expect(await screen.findByText('كمامة')).toBeInTheDocument();
    expect(screen.queryByText('قفازات')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'راجع الجرد' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'اعرض كل الأصناف' }));
    expect(await screen.findByText('قفازات')).toBeInTheDocument();
  });
});
