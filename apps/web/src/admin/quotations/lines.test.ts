import { describe, expect, it } from 'vitest';
import {
  editorLineOf,
  lineInput,
  moneyOf,
  moneyText,
  packPriceOf,
  percentOf,
  qtyOf,
  type EditorLine,
} from './lines';

const line = (over: Partial<EditorLine> = {}): EditorLine => ({
  key: 1,
  productId: null,
  variantId: null,
  name: 'قفازات',
  unitName: null,
  packName: null,
  packQty: 1000,
  pieceMinor: 10_000,
  qty: '2',
  price: '100',
  discount: '',
  taxRateId: null,
  taxRateBp: 0,
  ...over,
});

describe('typed numbers', () => {
  it('reads quantities in thousandths, in either digits', () => {
    expect(qtyOf('2')).toBe(2000);
    expect(qtyOf('0.250')).toBe(250);
    expect(qtyOf('١٢٫٥')).toBe(12_500);
    for (const bad of ['', '0', 'x', '1.2345', '-1']) expect(qtyOf(bad)).toBeNull();
  });

  it('reads prices in minor units', () => {
    expect(moneyOf('1,250.50')).toBe(125_050);
    expect(moneyOf('٩٠٠')).toBe(90_000);
    expect(moneyOf('1.234')).toBeNull();
    expect(moneyOf('')).toBeNull();
    expect(moneyText(125_050)).toBe('1250.5');
  });

  it('reads a discount percentage up to 100, and nothing as none', () => {
    expect(percentOf('')).toBe(0);
    expect(percentOf('10')).toBe(1000);
    expect(percentOf('7.5')).toBe(750);
    expect(percentOf('100')).toBe(10_000);
    expect(percentOf('101')).toBeNull();
    expect(percentOf('abc')).toBeNull();
  });
});

describe('packs', () => {
  it('takes the pack’s own price, else the piece price times its size', () => {
    const l = line({ packPrices: { 12_000: 100_000 } });
    expect(packPriceOf(l, 12_000)).toBe(100_000);
    expect(packPriceOf(l, 6_000)).toBe(60_000);
    expect(packPriceOf(line({ pieceMinor: null }), 6_000)).toBeNull();
  });
});

describe('lineInput', () => {
  it('builds what the server takes', () => {
    expect(lineInput(line({ discount: '10', taxRateId: 't', taxRateBp: 500 }))).toMatchObject({
      qty: 2000,
      unitPriceMinor: 10_000,
      discount: { type: 'percent', bp: 1000 },
      taxRateId: 't',
      taxRateBp: 500,
    });
  });

  it('names the first wrong field', () => {
    expect(lineInput(line({ qty: 'x' }))).toEqual({ error: 'qty' });
    expect(lineInput(line({ price: '' }))).toEqual({ error: 'price' });
    expect(lineInput(line({ discount: '200' }))).toEqual({ error: 'discount' });
  });

  it('keeps a fixed discount the till took until a percent is typed', () => {
    const kept = line({ amountDiscountMinor: 500 });
    expect(lineInput(kept)).toMatchObject({ discount: { type: 'amount', minor: 500 } });
    expect(lineInput({ ...kept, discount: '5' })).toMatchObject({ discount: { type: 'percent', bp: 500 } });
  });
});

describe('editorLineOf', () => {
  it('brings a saved line back with its discount', () => {
    const base = {
      lineNo: 1,
      productId: null,
      variantId: null,
      name: 'أ',
      unitName: null,
      packName: null,
      packQty: 1000,
      qty: 1500,
      unitPriceMinor: 12_500,
      taxRateId: null,
      taxRateBp: 0,
      priced: {} as never,
    };
    expect(editorLineOf({ ...base, discount: { type: 'percent', bp: 750 } })).toMatchObject({
      qty: '1.5',
      price: '125',
      discount: '7.5',
    });
    expect(editorLineOf({ ...base, discount: { type: 'amount', minor: 300 } })).toMatchObject({
      discount: '',
      amountDiscountMinor: 300,
    });
    expect(editorLineOf({ ...base, discount: null }).discount).toBe('');
  });
});
