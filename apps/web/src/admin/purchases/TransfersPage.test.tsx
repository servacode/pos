import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, TransferDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

function owner(branches: MeResponse['branches']): MeResponse {
  const base = makeMe();
  return {
    ...base,
    branches,
    user: { ...base.user, permissions: [...base.user.permissions, 'inventory.adjust'] },
  };
}
const two = [
  { id: 'b-main', code: '001', name: 'الفرع الرئيسي' },
  { id: 'b-mall', code: '002', name: 'فرع المول' },
];

describe('«التحويل بين الفروع»', () => {
  it('sends pieces from one branch to another and lists it', async () => {
    let listed = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner(two) },
      'GET /v1/transfers': () => ({
        status: 200,
        body: {
          items: listed
            ? [
                {
                  id: 't-1',
                  number: 'TRF-2026-000001',
                  date: '2026-11-03',
                  fromBranch: 'الفرع الرئيسي',
                  toBranch: 'فرع المول',
                  pieces: 4000,
                  valueMinor: 160_000,
                },
              ]
            : [],
        },
      }),
      [`GET ${productsPath({ q: 'قميص' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'قميص', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'قميص',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [] }],
        },
      },
      'POST /v1/transfers': (_r: MockRequest) => {
        listed = true;
        return {
          status: 201,
          body: {
            id: 't-1',
            number: 'TRF-2026-000001',
            date: '2026-11-03',
            fromBranchId: 'b-main',
            toBranchId: 'b-mall',
            lines: [],
            valueMinor: 160_000,
            baseCurrency: 'SYP',
          } satisfies TransferDetail,
        };
      },
    });
    const { user } = renderApp('/transfers');
    expect(await screen.findByLabelText('إلى فرع')).toHaveValue('b-mall');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص' }));
    await user.type(await screen.findByLabelText('كمية قميص'), '4');
    await user.click(screen.getByRole('button', { name: 'سجّل التحويل' }));
    expect(await screen.findByText(/سُجّل التحويل TRF-2026-000001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/transfers')[0]!.body).toMatchObject({
      fromBranchId: 'b-main',
      toBranchId: 'b-mall',
      lines: [{ variantId: 'v-1', qty: 4000 }],
    });
    const table = await screen.findByRole('table', { name: 'التحويلات' });
    expect(await within(table).findByText('الفرع الرئيسي ← فرع المول')).toBeInTheDocument();
  });

  it('says so for a store of one branch', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner([two[0]!]) },
      'GET /v1/transfers': { status: 200, body: { items: [] } },
    });
    renderApp('/transfers');
    expect(await screen.findByText(/للمحل فرع واحد/)).toBeInTheDocument();
  });
});
