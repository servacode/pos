import type { HoldPlaced, OnlineOrderRow } from '@serva/core/contracts/shop';
import { APP_VERSION } from '../../offline/sync';
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
    onlineOrder: {
      id: order.id,
      number: order.number,
      customerName: order.customerName,
      ...(order.couponRule ? { couponRule: order.couponRule } : {}),
    },
    // A hold's deposit, paid as a voucher, comes off first at payment
    ...(order.depositCode ? { voucher: order.depositCode } : {}),
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

/** holdInput of `@serva/core` (contracts/shop) */
export interface HoldInput {
  customerName: string;
  phone: string;
  note?: string | null;
  depositCode: string | null;
  lines: { variantId: string; qty: number }[];
}

export type HoldAnswer =
  | { kind: 'ok'; body: HoldPlaced }
  /** Refused, with the server's words (a piece no longer sold, a wrong phone…) */
  | { kind: 'refused'; message: string }
  /** No answer: the hold needs the server */
  | { kind: 'network' };

/** POST /v1/device/holds (`Authorization: Device <token>`): the cart held for a customer */
export async function postHold(
  input: HoldInput,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<HoldAnswer> {
  let res: Response;
  try {
    res = await fetchFn('/v1/device/holds', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Device ${token}`,
        'X-App-Version': APP_VERSION,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { kind: 'network' };
  }
  const body = (await res.json().catch(() => null)) as
    (HoldPlaced & { error?: { message?: string; fields?: Record<string, string> } }) | null;
  if (res.ok && body) return { kind: 'ok', body };
  if (res.status >= 500 || !body) return { kind: 'network' };
  const fields = Object.values(body.error?.fields ?? {});
  return { kind: 'refused', message: fields[0] ?? body.error?.message ?? 'رُفض الحجز.' };
}
