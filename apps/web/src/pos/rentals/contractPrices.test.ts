import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, applyContractPrices, EMPTY_CART, updateLine } from '../sale/cart';

/** A customer's contract prices price the cart's lines in place of the shelf price (03 › أسعار العقود) */

const item = buildCatalog(posSets()).items[0]!;
const price = (priceMinor: number, currency = item.price.currency) => ({
  variantId: item.variantId,
  currency,
  priceMinor,
});

describe('applyContractPrices', () => {
  it('prices the line of a product with a contract price, and keeps it under a wholesale switch', () => {
    const cart = addItem(EMPTY_CART, item, undefined, 2000);
    const priced = applyContractPrices(cart, [price(700)]);
    expect(priced.lines[0]).toMatchObject({
      priceMinor: 700,
      retailPriceMinor: 700,
      wholesalePriceMinor: 700,
    });
  });

  it('leaves the cart alone with no prices, another product, another currency or a typed price', () => {
    const cart = addItem(EMPTY_CART, item, undefined, 1000);
    expect(applyContractPrices(cart, [])).toBe(cart);
    expect(applyContractPrices(cart, [{ ...price(1), variantId: 'other' }]).lines[0]!.priceMinor).toBe(
      cart.lines[0]!.priceMinor,
    );
    expect(applyContractPrices(cart, [price(1, 'USD')]).lines[0]!.priceMinor).toBe(cart.lines[0]!.priceMinor);
    const typed = updateLine(cart, 1, { adjustment: { kind: 'price', priceMinor: 555 } });
    expect(applyContractPrices(typed, [price(1)]).lines[0]).toBe(typed.lines[0]);
  });
});
