import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import { saleScreen } from '../../test/renderPos';

/** Round 39: a tile says what is left for this sale, after what customers' holds keep back */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

function sets(reservedPieces: number) {
  const s = posSets();
  s.stock_levels = [
    {
      id: PRODUCTS.sugar.variant.id,
      branchId: ids.branch,
      variantId: PRODUCTS.sugar.variant.id,
      qty: 48_000,
      reservedQty: 0,
      version: 1,
    },
  ] as typeof s.stock_levels;
  s.online_orders =
    reservedPieces > 0
      ? ([
          {
            id: 'o-1',
            number: 'ONL-000001',
            status: 'accepted',
            customerName: 'أم أحمد',
            phone: '+963933111222',
            fulfilment: 'pickup',
            address: null,
            note: null,
            currency: 'SYP',
            totalMinor: 0,
            depositCode: null,
            deliveryFeeMinor: 0,
            deliveryArea: null,
            lines: [
              {
                variantId: PRODUCTS.sugar.variant.id,
                productId: PRODUCTS.sugar.product.id,
                name: 'سكر',
                label: null,
                qty: reservedPieces,
                priceMinor: 1,
                totalMinor: 1,
              },
            ],
            version: 1,
          },
        ] as unknown as typeof s.online_orders)
      : [];
  return s;
}

describe('the tile’s available count (round 39)', () => {
  it('shows on hand less what is held for others, and says how much is held', async () => {
    await saleScreen({ sets: sets(39) });
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    const tile = plain(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.sugar.product.nameAr) }));
    expect(tile).toContain('المتوفر 9');
    expect(tile).toContain('محجوز 39');
    expect(tile).not.toContain('المتوفر 48');
  });

  it('is unchanged when nothing is held', async () => {
    await saleScreen({ sets: sets(0) });
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    const tile = plain(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.sugar.product.nameAr) }));
    expect(tile).toContain('المتوفر 48');
    expect(tile).not.toContain('محجوز');
  });
});
