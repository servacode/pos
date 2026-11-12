import { describe, expect, it } from 'vitest';
import type { HallLine, HallOrder } from '@serva/core';
import { buildCatalog } from '../catalog';
import { addItem, EMPTY_CART } from '../sale/cart';
import { PRODUCTS, posSets } from '../../test/pos';
import { cartFromOrder } from './hallCart';

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
    expect(cart.hall).toEqual({ orderId: 'order-1', known: { 1: 3000, 2: 1000 } });
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
