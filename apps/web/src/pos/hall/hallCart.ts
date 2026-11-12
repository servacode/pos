import type { HallLine, HallOrder } from '@serva/core';
import type { Catalog } from '../catalog';
import { addItem, type Cart, type Choice } from '../sale/cart';

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
): { cart: Cart; missing: string[] } {
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
    if (line.status === 'cancelled') continue;
    const item = catalog.byVariant.get(line.variantId);
    if (!item) {
      missing.push(line.name);
      continue;
    }
    cart = addItem(cart, item, null, line.qty * 1000, { choices: line.choices, note: line.note });
    const lineNo = lineNoOf(line, cart)!;
    known[lineNo] = (known[lineNo] ?? 0) + line.qty * 1000;
    if (line.status !== 'new') sent[lineNo] = (sent[lineNo] ?? 0) + line.qty * 1000;
  }

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
      hall: { orderId: order.id, known },
    },
    missing,
  };
}
