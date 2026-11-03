import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierListResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';
import { moneyOf, qtyOf } from './api';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'purchases.manage', 'cost.view', 'inventory.adjust'],
    },
  };
}

function open() {
  let suppliers: SupplierListResponse = { items: [], totalOwedMinor: 0, baseCurrency: 'SYP' };
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
    'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
    'POST /v1/suppliers': (r: MockRequest) => {
      const s = {
        id: 's-1',
        name: (r.body as { name: string }).name,
        phone: null,
        notes: null,
        balanceMinor: 0,
        archived: false,
      };
      suppliers = { ...suppliers, items: [s] };
      return { status: 201, body: s };
    },
    [`GET ${productsPath({ q: 'قميص' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-2', nameAr: 'قميص كتان', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-2': () => ({
      status: 200,
      body: {
        id: 'p-2',
        nameAr: 'قميص كتان',
        variants: [
          ['M', 'أبيض'],
          ['L', 'أبيض'],
          ['M', 'أزرق'],
        ].map(([size, colour], i) => ({
          id: `v-${size}${i}`,
          label: `${size} · ${colour}`,
          archivedAt: null,
          attributes: [
            { name: 'المقاس', value: size },
            { name: 'اللون', value: colour },
          ],
        })),
      },
    }),
    [`GET ${productsPath({ q: 'حليب' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-1', nameAr: 'حليب طازج', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-1': () => ({
      status: 200,
      body: { id: 'p-1', nameAr: 'حليب طازج', variants: [{ id: 'v-1', label: null, archivedAt: null }] },
    }),
    'POST /v1/purchases': () => ({ status: 201, body: { id: 'pu-1', number: 'PUR-2026-000001' } }),
  });
  return { ...mock, ...renderApp('/purchases') };
}

describe('«المشتريات»', () => {
  it('adds a supplier, then records a purchase of an item with its quantity and cost', async () => {
    const { user, requestsTo } = open();
    expect(await screen.findByRole('heading', { name: 'المشتريات والموردون', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('أضف مورداً أولاً، ثم سجّل فواتير الشراء منه.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'مؤسسة الفرات');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('أُضيف المورد.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '12');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '24000');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    expect(
      await screen.findByText('سُجّلت الفاتورة PUR-2026-000001 ودخلت البضاعة المخزون.'),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      supplierId: 's-1',
      payment: 'credit',
      lines: [{ variantId: 'v-1', qty: 12_000, costMinor: 2_400_000 }],
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});

describe('typed amounts', () => {
  it('reads quantities in thousandths and pounds in qirsh, Arabic digits too', () => {
    expect(qtyOf('12')).toBe(12_000);
    expect(qtyOf('1.25')).toBe(1_250);
    expect(qtyOf('١٢')).toBe(12_000);
    expect(qtyOf('-1')).toBeNull();
    expect(moneyOf('24,000')).toBe(2_400_000);
    expect(moneyOf('9.5')).toBe(950);
    expect(moneyOf('abc')).toBeNull();
  });

  it('takes a model in sizes and colours as a grid, one cost per piece, then saves every piece', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'معمل');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص كتان' }));
    const grid = await screen.findByRole('group', { name: 'جدول قميص كتان' });
    // L in blue was never made: no cell
    expect(within(grid).getAllByRole('textbox', { name: /كمية/ })).toHaveLength(3);
    await user.type(within(grid).getByLabelText('كمية M · أبيض'), '6');
    await user.type(within(grid).getByLabelText('كمية L · أبيض'), '4');
    await user.type(within(grid).getByLabelText('كلفة القطعة الواحدة'), '12500');
    await user.click(within(grid).getByRole('button', { name: 'أضف 10 قطعة' }));
    expect(screen.getByLabelText('كمية قميص كتان M · أبيض')).toHaveValue('6');
    expect(screen.getByLabelText('كلفة قميص كتان L · أبيض')).toHaveValue('50000');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText(/سُجّلت الفاتورة/);
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      lines: [
        { variantId: 'v-M0', qty: 6000, costMinor: 7_500_000 },
        { variantId: 'v-L1', qty: 4000, costMinor: 5_000_000 },
      ],
    });
  });
});
