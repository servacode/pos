import { describe, expect, it } from 'vitest';
import { COUNT_NOUNS, countNoun, normalizeArabic, stripBidiControls, toLatinDigits } from './text';

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

describe('normalizeArabic', () => {
  it('folds the forms a shopkeeper types differently', () => {
    expect(normalizeArabic('شُوكولاتة')).toBe(normalizeArabic('شوكولاته'));
    expect(normalizeArabic('أرز إيراني')).toBe('ارز ايراني');
    expect(normalizeArabic('مُسـتـشفى')).toBe('مستشفي');
    expect(normalizeArabic('مؤسسة شاطئ')).toBe('موسسه شاطي');
    expect(normalizeArabic('  Pepsi   ٣٣٠ مل ')).toBe('pepsi 330 مل');
  });
  it('is idempotent', () => {
    for (const s of ['آلة حاسبة', 'قهوة ‎عربية', 'Nescafé ٢٠٠غ']) {
      expect(normalizeArabic(normalizeArabic(s))).toBe(normalizeArabic(s));
    }
  });
});

describe('countNoun', () => {
  it('agrees the noun with the count', () => {
    const n = (count: number) => countNoun(count, COUNT_NOUNS.variant);
    expect(n(1)).toBe('متغيّر واحد');
    expect(n(2)).toBe('متغيّران');
    expect(n(0)).toBe('0 متغيّرات');
    expect(n(3)).toBe('3 متغيّرات');
    expect(n(10)).toBe('10 متغيّرات');
    expect(n(11)).toBe('11 متغيّراً');
    expect(n(15)).toBe('15 متغيّراً');
    expect(n(100)).toBe('100 متغيّراً');
    expect(countNoun(15, COUNT_NOUNS.user)).toBe('15 مستخدماً');
    expect(countNoun(6, COUNT_NOUNS.invoice)).toBe('6 فواتير');
  });

  it('writes the dual after a preposition with the ya', () => {
    expect(countNoun(2, COUNT_NOUNS.branch, '2', true)).toBe('فرعين');
    expect(countNoun(3, COUNT_NOUNS.branch, '3', true)).toBe('3 فروع');
  });

  it('writes the number as the screen gives it', () => {
    expect(countNoun(15, COUNT_NOUNS.item, '١٥')).toBe('١٥ صنفاً');
    expect(countNoun(1, COUNT_NOUNS.item, '١')).toBe('صنف واحد');
  });
});
