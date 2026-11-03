import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { averageValue, EMPTY_STOCK, stockBack, stockIn, stockOut, type StockValue } from './costing';

const PIECE = 1000;

describe('stock cost by value (10 › الكلفة والربح)', () => {
  it('the worked example: 10 at 20,000 and 20 bought at 46,000; six go out at 13,200', () => {
    let s = stockIn(EMPTY_STOCK, 10 * PIECE, 20_000_00).after;
    s = stockIn(s, 20 * PIECE, 46_000_00).after;
    const out = stockOut(s, 6 * PIECE);
    expect(out.costMinor).toBe(13_200_00);
    expect(out.after).toMatchObject({ qty: 24 * PIECE, valueMinor: 52_800_00 });
  });

  it('the bonus example: 10 + 1 for 50,000 goes out to exactly 50,000, the last piece taking the rest', () => {
    let s = stockIn(EMPTY_STOCK, 11 * PIECE, 50_000_00).after;
    const costs: number[] = [];
    for (let i = 0; i < 11; i++) {
      const out = stockOut(s, PIECE);
      costs.push(out.costMinor);
      s = out.after;
    }
    expect(costs[0]).toBe(4_545_45);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(50_000_00);
    expect(s).toMatchObject({ qty: 0, valueMinor: 0 });
  });

  it('any order of ins and outs keeps value and cost adding up to the qirsh', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              in: fc.integer({ min: 1, max: 50 }),
              value: fc.integer({ min: 0, max: 10_000_000 }),
            }),
            fc.record({ out: fc.integer({ min: 1, max: 50 }) }),
            fc.record({ back: fc.integer({ min: 1, max: 5 }) }),
          ),
          { maxLength: 40 },
        ),
        (steps) => {
          let s: StockValue = EMPTY_STOCK;
          let valueIn = 0;
          let costOut = 0;
          for (const step of steps) {
            if ('in' in step) {
              const got = stockIn(s, step.in * PIECE, step.value);
              valueIn += step.value;
              costOut += got.costMinor;
              s = got.after;
            } else if ('out' in step) {
              const out = stockOut(s, step.out * PIECE);
              costOut += out.costMinor;
              s = out.after;
            } else {
              const back = stockBack(s, step.back * PIECE);
              valueIn += back.valueMinor;
              s = back.after;
            }
            // What is on the books is always what came in less what went out
            expect(s.valueMinor).toBe(valueIn - costOut);
          }
          // Stock is never worth less than nothing while there is some, nor anything when there is none
          if (s.qty > 0) expect(s.valueMinor).toBeGreaterThanOrEqual(0);
          if (s.qty === 0) expect(s.valueMinor).toBe(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('sells beyond the stock at the last known average, and the next purchase settles the gap', () => {
    let s = stockIn(EMPTY_STOCK, 2 * PIECE, 2_000).after;
    const out = stockOut(s, 3 * PIECE);
    expect(out.costMinor).toBe(3_000);
    s = out.after;
    expect(s).toMatchObject({ qty: -PIECE, valueMinor: -1_000 });
    expect(stockOut(s, PIECE).costMinor).toBe(1_000);
    // One piece bought at 1,500 brings it back to nothing: the 500 difference is a cost now
    expect(stockIn(s, PIECE, 1_500)).toMatchObject({ costMinor: 500, after: { qty: 0, valueMinor: 0 } });
    // Three bought at 2,400: the oversold one really cost 800, 200 less than costed; two stay at 1,600
    expect(stockIn(s, 3 * PIECE, 2_400)).toMatchObject({
      costMinor: -200,
      after: { qty: 2 * PIECE, valueMinor: 1_600 },
    });
    expect(stockIn(EMPTY_STOCK, PIECE, 7).costMinor).toBe(0);
  });

  it('values returns and surpluses at the current average, and nothing when nothing was ever known', () => {
    const s = stockIn(EMPTY_STOCK, 4 * PIECE, 1_000).after;
    expect(averageValue(s, PIECE)).toBe(250);
    expect(stockBack(s, PIECE)).toEqual({
      valueMinor: 250,
      after: { qty: 5 * PIECE, valueMinor: 1_250, refQty: 5 * PIECE, refValueMinor: 1_250 },
    });
    expect(stockBack(EMPTY_STOCK, PIECE).valueMinor).toBe(0);
    expect(stockOut(EMPTY_STOCK, PIECE).costMinor).toBe(0);
    // An empty shelf remembers its last average
    const empty = stockOut(s, 4 * PIECE).after;
    expect(averageValue(empty, 2 * PIECE)).toBe(500);
  });

  it('refuses quantities and values that cannot be', () => {
    expect(() => stockIn(EMPTY_STOCK, 0, 1)).toThrow(RangeError);
    expect(() => stockIn(EMPTY_STOCK, 1.5, 1)).toThrow(RangeError);
    expect(() => stockIn(EMPTY_STOCK, 1, -1)).toThrow(RangeError);
    expect(() => stockOut(EMPTY_STOCK, -1)).toThrow(RangeError);
    expect(() => stockBack(EMPTY_STOCK, 0)).toThrow(RangeError);
  });

  it('averages what is left, not what was there before a sale took its rounded share', () => {
    // 3 for 10: one goes at 3 (3.33), two stay worth 7; one of them is worth 4 (3.5) now
    const s = stockOut(stockIn(EMPTY_STOCK, 3 * PIECE, 10).after, PIECE).after;
    expect(s).toMatchObject({ qty: 2 * PIECE, valueMinor: 7 });
    expect(averageValue(s, PIECE)).toBe(4);
  });

  it('keeps the last real average when a purchase brings oversold stock back to exactly nothing', () => {
    let s = stockIn(EMPTY_STOCK, 2 * PIECE, 2_000).after;
    s = stockOut(s, 3 * PIECE).after;
    s = stockIn(s, PIECE, 1_500).after;
    expect(s).toMatchObject({ qty: 0, valueMinor: 0 });
    // Sold again with nothing there: at the last average known while there was stock
    expect(stockOut(s, PIECE).costMinor).toBe(1_000);
  });

  it("settles part of a purchase when more is bought than was oversold, by each piece's share", () => {
    // Oversold 3 at an average of 100 (booked 300); 4 bought for 1,000: the 3 really cost 750
    let s = stockIn(EMPTY_STOCK, PIECE, 100).after;
    s = stockOut(s, 4 * PIECE).after;
    expect(s).toMatchObject({ qty: -3 * PIECE, valueMinor: -300 });
    const got = stockIn(s, 4 * PIECE, 1_000);
    expect(got.costMinor).toBe(450);
    expect(got.after).toMatchObject({ qty: PIECE, valueMinor: 250 });
    // Bought fewer than were oversold: all of it goes to the pieces already sold
    const part = stockIn(s, PIECE, 120);
    expect(part.costMinor).toBe(20);
    expect(part.after).toMatchObject({ qty: -2 * PIECE, valueMinor: -200 });
  });

  it('says what is wrong with a quantity or a value', () => {
    expect(() => stockOut(EMPTY_STOCK, 0)).toThrow('qty must be a positive integer, got 0');
    expect(() => stockIn(EMPTY_STOCK, PIECE, -5)).toThrow(
      'valueMinor must be a non-negative integer, got -5',
    );
  });
});
