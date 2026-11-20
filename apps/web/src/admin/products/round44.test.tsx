import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { catalogMe } from '../../test/catalog';
import { mockFetch } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { guessColumns } from './priceList';
import { canReadCatalog } from './CatalogGate';
import { marginPercent, qtyThousandths } from './CostStockSection';
import { productsPath } from '../catalog/api';

/** Round 44, products: who may open the catalog screens, and the price-list header guess */

const cashier = () => {
  const me = catalogMe(['sale.create']);
  return { ...me, user: { ...me.user, roles: [{ key: 'cashier', name: 'كاشير', branchId: null }] } };
};

describe('the catalog screens for a user without the permission', () => {
  it('says «ليست ضمن صلاحياتك» instead of a page whose every call fails', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: cashier() },
    });
    renderApp('/prices');
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/categories')).toHaveLength(0);
  });

  it('lets an owner or a manager read, and whoever holds catalog.manage', () => {
    expect(canReadCatalog(cashier())).toBe(false);
    expect(canReadCatalog(catalogMe())).toBe(true);
    const me = catalogMe(['sale.create']);
    expect(
      canReadCatalog({ ...me, user: { ...me.user, roles: [{ key: 'manager', name: 'م', branchId: null }] } }),
    ).toBe(true);
  });
});

describe('the price list file', () => {
  it('finds the barcode and the price column from the plain headers «الباركود، السعر»', () => {
    expect(guessColumns(['الباركود', 'السعر'])).toMatchObject({ barcode: 0, price: 1 });
    expect(guessColumns(['barcode', 'Price'])).toMatchObject({ barcode: 0, price: 1 });
  });
});

describe('cost and opening quantity helpers', () => {
  it('reads a quantity as thousandths, and refuses zero, minus and words', () => {
    expect(qtyThousandths('2.5')).toBe(2500);
    expect(qtyThousandths('10')).toBe(10_000);
    expect(qtyThousandths('0')).toBeNull();
    expect(qtyThousandths('-3')).toBeNull();
    expect(qtyThousandths('abc')).toBeNull();
  });
  it('says the margin on the shelf price, negative when it sells under cost', () => {
    expect(marginPercent(5000, 3000)).toBe(40);
    expect(marginPercent(2000, 3000)).toBe(-50);
    expect(marginPercent(0, 100)).toBeNull();
  });
  it('writes the stock filter and the order in the list address only when they are set', () => {
    expect(productsPath({ status: 'active' })).toBe('/v1/products?status=active');
    expect(productsPath({ status: 'active', stock: 'out', sort: 'stock' })).toBe(
      '/v1/products?status=active&stock=out&sort=stock',
    );
  });
});
