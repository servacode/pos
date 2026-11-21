import { describe, expect, it } from 'vitest';
import type { Cart } from './sale/cart';
import { cartAlreadySold, cartSignature } from './soldCart';

const cart = {
  lines: [
    { variantId: 'a', qty: 1000 },
    { variantId: 'b', qty: 2000 },
  ],
} as unknown as Cart;
const doc = (lines: { variantId: string; qty: number }[], deviceTime: string) => ({
  deviceTime,
  payload: { lines },
});

describe('a kept cart that was already sold', () => {
  it('signs the lines whatever their order', () => {
    expect(
      cartSignature([
        { variantId: 'b', qty: 2000 },
        { variantId: 'a', qty: 1000 },
      ]),
    ).toBe('a:1000|b:2000');
  });
  it('is dropped when a sale with the same lines was saved after it was kept', () => {
    const sold = [
      doc(
        [
          { variantId: 'b', qty: 2000 },
          { variantId: 'a', qty: 1000 },
        ],
        '2026-01-01T10:05:00.000Z',
      ),
    ];
    expect(cartAlreadySold(cart, Date.parse('2026-01-01T10:00:00.000Z'), sold)).toBe(true);
  });
  it('is kept when the sale came before it, differs, or has no lines', () => {
    const lines = [
      { variantId: 'a', qty: 1000 },
      { variantId: 'b', qty: 2000 },
    ];
    const at = Date.parse('2026-01-01T10:00:00.000Z');
    expect(cartAlreadySold(cart, at, [doc(lines, '2026-01-01T09:00:00.000Z')])).toBe(false);
    expect(
      cartAlreadySold(cart, at, [doc([{ variantId: 'a', qty: 1000 }], '2026-01-01T11:00:00.000Z')]),
    ).toBe(false);
    expect(cartAlreadySold(cart, at, [{ deviceTime: '2026-01-01T11:00:00.000Z', payload: null }])).toBe(
      false,
    );
  });
  it('without a kept time, a sale with the same lines counts', () => {
    const lines = [
      { variantId: 'a', qty: 1000 },
      { variantId: 'b', qty: 2000 },
    ];
    expect(cartAlreadySold(cart, undefined, [doc(lines, 'bad')])).toBe(true);
  });
});
