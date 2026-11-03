import { roundDiv } from './money';

/**
 * Stock cost (10 › الكلفة والربح): each variant in each branch keeps its quantity and its total
 * value, never a unit cost. Goods going out take their share of the value in proportion to the
 * quantity (half away from zero); when the last piece goes, it takes whatever value is left, so
 * no qirsh is ever stranded in the books. Selling with no stock never stops a sale: the pieces
 * sold beyond what there is take the last known average, and the first purchase after settles it.
 *
 * Quantities are thousandths of the base unit (stock_movements.qty); values are minor units of
 * the base currency.
 */

export interface StockValue {
  qty: number;
  valueMinor: number;
  /** The last average known while there was stock: valueMinor ÷ qty of that moment */
  refQty: number;
  refValueMinor: number;
}

export const EMPTY_STOCK: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };

const share = (value: number, qty: number, of: number) =>
  of === 0 ? 0 : Number(roundDiv(BigInt(value) * BigInt(qty), BigInt(of)));

const withRef = (s: StockValue): StockValue =>
  s.qty > 0 ? { ...s, refQty: s.qty, refValueMinor: s.valueMinor } : s;

function assertQty(qty: number): void {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
}

/**
 * Goods in at a known value (a purchase line: what it cost, extra charges included). When the
 * stock was below nothing, the first pieces bought are the ones already sold: their real cost is
 * their share of this purchase, and the difference from what they were costed at goes to the cost
 * of sales now (`costMinor`, negative when they were costed too high).
 */
export function stockIn(
  s: StockValue,
  qty: number,
  valueMinor: number,
): { costMinor: number; after: StockValue } {
  assertQty(qty);
  if (!Number.isSafeInteger(valueMinor) || valueMinor < 0) {
    throw new RangeError(`valueMinor must be a non-negative integer, got ${valueMinor}`);
  }
  if (s.qty >= 0) {
    return {
      costMinor: 0,
      after: withRef({ ...s, qty: s.qty + qty, valueMinor: s.valueMinor + valueMinor }),
    };
  }
  const owed = Math.min(-s.qty, qty);
  // What the oversold pieces really cost, and what they were costed at
  const real = owed === qty ? valueMinor : share(valueMinor, owed, qty);
  const booked = owed === -s.qty ? -s.valueMinor : share(-s.valueMinor, owed, -s.qty);
  const after = withRef({
    ...s,
    qty: s.qty + qty,
    // The oversold pieces leave the books at what they were costed; the rest of the purchase stays
    valueMinor: s.valueMinor + booked + (valueMinor - real),
  });
  return { costMinor: real - booked, after };
}

/** What `qty` would cost at the current average (a customer's return, a surplus found in a count). */
export function averageValue(s: StockValue, qty: number): number {
  if (s.qty > 0) return share(s.valueMinor, qty, s.qty);
  return share(s.refValueMinor, qty, s.refQty);
}

/**
 * Goods back in at the current average (a customer's return, a surplus found in a count). When the
 * stock is below nothing, the pieces coming back first fill the ones sold beyond it, at what those
 * were costed, so stock back at exactly nothing is worth exactly nothing.
 */
export function stockBack(s: StockValue, qty: number): { valueMinor: number; after: StockValue } {
  assertQty(qty);
  let valueMinor: number;
  if (s.qty >= 0) {
    valueMinor = averageValue(s, qty);
  } else {
    const owed = Math.min(-s.qty, qty);
    const booked = owed === -s.qty ? -s.valueMinor : share(-s.valueMinor, owed, -s.qty);
    valueMinor = booked + (qty > owed ? share(s.refValueMinor, qty - owed, s.refQty) : 0);
  }
  return { valueMinor, after: withRef({ ...s, qty: s.qty + qty, valueMinor: s.valueMinor + valueMinor }) };
}

/** Goods out (a sale, a shortage): their cost, and the stock after. */
export function stockOut(s: StockValue, qty: number): { costMinor: number; after: StockValue } {
  assertQty(qty);
  let costMinor: number;
  if (s.qty <= 0) {
    // Nothing there: the last known average
    costMinor = share(s.refValueMinor, qty, s.refQty);
  } else if (qty < s.qty) {
    costMinor = share(s.valueMinor, qty, s.qty);
  } else {
    // The last pieces take all the value left; anything beyond goes at the last known average
    costMinor = s.valueMinor + share(s.refValueMinor, qty - s.qty, s.refQty);
  }
  return { costMinor, after: { ...s, qty: s.qty - qty, valueMinor: s.valueMinor - costMinor } };
}
