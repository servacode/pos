import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, TransferDetail, TransferFull } from '@serva/core';
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
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
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
    // The list says what state a transfer is in: it is one step, out and in together
    expect(within(table).getByText('تمّ: خرج ودخل')).toBeInTheDocument();
  });

  it('shows a transfer on its way, and the receiving branch confirms it with a shortage and a reason', async () => {
    let received = false;
    const onTheWay = {
      id: 't-9',
      number: 'TRF-2026-000009',
      date: '2026-11-03',
      fromBranch: 'الفرع الرئيسي',
      toBranch: 'فرع المول',
      pieces: 4000,
      valueMinor: 160_000,
      status: 'in_transit' as const,
      fromBranchId: 'b-main',
      toBranchId: 'b-mall',
    };
    const full = (over: Partial<TransferFull> = {}): TransferFull => ({
      id: 't-9',
      number: 'TRF-2026-000009',
      date: '2026-11-03',
      fromBranchId: 'b-main',
      toBranchId: 'b-mall',
      fromBranch: 'الفرع الرئيسي',
      toBranch: 'فرع المول',
      status: 'in_transit',
      note: null,
      lines: [
        { variantId: 'v-1', name: 'قميص', qty: 4000, valueMinor: 160_000, receivedQty: null, shortQty: 0 },
      ],
      valueMinor: 160_000,
      baseCurrency: 'SYP',
      receipt: null,
      ...over,
    });
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner(two) },
      'GET /v1/transfers': () => ({
        status: 200,
        body: {
          items: [received ? { ...onTheWay, status: 'received', shortPieces: 1000 } : onTheWay],
        },
      }),
      'GET /v1/transfers/settings': { status: 200, body: { mode: 'auto', effective: 'transit' } },
      'GET /v1/transfers/t-9': { status: 200, body: full() },
      'POST /v1/transfers/t-9/receive': () => {
        received = true;
        return {
          status: 200,
          body: full({
            status: 'received',
            receipt: {
              date: '2026-11-04',
              shortPieces: 1000,
              shortValueMinor: 40_000,
              reason: 'ضاعت قطعة',
              stocktakeNumber: 'STK-2026-000001',
            },
          }),
        };
      },
    });
    const { user } = renderApp('/transfers');
    const table = await screen.findByRole('table', { name: 'التحويلات' });
    expect(await within(table).findByText('في الطريق')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'استلم' }));
    const panel = await screen.findByLabelText('استلام التحويل TRF-2026-000009');
    // Everything arrived to start with: the button says so and no reason is asked for
    expect(within(panel).getByRole('button', { name: 'أكّد الاستلام' })).toBeEnabled();
    expect(within(panel).queryByLabelText('سبب النقص')).not.toBeInTheDocument();
    const got = within(panel).getByLabelText('وصل من قميص');
    await user.clear(got);
    await user.type(got, '3');
    expect(await within(panel).findByLabelText('سبب النقص')).toBeInTheDocument();
    const confirm = within(panel).getByRole('button', { name: 'أكّد الاستلام مع النقص' });
    expect(confirm).toBeDisabled();
    await user.type(within(panel).getByLabelText('سبب النقص'), 'ضاعت قطعة');
    await user.click(confirm);
    expect(await screen.findByText(/استُلم التحويل TRF-2026-000009/)).toBeInTheDocument();
    expect(screen.getByText(/STK-2026-000001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/transfers/t-9/receive')[0]!.body).toEqual({
      lines: [{ variantId: 'v-1', receivedQty: 3000 }],
      reason: 'ضاعت قطعة',
    });
    expect(
      await within(await screen.findByRole('table', { name: 'التحويلات' })).findByText(/وفيه نقص/),
    ).toBeInTheDocument();
  });

  it('lets a store choose how it sends: the setting is saved', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner(two) },
      'GET /v1/transfers': { status: 200, body: { items: [] } },
      'GET /v1/transfers/settings': { status: 200, body: { mode: 'auto', effective: 'transit' } },
      'PUT /v1/transfers/settings': { status: 200, body: { mode: 'instant', effective: 'instant' } },
    });
    const { user } = renderApp('/transfers');
    const select = await screen.findByLabelText('طريقة التحويل');
    await user.selectOptions(select, 'instant');
    expect(await screen.findByText(/يخرج من فرع ويدخل الآخر في اللحظة نفسها/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/transfers/settings')[0]!.body).toEqual({ mode: 'instant' });
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
