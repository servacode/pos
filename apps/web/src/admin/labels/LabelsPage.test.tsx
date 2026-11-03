import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse, ProductDetail, PurchaseDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { product, variant } from '../../test/catalog';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  vi.spyOn(window, 'print').mockImplementation(print);
});
afterEach(() => vi.restoreAllMocks());

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage', 'purchases.manage'] },
  };
}

const code = (id: string, c: string) => ({
  id,
  code: c,
  kind: 'internal' as const,
  packQty: 1000,
  packName: null,
  packPriceMinor: null,
});

/** A shirt in M and L; L has no barcode yet. */
function shirt(withL = false): ProductDetail {
  return product({
    id: 'p-shirt',
    nameAr: 'قميص كتان',
    version: 4,
    variants: [
      variant({
        id: 'v-m',
        label: 'M · أبيض',
        attributes: [
          { name: 'المقاس', value: 'M' },
          { name: 'اللون', value: 'أبيض' },
        ],
        price: { currency: 'SYP', priceMinor: 4_500_000 },
        barcodes: [code('b-m', '2900000000018')],
      }),
      variant({
        id: 'v-l',
        label: 'L · أبيض',
        attributes: [
          { name: 'المقاس', value: 'L' },
          { name: 'اللون', value: 'أبيض' },
        ],
        price: { currency: 'SYP', priceMinor: 4_500_000 },
        barcodes: withL ? [code('b-l', '2900000000025')] : [],
      }),
    ],
  });
}

describe('«طباعة الملصقات»', () => {
  it('opens from a product with every piece, gives codes to those without, and prints the copies asked', async () => {
    let current = shirt();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/products/p-shirt': () => ({ status: 200, body: current }),
      'PATCH /v1/products/p-shirt': (_r: MockRequest) => {
        current = shirt(true);
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/labels?product=p-shirt');
    const list = await screen.findByRole('list', { name: 'الملصقات' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'باركود 2900000000018' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ولّد لها باركوداً داخلياً' }));
    expect(await within(list).findByText('2900000000025')).toBeInTheDocument();
    expect(requestsTo('PATCH', '/v1/products/p-shirt').at(-1)?.body).toMatchObject({
      version: 4,
      variants: [{ id: 'v-l', barcodes: [{ kind: 'internal' }] }],
    });
    const copies = screen.getByLabelText('عدد ملصقات قميص كتان M · أبيض');
    await user.clear(copies);
    await user.type(copies, '3');
    await user.click(screen.getByRole('button', { name: 'اطبع 4 ملصقاً' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('opens from a purchase with as many labels as pieces came in', async () => {
    const purchase = {
      id: 'pur-1',
      lines: [
        {
          lineNo: 1,
          variantId: 'v-m',
          productId: 'p-shirt',
          name: 'قميص',
          qty: 6000,
          costMinor: 1,
          batchNo: null,
          expiryDate: null,
          serials: [],
        },
      ],
    } as unknown as PurchaseDetail;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/purchases/pur-1': () => ({ status: 200, body: purchase }),
      'GET /v1/products/p-shirt': () => ({ status: 200, body: shirt(true) }),
    });
    renderApp('/labels?purchase=pur-1');
    expect(await screen.findByRole('button', { name: 'اطبع 6 ملصقاً' })).toBeEnabled();
    expect(within(screen.getByRole('list', { name: 'الملصقات' })).getAllByRole('listitem')).toHaveLength(1);
  });
});
