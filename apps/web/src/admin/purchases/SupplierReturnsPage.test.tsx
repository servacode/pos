import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierReturnDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

function buyer(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

describe('«مرتجع إلى المورد»', () => {
  it('sends pieces back to a supplier, at cost unless an amount is typed, and lists it', async () => {
    let listed = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            {
              id: 's-1',
              name: 'معمل الأمل',
              phone: null,
              notes: null,
              balanceMinor: 400_000,
              archived: false,
            },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': () => ({
        status: 200,
        body: {
          items: listed
            ? [
                {
                  id: 'r-1',
                  number: 'PRT-2026-000001',
                  date: '2026-11-03',
                  supplierName: 'معمل الأمل',
                  refund: 'credit',
                  pieces: 3000,
                  amountMinor: 120_000,
                },
              ]
            : [],
        },
      }),
      [`GET ${productsPath({ q: 'فستان' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'فستان', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'فستان',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [] }],
        },
      },
      'POST /v1/supplier-returns': (r: MockRequest) => {
        expect(r.body).toMatchObject({
          supplierId: 's-1',
          refund: 'credit',
          note: 'عيب خياطة',
          lines: [{ variantId: 'v-1', qty: 3000, amountMinor: null }],
        });
        listed = true;
        return {
          status: 201,
          body: {
            id: 'r-1',
            number: 'PRT-2026-000001',
            date: '2026-11-03',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            branchId: 'b-1',
            refund: 'credit',
            reference: null,
            lines: [],
            amountMinor: 120_000,
            costMinor: 120_000,
            baseCurrency: 'SYP',
          } satisfies SupplierReturnDetail,
        };
      },
    });
    const { user } = renderApp('/supplier-returns');
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.type(screen.getByLabelText('السبب (اختياري)'), 'عيب خياطة');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'فستان');
    await user.click(await screen.findByRole('button', { name: 'فستان' }));
    await user.type(await screen.findByLabelText('كمية فستان'), '3');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    expect(await screen.findByText(/سُجّل المرتجع PRT-2026-000001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/supplier-returns')).toHaveLength(1);
    const table = await screen.findByRole('table', { name: 'المرتجعات إلى الموردين' });
    expect(within(table).getByText('من رصيده')).toBeInTheDocument();
  });
});
