import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';
import { usualUnitOf } from './purchaseSanity';

function buyer(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const supplier = (id: string, name: string) => ({
  id,
  name,
  phone: null,
  notes: null,
  balanceMinor: 0,
  archived: false,
});

const piece = (id: string, size: string, colour: string) => ({
  id,
  label: `${size} · ${colour}`,
  archivedAt: null,
  barcodes: [],
  attributes: [
    { name: 'المقاس', value: size },
    { name: 'اللون', value: colour },
  ],
});

function open(suppliers = [supplier('s-1', 'معمل الأمل'), supplier('s-2', 'ورشة النور')]) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: buyer() },
    'GET /v1/suppliers': { status: 200, body: { items: suppliers, totalOwedMinor: 0, baseCurrency: 'SYP' } },
    'GET /v1/inventory': {
      status: 200,
      body: {
        baseCurrency: 'SYP',
        totalValueMinor: 0,
        items: [
          {
            variantId: 'v-M0',
            productId: 'p-2',
            branchId: 'b-1',
            name: 'قميص كتان M · أبيض',
            qty: 3000,
            valueMinor: 330_000,
            unitCostMinor: 110_000,
            lastCostMinor: 110_000,
            typicalCostMinor: 110_000,
          },
        ],
      },
    },
    [`GET ${productsPath({ q: 'قميص' })}`]: {
      status: 200,
      body: { items: [{ id: 'p-2', nameAr: 'قميص كتان', type: 'stock' }], nextCursor: null },
    },
    'GET /v1/products/p-2': {
      status: 200,
      body: {
        id: 'p-2',
        nameAr: 'قميص كتان',
        variants: [piece('v-M0', 'M', 'أبيض'), piece('v-L1', 'L', 'أبيض'), piece('v-M2', 'M', 'أزرق')],
      },
    },
    'POST /v1/purchase-orders': (r: MockRequest) => ({
      status: 201,
      body: { id: 'o-1', ...(r.body as object) },
    }),
  });
  return { ...mock, ...renderApp('/purchase-orders/new') };
}

describe('طلبية شراء بجدول المقاسات', () => {
  it('does not pick the first supplier by itself when there are several', async () => {
    open();
    const select = await screen.findByLabelText('المورد');
    await screen.findByRole('option', { name: 'ورشة النور' });
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'اختر المورد' })).toBeInTheDocument();
  });

  it('picks the only supplier there is', async () => {
    open([supplier('s-1', 'معمل الأمل')]);
    await screen.findByRole('option', { name: 'معمل الأمل' });
    expect(screen.getByLabelText('المورد')).toHaveValue('s-1');
  });

  it('adds a model as a grid with the last cost already in the cost box, one order line per piece', async () => {
    const { user } = open();
    await screen.findByRole('option', { name: 'ورشة النور' });
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص كتان' }));
    const grid = await screen.findByRole('group', { name: 'جدول قميص كتان' });
    // Nothing typed yet: a run's count note stays quiet
    expect(within(grid).queryByText(/أعداد|بلا كمية/)).toBeNull();
    // The usual cost of the model (the white M was bought at 1,100) starts the box
    expect(within(grid).getByLabelText('كلفة القطعة الواحدة')).toHaveValue('1,100');
    await user.type(within(grid).getByLabelText('كمية M · أبيض'), '6');
    await user.type(within(grid).getByLabelText('كمية L · أبيض'), '4');
    await user.click(within(grid).getByRole('button', { name: 'أضف 10 قطع' }));
    expect(screen.getByLabelText('كمية قميص كتان M · أبيض')).toHaveValue('6');
    expect(screen.getByLabelText('سعر وحدة قميص كتان L · أبيض')).toHaveValue('1,100');
  });

  it('tells the run count only after the run is used', async () => {
    const { user } = open();
    await screen.findByRole('option', { name: 'ورشة النور' });
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص كتان' }));
    const grid = await screen.findByRole('group', { name: 'جدول قميص كتان' });
    await user.click(within(grid).getByRole('button', { name: 'طقم 1-2-2-1' }));
    expect(await within(grid).findByText(/له 4 أعداد والجدول 2 مقاسات فقط/)).toBeInTheDocument();
  });
});

describe('usualUnitOf', () => {
  it('takes the middle usual cost of a model and nothing when it was never bought', () => {
    const refs = new Map([
      ['a', { last: 100 }],
      ['b', { last: 300 }],
      ['c', { last: 200 }],
    ]);
    expect(usualUnitOf(refs, ['a', 'b', 'c'])).toBe(200);
    expect(usualUnitOf(refs, ['x'])).toBeNull();
  });
});
