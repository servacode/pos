import type { Catalog } from '../catalog';
import type { Cart, CartLine } from './cart';

/**
 * A service with no fixed fee gets its fee from the cashier. A line of such a service that still has
 * no fee (the screen was reloaded or closed before it was typed) is not a sale: it is dropped on
 * restore and never lets «ادفع» through.
 */
export function isUnfedService(line: CartLine, byVariant: Catalog['byVariant']): boolean {
  const item = byVariant.get(line.variantId);
  return Boolean(item?.isService && item.price.priceMinor === 0 && line.priceMinor === 0 && !line.adjustment);
}

/** The cart without its fee-less service lines */
export function withoutUnfedServices(cart: Cart, byVariant: Catalog['byVariant']): Cart {
  if (!cart.lines.some((l) => isUnfedService(l, byVariant))) return cart;
  return { ...cart, lines: cart.lines.filter((l) => !isUnfedService(l, byVariant)) };
}
