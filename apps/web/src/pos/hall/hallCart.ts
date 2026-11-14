import type { HallLine, HallOrder } from '@serva/core';
import type { Catalog } from '../catalog';
import { addItem, type Cart, type Choice } from '../sale/cart';

/**
 * One share of a quantity (thousandths) split into `parts`: share `index` (from 1) is what the
 * running total reaches at `index` minus what it reached at `index - 1`, so the last share takes
 * the rounding remainder and the shares add up to the quantity exactly.
 */
export function equalShare(qty: number, split: { parts: number; index: number }): number {
  const upTo = (n: number) => Math.floor((qty * n) / split.parts);
  return upTo(split.index) - upTo(split.index - 1);
}

const choiceKey = (choices: readonly Choice[] | undefined, note: string | null | undefined) =>
  JSON.stringify([(choices ?? []).map((c) => [c.group, c.name]), note ?? null]);

/**
 * A server order brought to the till as a cart (03 › وضع النادل): every line that is not cancelled,
 * priced from this till's own catalog. Lines already with the kitchen count as sent, so «للمطبخ»
 * prints only what comes next; `hall.known` is what the server already holds, line by line.
 * `extra` lines (typed at the till before the table was picked) are added after, as not yet sent.
 */
export function cartFromOrder(
  order: HallOrder,
  catalog: Catalog,
  extra: Cart | null = null,
  /** A split bill: only these lines as one part, or the next equal share of `parts` */
  split: { lineIds: readonly string[] } | { parts: number } | null = null,
): { cart: Cart; missing: string[] } {
  const paid = new Set(order.paidLineIds);
  const only = split && 'lineIds' in split ? new Set(split.lineIds) : null;
  const lineIds: Record<number, string[]> = {};
  let cart: Cart = { lines: [], nextLineNo: 1, invoiceDiscount: null, invoiceApproval: null };
  const sent: Record<number, number> = {};
  const known: Record<number, number> = {};
  const missing: string[] = [];

  const lineNoOf = (line: HallLine, after: Cart) =>
    after.lines.find(
      (l) =>
        l.variantId === line.variantId && choiceKey(l.choices, l.note) === choiceKey(line.choices, line.note),
    )?.lineNo;

  for (const line of order.lines) {
    if (line.status === 'cancelled' || paid.has(line.id) || (only && !only.has(line.id))) continue;
    const item = catalog.byVariant.get(line.variantId);
    if (!item) {
      missing.push(line.name);
      continue;
    }
    cart = addItem(cart, item, null, line.qty * 1000, { choices: line.choices, note: line.note });
    const lineNo = lineNoOf(line, cart)!;
    known[lineNo] = (known[lineNo] ?? 0) + line.qty * 1000;
    lineIds[lineNo] = [...(lineIds[lineNo] ?? []), line.id];
    if (line.status !== 'new') sent[lineNo] = (sent[lineNo] ?? 0) + line.qty * 1000;
  }

  // A table split in equal parts: this cart is the next share, every line cut the same way
  const parts = only ? null : (order.equal?.parts ?? (split && 'parts' in split ? split.parts : null));
  const equal = parts ? { parts, index: (order.equal?.paid ?? 0) + 1 } : null;
  if (equal) cart = { ...cart, lines: cart.lines.map((l) => ({ ...l, qty: equalShare(l.qty, equal) })) };

  for (const line of extra?.lines ?? []) {
    const item = catalog.byVariant.get(line.variantId);
    if (item)
      cart = addItem(cart, item, null, line.qty, { choices: line.choices ?? [], note: line.note ?? null });
  }

  return {
    cart: {
      ...cart,
      service: { orderType: 'dine_in', table: order.table },
      sent,
      hall: {
        orderId: order.id,
        known,
        lineIds,
        ...(only ? { part: { lineIds: [...only] } } : equal ? { part: { equal } } : {}),
      },
    },
    missing,
  };
}

/**
 * The server's lines behind each line of a cart just sent: same item, choices and note, not
 * cancelled and not charged. A cancellation at the till goes to these.
 */
export function lineIdsOf(cart: Cart, order: HallOrder): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const paid = new Set(order.paidLineIds);
  for (const l of cart.lines) {
    const key = choiceKey(l.choices, l.note);
    const ids = order.lines
      .filter(
        (s) =>
          s.status !== 'cancelled' &&
          !paid.has(s.id) &&
          s.variantId === l.variantId &&
          choiceKey(s.choices, s.note) === key,
      )
      .map((s) => s.id);
    if (ids.length > 0) out[l.lineNo] = ids;
  }
  return out;
}
