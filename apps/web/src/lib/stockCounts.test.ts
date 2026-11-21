import { describe, expect, it } from 'vitest';
import { countStock, negativeNote } from './stockCounts';

describe('countStock', () => {
  it('adds the branches of a combination first, counts below zero as out and as negative once', () => {
    const counts = countStock([
      { variantId: 'a', productId: 'p1', qty: 5000 },
      { variantId: 'a', productId: 'p1', qty: -2000 },
      { variantId: 'b', productId: 'p1', qty: 0 },
      { variantId: 'c', productId: 'p2', qty: -3000 },
      { variantId: 'd', qty: 7000 },
    ]);
    expect(counts).toEqual({ kinds: 4, pieces: 10000, soldOut: 2, negative: 1, soldOutProducts: 2 });
    expect(negativeNote(counts.negative)).toBe('منها سالب 1');
  });
  it('is all zero for an empty store', () => {
    expect(countStock([])).toEqual({ kinds: 0, pieces: 0, soldOut: 0, negative: 0, soldOutProducts: 0 });
  });
});
