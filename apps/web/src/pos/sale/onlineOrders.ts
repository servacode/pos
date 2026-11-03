import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import type { Catalog } from '../catalog';
import { addItem, EMPTY_CART, type Cart } from './cart';

/**
 * Online shop orders at the till (26 › حياة الطلب): an accepted order opens as a cart of its pieces
 * at today's shelf prices, carrying the order so the sale closes it. A piece no longer on this
 * device is left out and named, for the cashier to add by hand or tell the customer.
 */

/** The orders this till sold and has not heard back about yet, so it does not offer them again */
export const ONLINE_SOLD_KEY = 'online-orders-sold';

export function orderCart(
  order: OnlineOrderRow,
  catalog: Pick<Catalog, 'byVariant'>,
): { cart: Cart; missing: string[] } {
  let cart: Cart = {
    ...EMPTY_CART,
    onlineOrder: { id: order.id, number: order.number, customerName: order.customerName },
  };
  const missing: string[] = [];
  for (const line of order.lines) {
    const item = catalog.byVariant.get(line.variantId);
    if (item) cart = addItem(cart, item, null, line.qty * 1000);
    else missing.push(line.label ? `${line.name} (${line.label})` : line.name);
  }
  return { cart, missing };
}

/** The orders waiting here: accepted, and not sold on this till already */
export const waitingOrders = (orders: readonly OnlineOrderRow[], sold: readonly string[]) =>
  orders.filter((o) => !sold.includes(o.id));
