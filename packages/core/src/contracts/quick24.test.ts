import { describe, expect, it } from 'vitest';
import { storeCurrencyInput, rateWarning } from './store';
import { DEFAULT_CASH_NOTES, oldPoundText, tillSettingsSchema } from './till';

describe('the dollar rate sanity check', () => {
  it('accepts a normal new-pound rate without a word', () => {
    expect(rateWarning('120')).toBeNull();
    expect(rateWarning('125.5', '120')).toBeNull();
    expect(rateWarning('١٢٠', '118')).toBeNull();
    expect(rateWarning('450', '120')).toBeNull();
  });

  it('warns on a rate outside 50 to 500 and on a jump of ten times', () => {
    expect(rateWarning('13000')).toMatch(/خارج المعتاد/);
    expect(rateWarning('13,000')).toMatch(/خارج المعتاد/);
    expect(rateWarning('12')).toMatch(/خارج المعتاد/);
    expect(rateWarning('1300', '120')).toMatch(/عشرة أضعاف/);
    expect(rateWarning('12', '130')).toMatch(/عشرة أضعاف/);
  });

  it('stays quiet about what the schema refuses anyway', () => {
    expect(rateWarning('')).toBeNull();
    expect(rateWarning('0')).toBeNull();
    expect(rateWarning('abc')).toBeNull();
  });

  it('still accepts a rate of 120 and words the refusal with an example of 120', () => {
    expect(storeCurrencyInput.safeParse({ usdEnabled: true, usdRate: '120' }).success).toBe(true);
    const bad = storeCurrencyInput.safeParse({ usdEnabled: true, usdRate: 'مئة' });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('مثل 120');
  });
});

describe('new-pound defaults', () => {
  it('counts a new store by the new notes, high to low', () => {
    expect(DEFAULT_CASH_NOTES.SYP).toEqual([500, 200, 100, 50, 25, 10, 5]);
  });

  it('keeps the old-pound line, the beep and the cashier lock as optional till settings', () => {
    const base = { returnWindowDays: null, cardApprovalRequired: false };
    expect(tillSettingsSchema.parse(base)).toEqual(base);
    expect(
      tillSettingsSchema.parse({ ...base, showOldPound: true, scanBeep: false, cashierLock: true }),
    ).toMatchObject({ showOldPound: true, scanBeep: false, cashierLock: true });
  });

  it('writes an amount of new pounds as the old pounds it equals', () => {
    expect(oldPoundText(12_500)).toBe('12,500');
    expect(oldPoundText(100)).toBe('100');
    expect(oldPoundText(1_234_567)).toBe('1,234,567');
    expect(oldPoundText(-250)).toBe('-250');
  });
});
