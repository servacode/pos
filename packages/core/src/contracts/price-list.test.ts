import { describe, expect, it } from 'vitest';
import {
  barcodeCell,
  guessPriceListFields,
  parsePriceCell,
  priceListApplyInput,
  priceListPreviewInput,
} from './price-list';

describe('guessPriceListFields', () => {
  it('knows the headers of a ministry list and of a warehouse sheet', () => {
    expect(guessPriceListFields(['الباركود', 'الاسم التجاري', 'الاسم العلمي', 'سعر المستهلك'])).toEqual([
      'barcode',
      'name',
      'generic',
      'price',
    ]);
    expect(guessPriceListFields(['Barcode', 'Item Name', 'Public Price'])).toEqual([
      'barcode',
      'name',
      'price',
    ]);
  });

  it('does not take the purchase or wholesale price for the shelf price, and guesses a field once', () => {
    expect(guessPriceListFields(['سعر الشراء', 'سعر الجملة', 'سعر البيع', 'سعر المفرق'])).toEqual([
      null,
      null,
      'price',
      null,
    ]);
    expect(guessPriceListFields(['', 'غير معروف'])).toEqual([null, null]);
  });
});

describe('parsePriceCell', () => {
  it.each([
    [12_500, 0, 12_500],
    ['12,500', 0, 12_500],
    ['١٢٬٥٠٠ ل.س', 0, 12_500],
    ['12.50', 2, 1_250],
    ['1.250,50', 2, 125_050],
    ['1,250.50', 2, 125_050],
    ['2,5', 2, 250],
    ['1.250.000', 0, 1_250_000],
    ['٣٫٧٥', 2, 375],
  ])('reads %s as %i minor units at %i decimals', (cell, decimals, minor) => {
    expect(parsePriceCell(cell, decimals)).toBe(minor);
  });

  it('refuses what is not a positive amount', () => {
    expect(parsePriceCell(null, 0)).toBeNull();
    expect(parsePriceCell('abc', 0)).toBeNull();
    expect(parsePriceCell('0', 0)).toBeNull();
    expect(parsePriceCell(-5, 0)).toBeNull();
    expect(parsePriceCell('1.2.3', 0)).toBeNull();
    expect(parsePriceCell('9'.repeat(30), 0)).toBeNull();
  });
});

describe('barcodeCell', () => {
  it('keeps digits, drops spaces and empties', () => {
    expect(barcodeCell(6291003012345)).toBe('6291003012345');
    expect(barcodeCell(' ٦٢٩ ١٠٠ ')).toBe('629100');
    expect(barcodeCell('  ')).toBeNull();
    expect(barcodeCell(null)).toBeNull();
  });
});

describe('inputs', () => {
  it('defaults the optional fields and rejects empty lists and non-positive prices', () => {
    expect(priceListPreviewInput.parse({ rows: [{ row: 2, priceMinor: 5 }] }).rows[0]).toEqual({
      row: 2,
      barcode: null,
      name: null,
      generic: null,
      priceMinor: 5,
    });
    expect(priceListPreviewInput.safeParse({ rows: [] }).success).toBe(false);
    expect(priceListPreviewInput.safeParse({ rows: [{ row: 2, priceMinor: 0 }] }).success).toBe(false);
    expect(
      priceListApplyInput.parse({ changes: [{ variantId: crypto.randomUUID(), newMinor: 1 }] }).fileName,
    ).toBeNull();
  });
});
