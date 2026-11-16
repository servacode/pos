import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, EMPTY_CART, invoiceNeed, priceCart, type PricingContext } from './cart';

/** Round 21 (D3): the invoice discount spreads over goods only; a service's fee is left alone. */

const goods = buildCatalog(posSets()).items[0]!;
const service = { ...goods, variantId: 'service-variant', productId: 'service-product', isService: true };

const ctxOf = (cart: ReturnType<typeof addItem>): PricingContext => ({
  currency: cart.lines[0]!.priceCurrency,
  taxInclusive: true,
  rates: [],
});

describe('an invoice discount with a service line in the cart', () => {
  const cart = () => {
    let c = addItem(EMPTY_CART, goods, null, 1000);
    c = addItem(c, service, null, 1000);
    c = {
      ...c,
      lines: c.lines.map((l) => ({ ...l, priceMinor: l.variantId === 'service-variant' ? 20_000 : 100_000 })),
      invoiceDiscount: { type: 'percent', bp: 1000 },
    };
    return c;
  };

  it('marks the service line and leaves it out of the discount', () => {
    const c = cart();
    expect(c.lines.map((l) => l.isService ?? false)).toEqual([false, true]);
    const { priced } = priceCart(c, ctxOf(c));
    expect(priced.totals.invoiceDiscountMinor).toBe(10_000);
    expect(priced.lines[1]).toMatchObject({ invoiceDiscountShareMinor: 0, totalMinor: 20_000 });
  });

  it('measures the manager limit against the goods, not the whole invoice', () => {
    const c = cart();
    const { priced } = priceCart(c, ctxOf(c));
    // 10% of the goods: over a 9% limit, though it is only 8.3% of the invoice with the fee
    expect(invoiceNeed(c, priced, { maxDiscountBp: 900, overLimitAllowed: false })).toBe('over_limit');
    expect(invoiceNeed(c, priced, { maxDiscountBp: 1000, overLimitAllowed: false })).toBeNull();
  });
});
