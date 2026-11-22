import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierReturnDetail } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function buyer(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const row = (n: number) => ({
  id: `r-${n}`,
  number: `PRT-2026-00000${n}`,
  date: '2026-11-03',
  supplierName: 'معمل الأمل',
  refund: 'credit' as const,
  pieces: 3000,
  amountMinor: 120_000,
});

describe('round 60: the returns list', () => {
  it('opens a return in full from its row, and brings the next page when asked', async () => {
    const detail: SupplierReturnDetail = {
      id: 'r-1',
      number: 'PRT-2026-000001',
      date: '2026-11-03',
      supplierId: 's-1',
      supplierName: 'معمل الأمل',
      branchId: 'b-1',
      refund: 'credit',
      reference: 'CN-9',
      lines: [{ variantId: 'v-1', name: 'فستان أحمر', qty: 3000, amountMinor: 120_000, costMinor: 120_000 }],
      amountMinor: 120_000,
      costMinor: 120_000,
      baseCurrency: 'SYP',
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': { status: 200, body: { items: [], baseCurrency: 'SYP' } },
      'GET /v1/supplier-returns': { status: 200, body: { items: [row(1)], nextCursor: 'c1' } },
      'GET /v1/supplier-returns?cursor=c1': { status: 200, body: { items: [row(2)], nextCursor: null } },
      'GET /v1/supplier-returns/r-1': { status: 200, body: detail },
      'GET /v1/store': { status: 200, body: { name: 'متجر', taxNumber: null, address: null, phone: null } },
    });
    const { user } = renderApp('/supplier-returns');
    const table = await screen.findByRole('table', { name: 'المرتجعات إلى الموردين' });
    await user.click(await within(table).findByText('PRT-2026-000001'));
    expect(await screen.findByText('فستان أحمر')).toBeInTheDocument();
    expect(screen.getByText(/CN-9/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/supplier-returns/r-1')).toHaveLength(1);
    await user.click(screen.getAllByRole('button', { name: 'أغلق' }).at(-1)!);
    await user.click(await screen.findByRole('button', { name: 'أظهر المزيد' }));
    expect(await within(table).findByText('PRT-2026-000002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'أظهر المزيد' })).not.toBeInTheDocument();
  });
});
