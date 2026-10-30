import { describe, expect, it } from 'vitest';
import { stripBidiControls, toLatinDigits } from './text';

describe('toLatinDigits', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toLatinDigits('0912 ٣٤٥ ۶۷۸')).toBe('0912 345 678');
  });

  it('converts the Arabic decimal and thousands separators', () => {
    expect(toLatinDigits('١٢٫٥٠')).toBe('12.50');
    expect(toLatinDigits('١٬٢٣٤٬٥٦٧٫٨٩')).toBe('1,234,567.89');
  });

  it('converts the minus sign (U+2212) to a hyphen-minus', () => {
    expect(toLatinDigits('−١٢٫٥')).toBe('-12.5');
    expect(toLatinDigits('−12.50')).toBe('-12.50');
  });

  it('leaves letters, the Arabic comma and other punctuation alone', () => {
    expect(toLatinDigits('صنف، رقم ٥')).toBe('صنف، رقم 5');
    expect(toLatinDigits('+963 (944) 12-34')).toBe('+963 (944) 12-34');
    expect(toLatinDigits('')).toBe('');
  });
});

describe('stripBidiControls', () => {
  it('removes direction marks, embeddings and isolates', () => {
    const controls = '\u200e\u200f\u061c\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
    expect(stripBidiControls(`${controls}١٢٫٥${controls}`)).toBe('١٢٫٥');
    expect(stripBidiControls('\u2067\u2066−1,250\u2069 ل.س\u2069')).toBe('−1,250 ل.س');
    expect(stripBidiControls('بلا علامات')).toBe('بلا علامات');
  });
});
