import type { Cart } from './sale/cart';

/** The lines of a cart as one string: what was put in it, by variant and quantity. */
export function cartSignature(lines: readonly { variantId: string; qty: number }[]): string {
  return lines
    .map((l) => `${l.variantId}:${l.qty}`)
    .sort()
    .join('|');
}

interface SoldDoc {
  deviceTime: string;
  payload: unknown;
}

/**
 * Whether a cart kept on the device was already sold: a reload between «the sale is in the outbox»
 * and «the kept cart is erased» (a print window that never closed) would otherwise bring the same
 * lines back for a second sale. A sale saved after the cart was kept, with the same lines, is it.
 */
export function cartAlreadySold(cart: Cart, savedAt: number | undefined, sold: readonly SoldDoc[]): boolean {
  const signature = cartSignature(cart.lines);
  return sold.some((doc) => {
    const lines = (doc.payload as { lines?: { variantId: string; qty: number }[] } | null)?.lines;
    if (!lines || cartSignature(lines) !== signature) return false;
    const at = Date.parse(doc.deviceTime);
    return savedAt === undefined || Number.isNaN(at) || at >= savedAt;
  });
}
