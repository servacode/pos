import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  CURRENCY_CODES,
  CURRENCY_IDS,
  getCurrency,
  isCurrencyId,
  type CurrencyCode,
  type CurrencyId,
} from './currencies';
import { parseRate } from './money';

describe('currency registry', () => {
  it('keys every currency by its internal id', () => {
    for (const id of CURRENCY_IDS) expect(CURRENCIES[id].id).toBe(id);
  });

  it('tells the old and the new pound apart although they share ISO SYP', () => {
    expect(CURRENCIES.SYP.iso).toBe('SYP');
    expect(CURRENCIES.SYP_OLD.iso).toBe('SYP');
    expect(CURRENCIES.SYP.id).not.toBe(CURRENCIES.SYP_OLD.id);
    expect(CURRENCIES.SYP_OLD.nameAr).toBe('ليرة سورية قديمة');
  });

  it('fixes the old pound at 100 old = 1 new', () => {
    expect(CURRENCIES.SYP_OLD.fixedRate).toEqual({ unit: 'SYP', rate: '100' });
  });

  it('offers only the active currencies to stores', () => {
    expect(CURRENCY_IDS).toEqual(['SYP', 'USD', 'SYP_OLD']);
    expect(CURRENCY_CODES).toEqual(['SYP', 'USD']);
    const code: CurrencyCode = 'USD';
    // @ts-expect-error the old pound cannot be a store's base or enabled currency
    const legacy: CurrencyCode = 'SYP_OLD';
    expect([code, legacy]).toHaveLength(2);
  });

  it('keeps display decimals separate from stored decimals', () => {
    // Spec 14: the new pound is stored in qirsh but shown without fractions; the dollar shows two places.
    expect(CURRENCIES.SYP).toMatchObject({ decimals: 2, displayDecimals: 0 });
    expect(CURRENCIES.USD).toMatchObject({ decimals: 2, displayDecimals: 2 });
    expect(CURRENCIES.SYP_OLD).toMatchObject({ decimals: 2, displayDecimals: 0 });
  });

  it('gives every currency a valid cash step and every fixed rate a direct rate to a known currency', () => {
    // Spec 10: «مثل 5 أو 10 ليرات، وربع دولار».
    expect(CURRENCIES.SYP.cashStepMinor).toBe(1000);
    expect(CURRENCIES.USD.cashStepMinor).toBe(25);
    for (const id of CURRENCY_IDS) {
      const info = getCurrency(id);
      expect(Number.isSafeInteger(info.cashStepMinor) && info.cashStepMinor >= 0, id).toBe(true);
      expect(info.displayDecimals).toBeGreaterThanOrEqual(0);
      if (info.fixedRate) {
        expect(isCurrencyId(info.fixedRate.unit), id).toBe(true);
        expect(parseRate(info.fixedRate.rate)).toBeGreaterThan(0n);
      }
    }
  });
});

describe('isCurrencyId / getCurrency', () => {
  it('accepts internal ids only', () => {
    expect(isCurrencyId('SYP_OLD')).toBe(true);
    expect(isCurrencyId('EUR')).toBe(false);
    expect(isCurrencyId('toString')).toBe(false);
    expect(isCurrencyId(1)).toBe(false);
    expect(getCurrency('USD').symbolAr).toBe('$');
    expect(() => getCurrency('EUR' as CurrencyId)).toThrow(RangeError);
  });
});
