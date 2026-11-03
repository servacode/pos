import { describe, expect, it } from 'vitest';
import { barcodeModules, code128Modules, ean13Modules, ean13Valid } from './barcode';

// Expected bars from the python-barcode reference encoder (quiet zones trimmed)
const EAN_2900000000018 =
  '10100010110001101010011101001110001101010011101010111001011100101110010111001011001101001000101';
const C128_SHIRT =
  '110100100001101110100011000101000110001000101100010111011011100010100110111001011101100010011011100110001011101000110100010110001000111000110101100011101011';

const trim = (m: string) => m.replace(/^0+|0+$/g, '');

describe('barcodes for labels', () => {
  it('draws an EAN-13 exactly as the reference does, with its quiet zones', () => {
    expect(ean13Valid('2900000000018')).toBe(true);
    expect(ean13Valid('2900000000017')).toBe(false);
    expect(ean13Valid('29000000000')).toBe(false);
    const m = ean13Modules('2900000000018');
    expect(trim(m)).toBe(EAN_2900000000018);
    expect(m.length).toBe(95 + 18);
    expect(() => ean13Modules('123')).toThrow(RangeError);
  });

  it('draws Code 128 B exactly as the reference does', () => {
    expect(trim(code128Modules('SHIRT-M-RED'))).toBe(C128_SHIRT);
    expect(() => code128Modules('')).toThrow(RangeError);
    expect(() => code128Modules('قميص')).toThrow(RangeError);
  });

  it('picks EAN-13 for a valid 13-digit code and Code 128 for the rest', () => {
    expect(barcodeModules('2900000000018').kind).toBe('ean13');
    expect(barcodeModules('2900000000017').kind).toBe('code128');
    expect(barcodeModules('00123').kind).toBe('code128');
  });
});
