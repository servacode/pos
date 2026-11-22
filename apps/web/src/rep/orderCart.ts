import { lineRemaining, type SalesOrderPullRow } from '@serva/core/distribution';
import type { CurrencyCode } from '@serva/core/currencies';
import type { Catalog } from '../pos/catalog';
import { addItem, EMPTY_CART, type Cart } from '../pos/sale/cart';

/**
 * A pre-sale order opened as the cart to deliver it from the van: what is still owed of each line,
 * at the price the customer was given when the order was taken (not today's shelf price). The sale
 * is the ordinary one and names the order, so the server marks it delivered, in part or in whole.
 * A piece no longer on this device is left out and named, for the rep to tell the supervisor.
 */
export function salesOrderCart(
  order: Pick<SalesOrderPullRow, 'id' | 'number' | 'currency' | 'lines'>,
  customer: { id: string; name: string },
  catalog: Pick<Catalog, 'byVariant'>,
): { cart: Cart; missing: string[] } {
  let cart: Cart = { ...EMPTY_CART, customer, salesOrder: { id: order.id, number: order.number } };
  const missing: string[] = [];
  for (const line of order.lines) {
    const left = lineRemaining(line);
    if (left <= 0) continue;
    const item = catalog.byVariant.get(line.variantId);
    if (!item) {
      missing.push(line.variantId);
      continue;
    }
    cart = addItem(cart, item, null, left);
  }
  // The price the order promised, kept by hand so no list, tier or contract prices it again
  const priceByVariant = new Map(order.lines.map((l) => [l.variantId, l.unitPriceMinor]));
  return {
    cart: {
      ...cart,
      lines: cart.lines.map((l) => {
        const price = priceByVariant.get(l.variantId);
        if (price === undefined) return l;
        return {
          ...l,
          priceMinor: price,
          retailPriceMinor: price,
          wholesalePriceMinor: null,
          priceCurrency: order.currency as CurrencyCode,
          priceTyped: true,
        };
      }),
    },
    missing,
  };
}
