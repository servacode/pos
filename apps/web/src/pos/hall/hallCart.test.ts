import { describe, expect, it } from 'vitest';
import type { HallLine, HallOrder } from '@serva/core';
import { buildCatalog } from '../catalog';
import { addItem, EMPTY_CART } from '../sale/cart';
import { PRODUCTS, posSets } from '../../test/pos';
import { cartFromOrder, equalShare, lineIdsOf } from './hallCart';

const catalog = buildCatalog(posSets(), Date.parse('2026-11-12T10:00:00Z'));
const TEA = PRODUCTS.tea;

function line(over: Partial<HallLine>): HallLine {
  return {
    id: 'l',
    productId: TEA.product.id,
    variantId: TEA.variant.id,
    name: 'شاي',
    qty: 1,
    choices: [],
    note: null,
    seat: null,
    section: 'مشروبات',
    status: 'sent',
    ticketId: null,
    addedByName: null,
    sentAt: null,
    readyAt: null,
    servedAt: null,
    cancelReason: null,
    cancelledAfterSend: false,
    ...over,
  };
}

const order = (lines: HallLine[]): HallOrder => ({
  id: 'order-1',
  table: '4',
  guests: null,
  status: 'open',
  openedByName: null,
  openedAt: '2026-11-12T10:00:00.000Z',
  billRequestedAt: null,
  paidLineIds: [],
  equal: null,
  version: 1,
  lines,
});

describe('a server order as a till cart', () => {
  it('merges equal lines, counts the sent ones as sent, and remembers what the server holds', () => {
    const { cart, missing } = cartFromOrder(
      order([
        line({ id: 'a', qty: 2, status: 'preparing' }),
        line({ id: 'b', qty: 1, status: 'new' }),
        line({ id: 'c', qty: 1, status: 'cancelled', cancelledAfterSend: true }),
        line({
          id: 'd',
          qty: 1,
          choices: [{ group: 'الحجم', name: 'كبير', priceMinor: 5_000 }],
          note: 'حار',
        }),
      ]),
      catalog,
    );
    expect(missing).toEqual([]);
    expect(cart.lines.map((l) => [l.name, l.qty])).toEqual([
      ['شاي أحمر 400 غ', 3000],
      ['شاي أحمر 400 غ · كبير · حار', 1000],
    ]);
    expect(cart.service).toEqual({ orderType: 'dine_in', table: '4' });
    // Two were sent; the third (new) and the choice line (sent, status default) are as the server says
    expect(cart.sent).toEqual({ 1: 2000, 2: 1000 });
    expect(cart.hall).toEqual({
      orderId: 'order-1',
      known: { 1: 3000, 2: 1000 },
      lineIds: { 1: ['a', 'b'], 2: ['d'] },
    });
  });

  it('names the items this till does not have, and appends the lines typed here as not yet sent', () => {
    const typed = addItem(EMPTY_CART, catalog.byVariant.get(PRODUCTS.oil.variant.id)!);
    const { cart, missing } = cartFromOrder(
      order([line({ id: 'x', variantId: 'unknown-variant', name: 'طبق غريب' }), line({ id: 'y' })]),
      catalog,
      typed,
    );
    expect(missing).toEqual(['طبق غريب']);
    expect(cart.lines.map((l) => l.name)).toEqual(['شاي أحمر 400 غ', 'زيت دوار الشمس 1 لتر']);
    expect(cart.hall!.known).toEqual({ 1: 1000 });
    // The typed oil is not known to the server yet
    expect(cart.hall!.known[2]).toBeUndefined();
  });
});

describe('a split bill as a till cart', () => {
  const lines = [
    line({ id: 'a', qty: 2 }),
    line({ id: 'b', qty: 1, variantId: PRODUCTS.oil.variant.id, productId: PRODUCTS.oil.product.id }),
  ];

  it('leaves out the lines already charged and keeps only the picked ones as one part', () => {
    const paid = { ...order(lines), paidLineIds: ['a'] };
    expect(cartFromOrder(paid, catalog).cart.lines.map((l) => l.qty)).toEqual([1000]);

    const part = cartFromOrder(order(lines), catalog, null, { lineIds: ['b'] }).cart;
    expect(part.lines.map((l) => l.name)).toEqual(['زيت دوار الشمس 1 لتر']);
    expect(part.hall!.part).toEqual({ lineIds: ['b'] });
    expect(part.hall!.lineIds).toEqual({ 1: ['b'] });
  });

  it('cuts every line into equal shares: the first, and the last with the remainder', () => {
    const first = cartFromOrder(order(lines), catalog, null, { parts: 3 }).cart;
    expect(first.lines.map((l) => l.qty)).toEqual([666, 333]);
    expect(first.hall!.part).toEqual({ equal: { parts: 3, index: 1 } });

    const third = cartFromOrder({ ...order(lines), equal: { parts: 3, paid: 2 } }, catalog).cart;
    expect(third.lines.map((l) => l.qty)).toEqual([667, 334]);
    expect(third.hall!.part).toEqual({ equal: { parts: 3, index: 3 } });
  });

  it('shares add up to the quantity exactly for any number of parts', () => {
    for (const qty of [1000, 2000, 3500, 12345]) {
      for (let parts = 2; parts <= 30; parts++) {
        let total = 0;
        for (let index = 1; index <= parts; index++) total += equalShare(qty, { parts, index });
        expect(total).toBe(qty);
      }
    }
  });

  it('finds the server lines behind each cart line, not counting cancelled or charged ones', () => {
    const o = {
      ...order([...lines, line({ id: 'c', qty: 1, status: 'cancelled', cancelledAfterSend: true })]),
      paidLineIds: ['b'],
    };
    const { cart } = cartFromOrder(order(lines), catalog);
    expect(lineIdsOf(cart, o)).toEqual({ 1: ['a'] });
  });
});
