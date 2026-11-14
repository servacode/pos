import { describe, expect, it } from 'vitest';
import { packLineText, packPiecesNote, pieceCount } from './packText';

const fmt = (q: number) => String(q / 1000);

describe('packs on a sale line', () => {
  it('says 2 boxes of 100 are 200 pieces', () => {
    expect(packLineText({ qty: 2000, packQty: 100_000, packName: 'علبة' }, fmt)).toBe('2 علبة (200 قطعة)');
  });

  it('calls a pack with no name «عبوة»', () => {
    expect(packLineText({ qty: 1000, packQty: 12_000, packName: null }, fmt)).toBe('1 عبوة (12 قطعة)');
    expect(packLineText({ qty: 1000, packQty: 12_000 }, fmt)).toBe('1 عبوة (12 قطعة)');
  });

  it('has nothing to say of single units, weights or an old line without a pack size', () => {
    expect(packLineText({ qty: 3000, packQty: 1000, packName: null }, fmt)).toBeNull();
    expect(packPiecesNote({ qty: 250, packQty: 1000 }, fmt)).toBeNull();
    expect(packPiecesNote({ qty: 250 }, fmt)).toBeNull();
  });

  it('counts a half pack in pieces', () => {
    expect(pieceCount({ qty: 500, packQty: 100_000 })).toBe(50_000);
    expect(packPiecesNote({ qty: 500, packQty: 100_000 }, fmt)).toBe('(50 قطعة)');
  });
});
