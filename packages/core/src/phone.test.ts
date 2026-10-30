import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('accepts every common form of a Syrian mobile', () => {
    for (const input of [
      '0912345678',
      '912345678',
      '963912345678',
      '+963912345678',
      '00963912345678',
      '+963 912 345 678',
      '(091) 234-5678',
      '091.234.5678',
    ]) {
      expect(normalizePhone(input), input).toBe('+963912345678');
    }
  });

  it('reads Arabic-Indic and Persian digits and the minus sign as a separator', () => {
    expect(normalizePhone('٠٩١٢٣٤٥٦٧٨')).toBe('+963912345678');
    expect(normalizePhone('۰۹۱۲۳۴۵۶۷۸')).toBe('+963912345678');
    expect(normalizePhone('٠٩١٢−٣٤٥−٦٧٨')).toBe('+963912345678');
  });

  it('accepts foreign numbers only with + or 00 and 8 to 15 digits', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('0090 532 123 4567')).toBe('+905321234567');
    expect(normalizePhone('+12345678')).toBe('+12345678');
    expect(normalizePhone('+123456789012345')).toBe('+123456789012345');
    expect(normalizePhone('+1234567')).toBeNull();
    expect(normalizePhone('+1234567890123456')).toBeNull();
    expect(normalizePhone('442079460958')).toBeNull();
  });

  it('rejects malformed and non-mobile Syrian numbers', () => {
    for (const input of [
      '',
      '   ',
      'abc',
      '+abc',
      '091234567',
      '09123456789',
      '0812345678',
      '+963812345678',
      '+96391234567',
      '96391234567',
    ]) {
      expect(normalizePhone(input), input).toBeNull();
    }
  });
});
