import { describe, expect, it } from 'vitest';
import type { BarcodeRow } from '@serva/core/contracts/catalog';
import { buildCatalog, type CatalogItem } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, EMPTY_CART, setPriceTier } from './cart';

/** A pack (box, carton) sells at its own wholesale price, else the piece's times the pieces. */

const base = buildCatalog(posSets()).items[0]!;
const item: CatalogItem = {
  ...base,
  price: { ...base.price, priceMinor: 1_000, wholesalePriceMinor: 800 },
};
const pack = (packWholesaleMinor: number | null, packPriceMinor: number | null = null) =>
  ({
    barcode: {
      id: 'b1',
      variantId: item.variantId,
      code: '6281234500099',
      kind: 'standard',
      packQty: 12_000,
      packName: 'كرتونة',
      packPriceMinor,
      packWholesaleMinor,
      version: 1,
    } satisfies BarcodeRow,
  }) as unknown as Parameters<typeof addItem>[2];

describe('a pack at the wholesale price', () => {
  it('uses the pack’s own wholesale price', () => {
    const cart = addItem(EMPTY_CART, item, pack(9_000), 1000);
    expect(cart.lines[0]).toMatchObject({ priceMinor: 12_000, wholesalePriceMinor: 9_000 });
    expect(setPriceTier(cart, 'wholesale').lines[0]!.priceMinor).toBe(9_000);
    expect(setPriceTier(setPriceTier(cart, 'wholesale'), 'retail').lines[0]!.priceMinor).toBe(12_000);
  });

  it('falls back to the piece wholesale price times the pieces', () => {
    const cart = addItem({ ...EMPTY_CART, priceTier: 'wholesale' }, item, pack(null), 1000);
    expect(cart.lines[0]).toMatchObject({ priceMinor: 9_600, retailPriceMinor: 12_000 });
  });

  it('has a wholesale price even where the piece has none', () => {
    const noPiece = { ...item, price: { ...item.price, wholesalePriceMinor: null } };
    expect(addItem(EMPTY_CART, noPiece, pack(null), 1000).lines[0]!.wholesalePriceMinor).toBeNull();
    expect(addItem(EMPTY_CART, noPiece, pack(9_000), 1000).lines[0]!.wholesalePriceMinor).toBe(9_000);
  });
});
