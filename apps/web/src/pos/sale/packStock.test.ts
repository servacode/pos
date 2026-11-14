import { describe, expect, it } from 'vitest';
import { stockInPacks } from './packStock';

const pieces = (q: number) => String(q / 1000);

describe('stockInPacks', () => {
  it('shows boxes and loose pieces, with the total in pieces', () => {
    expect(stockInPacks(480_000, { name: null, qty: 100_000 }, 'latn', pieces)).toBe(
      '4 علب و80 قطعة (480 قطعة)',
    );
  });

  it('counts one and two boxes in Arabic, and ten and more', () => {
    const pack = { name: null, qty: 12_000 };
    expect(stockInPacks(12_000, pack, 'latn', pieces)).toBe('علبة (12 قطعة)');
    expect(stockInPacks(26_000, pack, 'latn', pieces)).toBe('علبتان و2 قطعة (26 قطعة)');
    expect(stockInPacks(132_000, pack, 'latn', pieces)).toBe('11 علبة (132 قطعة)');
  });

  it('uses the pack’s own name, and stays in pieces below one box or with no pack', () => {
    expect(stockInPacks(250_000, { name: 'كرتونة', qty: 100_000 }, 'latn', pieces)).toBe(
      '2 كرتونة و50 قطعة (250 قطعة)',
    );
    expect(stockInPacks(5_000, { name: null, qty: 12_000 }, 'latn', pieces)).toBe('5 قطعة');
    expect(stockInPacks(5_000, null, 'latn', pieces)).toBe('5 قطعة');
    expect(stockInPacks(5_000, { name: null, qty: 1_000 }, 'latn', pieces)).toBe('5 قطعة');
  });
});
