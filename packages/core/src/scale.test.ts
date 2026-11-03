import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_BARCODE,
  ean13CheckDigit,
  parseScaleBarcode,
  qtyForPrice,
  scaleBarcodeSchema,
  type ScaleBarcodeConfig,
} from './scale';

/** A full label from its first twelve digits. */
const label = (first12: string) => `${first12}${ean13CheckDigit(first12)}`;

describe('ean13CheckDigit', () => {
  it('matches printed EAN-13 codes', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('200000000000')).toBe(8);
  });

  it('refuses anything but twelve digits', () => {
    expect(() => ean13CheckDigit('12345')).toThrow(RangeError);
    expect(() => ean13CheckDigit('62812345000a')).toThrow(RangeError);
  });
});

describe('parseScaleBarcode', () => {
  it('reads the item and a weight in grams (1.250 kg = 1250 thousandths)', () => {
    expect(parseScaleBarcode(label('210012301250'), DEFAULT_SCALE_BARCODE)).toEqual({
      itemCode: '00123',
      kind: 'weight',
      qty: 1250,
    });
  });

  it('scales a weight printed with two decimals to thousandths', () => {
    const config: ScaleBarcodeConfig = { ...DEFAULT_SCALE_BARCODE, itemDigits: 4, valueDecimals: 2 };
    expect(parseScaleBarcode(label('200042000125'), config)).toEqual({
      itemCode: '0042',
      kind: 'weight',
      qty: 1250,
    });
  });

  it('reads a price label in whole pounds or with decimals', () => {
    const pounds: ScaleBarcodeConfig = { ...DEFAULT_SCALE_BARCODE, valueKind: 'price', valueDecimals: 0 };
    expect(parseScaleBarcode(label('220012312500'), pounds)).toEqual({
      itemCode: '00123',
      kind: 'price',
      priceMinor: 1_250_000,
    });
    const cents: ScaleBarcodeConfig = { ...pounds, itemDigits: 6, valueDecimals: 2 };
    expect(parseScaleBarcode(label('220001231250'), cents)).toEqual({
      itemCode: '000123',
      kind: 'price',
      priceMinor: 1250,
    });
  });

  it('is not a scale label: wrong length, letters, an unused prefix, a bad check digit, nothing weighed', () => {
    const c = DEFAULT_SCALE_BARCODE;
    expect(parseScaleBarcode('21001230125', c)).toBeNull();
    expect(parseScaleBarcode('21001230125a0', c)).toBeNull();
    expect(parseScaleBarcode(label('290012301250'), c)).toBeNull();
    expect(parseScaleBarcode(label('210012301250'), { ...c, prefixes: ['20'] })).toBeNull();
    const good = label('210012301250');
    const bad = `${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`;
    expect(parseScaleBarcode(bad, c)).toBeNull();
    expect(parseScaleBarcode(label('210012300000'), c)).toBeNull();
  });
});

describe('qtyForPrice', () => {
  it('turns a label price into the quantity it buys, half up', () => {
    expect(qtyForPrice(1_250_000, 1_000_000)).toBe(1250);
    expect(qtyForPrice(1, 3)).toBe(333);
    expect(qtyForPrice(2, 3)).toBe(667);
    expect(qtyForPrice(1, 10_000_000)).toBe(1);
  });

  it('needs a price on both sides', () => {
    expect(() => qtyForPrice(0, 100)).toThrow(RangeError);
    expect(() => qtyForPrice(100, 0)).toThrow(/needs a price/);
    expect(() => qtyForPrice(1.5, 100)).toThrow(RangeError);
  });
});

describe('scaleBarcodeSchema', () => {
  it('accepts the default and refuses the internal prefix 29, short items and a price in thousandths', () => {
    expect(scaleBarcodeSchema.parse(DEFAULT_SCALE_BARCODE)).toEqual(DEFAULT_SCALE_BARCODE);
    expect(scaleBarcodeSchema.safeParse({ ...DEFAULT_SCALE_BARCODE, prefixes: ['29'] }).success).toBe(false);
    expect(scaleBarcodeSchema.safeParse({ ...DEFAULT_SCALE_BARCODE, prefixes: [] }).success).toBe(false);
    expect(scaleBarcodeSchema.safeParse({ ...DEFAULT_SCALE_BARCODE, itemDigits: 3 }).success).toBe(false);
    expect(
      scaleBarcodeSchema.safeParse({ ...DEFAULT_SCALE_BARCODE, valueKind: 'price', valueDecimals: 3 })
        .success,
    ).toBe(false);
  });
});
