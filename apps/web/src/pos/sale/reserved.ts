import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import { heldCartHoursOf, type TillSettings } from '@serva/core/contracts/till';
import { lineBaseQty } from '@serva/core/sale';
import type { Cart } from './cart';

/**
 * What is reserved for other people (decision 14): the pieces a customer's hold or an accepted shop order
 * keeps (the server's truth, as last pulled) and the pieces of the carts put aside at this till (the till
 * counts its own, online or not). Available = on hand - sold here and not yet sent - reserved.
 *
 * Reserving moves no stock and posts nothing: this only lowers what the till lets the cashier sell.
 * The cart being sold never counts against itself: its own order, and its own held copy, are left out.
 * Base units (a thousandth of a piece), per variant.
 */
export function reservedForOthers(input: {
  orders: readonly OnlineOrderRow[];
  /** Orders this till sold and the server has not confirmed yet: no longer reserved */
  soldOnline: readonly string[];
  /** Carts put aside at this till */
  held: readonly Cart[];
  /** The cart being sold now */
  cart: Cart;
  /** This till's branch (null when unknown: every hold counts) */
  branchId: string | null;
  till: Pick<TillSettings, 'heldCartHours'> | null | undefined;
  now: number;
}): Map<string, number> {
  const out = new Map<string, number>();
  const add = (variantId: string, units: number) => out.set(variantId, (out.get(variantId) ?? 0) + units);
  for (const order of input.orders) {
    if (order.status !== 'accepted' || input.soldOnline.includes(order.id)) continue;
    if (input.cart.onlineOrder?.id === order.id) continue;
    // A hold belongs to its branch; a shop order (no branch) is filled at any
    if (order.branchId && input.branchId && order.branchId !== input.branchId) continue;
    // A lapsed hold keeps nothing back
    if (order.reservedUntil && Date.parse(order.reservedUntil) <= input.now) continue;
    for (const line of order.lines) add(line.variantId, line.qty * 1000);
  }
  const keepMs = heldCartHoursOf(input.till) * 3_600_000;
  for (const held of input.held) {
    // A restaurant's open table and a cart that is an order already counted above are not pieces put aside
    if (held.service || held.onlineOrder) continue;
    if (held.held && input.now - held.held.at > keepMs) continue;
    for (const line of held.lines) if (line.qty > 0) add(line.variantId, lineBaseQty(line.qty, line.packQty));
  }
  return out;
}
