import type { Quotation } from '@serva/core/contracts/quotations';
import type { Catalog } from '../catalog';
import { addItem, EMPTY_CART, updateLine, type Cart } from '../sale/cart';

/**
 * A quotation opened as a cart (03 › الجملة): each line is added as the till adds it, then carries
 * the offered pack, price and discount. A line whose item is not on this till (a typed one, or one
 * archived since) is left out and named, for the cashier to add by hand. The sale is the till's
 * ordinary one; it marks the quotation converted once it is saved.
 */
export function quotationCart(
  q: Quotation,
  catalog: Pick<Catalog, 'byVariant' | 'customers'>,
): { cart: Cart; missing: string[] } {
  const customer = q.customerId ? catalog.customers.find((c) => c.id === q.customerId) : undefined;
  let cart: Cart = {
    ...EMPTY_CART,
    quotation: { id: q.id, number: q.number, version: q.version },
    // The customer the offer was made to goes with it, even when this till's list does not hold them
    ...(q.customerId ? { customer: { id: q.customerId, name: customer?.name ?? q.customerName ?? '' } } : {}),
    // Their wholesale tier stays on the sale; the lines keep the prices as offered
    ...(customer?.priceTier === 'wholesale' ? { priceTier: 'wholesale' as const } : {}),
    invoiceDiscount: q.invoiceDiscount ?? null,
  };
  const missing: string[] = [];
  for (const line of q.lines) {
    const item = line.variantId ? catalog.byVariant.get(line.variantId) : undefined;
    if (!item) {
      missing.push(line.name);
      continue;
    }
    const before = cart.nextLineNo;
    cart = addItem(cart, item, null, line.qty);
    // The same item twice becomes one line (the first line's price and pack stand)
    if (cart.nextLineNo === before) continue;
    const added = cart.lines[cart.lines.length - 1]!;
    cart = updateLine(cart, added.lineNo, {
      name: line.name,
      packQty: line.packQty,
      packName: line.packName ?? null,
      priceCurrency: q.currency,
      priceMinor: line.unitPriceMinor,
      retailPriceMinor: line.unitPriceMinor,
      wholesalePriceMinor: null,
      taxRateId: line.taxRateId ?? null,
      taxRateBp: line.taxRateBp,
      adjustment: line.discount
        ? {
            kind: 'discount',
            discount:
              line.discount.type === 'percent'
                ? { type: 'percent', bp: line.discount.bp }
                : { type: 'amount', minor: line.discount.minor },
          }
        : null,
    });
  }
  return { cart, missing };
}
