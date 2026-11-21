import { describe, expect, it } from 'vitest';
import { baseToPacks, packLine, packOptionsOf, packsToBase } from './packs';

describe('packOptionsOf', () => {
  it('keeps the packs of more than one unit, one per quantity, smallest first', () => {
    expect(
      packOptionsOf([
        { packQty: 1000, packName: null },
        { packQty: 1_000_000, packName: 'كرتونة' },
        { packQty: 100_000, packName: ' علبة ' },
        { packQty: 100_000, packName: 'علبة ثانية' },
        { packQty: 12_000, packName: null },
      ]),
    ).toEqual([
      { name: 'عبوة', qty: 12_000 },
      { name: 'علبة', qty: 100_000 },
      { name: 'كرتونة', qty: 1_000_000 },
    ]);
  });

  it('has none for single units', () => {
    expect(packOptionsOf([{ packQty: 1000, packName: null }])).toEqual([]);
  });
});

describe('packsToBase', () => {
  it('turns 50 boxes of 100 into 5000 pieces', () => {
    expect(packsToBase(50_000, 100_000)).toBe(5_000_000);
  });

  it('keeps fractions of a pack that land on a thousandth', () => {
    expect(packsToBase(500, 100_000)).toBe(50_000);
  });

  it('refuses what needs a fraction of a thousandth or is not a quantity', () => {
    expect(packsToBase(1, 500)).toBeNull();
    expect(packsToBase(-1000, 1000)).toBeNull();
    expect(packsToBase(1000, 0)).toBeNull();
    expect(packsToBase(1.5, 1000)).toBeNull();
    expect(packsToBase(1000, 1.5)).toBeNull();
    expect(packsToBase(Number.MAX_SAFE_INTEGER, 1_000_000)).toBeNull();
  });
});

describe('packLine', () => {
  it('prices the line at the unit cost of the pack times the packs', () => {
    expect(packLine(50_000, 100_000, 25_000)).toEqual({ qty: 5_000_000, costMinor: 1_250_000 });
  });

  it('rounds the total once, half away from zero', () => {
    expect(packLine(2500, 10_000, 333)).toEqual({ qty: 25_000, costMinor: 833 });
  });

  it('has no total without a unit cost, and nothing when the quantity cannot be stored', () => {
    expect(packLine(1000, 12_000, null)).toEqual({ qty: 12_000, costMinor: null });
    expect(packLine(1, 500, 100)).toBeNull();
  });
});

describe('baseToPacks', () => {
  it('shows base units as packs when they divide', () => {
    expect(baseToPacks(200_000, 100_000)).toBe(2000);
    expect(baseToPacks(150_000, 100_000)).toBe(1500);
  });

  it('is null when they do not divide or are not integers', () => {
    expect(baseToPacks(1, 3000)).toBeNull();
    expect(baseToPacks(1.5, 1000)).toBeNull();
    expect(baseToPacks(1000, 0)).toBeNull();
    expect(baseToPacks(Number.MAX_SAFE_INTEGER, 1000)).toBeNull();
  });
});
