import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, applyContractPrices, EMPTY_CART, setPriceTier } from './cart';

/** A price typed by hand (a service's fee) is never re-priced by a customer's price list. */

const item = buildCatalog(posSets()).items[0]!;
const currency = addItem(EMPTY_CART, item, null, 1000).lines[0]!.priceCurrency;

describe('a hand-priced line', () => {
  const typed = () => {
    const cart = addItem(EMPTY_CART, item, null, 1000);
    return { ...cart, lines: [{ ...cart.lines[0]!, priceMinor: 25_000, priceTyped: true }] };
  };

  it('keeps its price when the customer has a contract price for it', () => {
    const cart = typed();
    const priced = applyContractPrices(cart, [{ variantId: item.variantId, currency, priceMinor: 9_000 }]);
    expect(priced.lines[0]!.priceMinor).toBe(25_000);
  });

  it('keeps its price when the wholesale tier is switched on', () => {
    expect(setPriceTier(typed(), 'wholesale').lines[0]!.priceMinor).toBe(25_000);
  });

  it('is not zeroed by a contract price that is not above zero', () => {
    const cart = addItem(EMPTY_CART, item, null, 1000);
    const priced = applyContractPrices(cart, [{ variantId: item.variantId, currency, priceMinor: 0 }]);
    expect(priced.lines[0]!.priceMinor).toBe(cart.lines[0]!.priceMinor);
  });

  it('still takes a contract price on an ordinary line', () => {
    const cart = addItem(EMPTY_CART, item, null, 1000);
    const priced = applyContractPrices(cart, [{ variantId: item.variantId, currency, priceMinor: 700 }]);
    expect(priced.lines[0]!.priceMinor).toBe(700);
  });
});
