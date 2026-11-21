import { describe, expect, it } from 'vitest';
import { legalInput, LEGAL_OPTIONAL_KEYS, LEGAL_TEXT_KEYS } from './contracts/legal';

describe('legalInput', () => {
  it('accepts a bare payload: every blank stays empty and the review flag is off', () => {
    const parsed = legalInput.parse({ updatedAt: '2026-11-13' });
    expect(parsed.companyName).toBe('');
    expect(parsed.supportWhatsapp).toBe('');
    expect(parsed.reviewedByLawyer).toBe(false);
  });

  it('trims the texts and keeps the phone numbers in international form', () => {
    const parsed = legalInput.parse({
      companyName: '  شركة المثال  ',
      ownerName: 'أحمد',
      email: ' hello@example.com ',
      supportWhatsapp: '0912 345 678',
      phone: '00963 933 111 222',
      reviewedByLawyer: true,
      updatedAt: '2026-11-13',
    });
    expect(parsed).toMatchObject({
      companyName: 'شركة المثال',
      email: 'hello@example.com',
      supportWhatsapp: '+963912345678',
      phone: '+963933111222',
      reviewedByLawyer: true,
    });
  });

  it('rejects a bad email, a bad phone and a bad date', () => {
    const bad = (extra: object) => legalInput.safeParse({ updatedAt: '2026-11-13', ...extra }).success;
    expect(bad({ email: 'not-an-email' })).toBe(false);
    expect(bad({ supportWhatsapp: '123' })).toBe(false);
    expect(bad({ phone: 'abc' })).toBe(false);
    expect(legalInput.safeParse({ updatedAt: '13/11/2026' }).success).toBe(false);
    expect(legalInput.safeParse({ updatedAt: '2026-13-45' }).success).toBe(false);
    expect(legalInput.safeParse({}).success).toBe(false);
  });

  it('lists every text key, and only the optional ones may stay empty', () => {
    expect(LEGAL_TEXT_KEYS).toContain('ownerName');
    for (const key of LEGAL_OPTIONAL_KEYS) expect(LEGAL_TEXT_KEYS).toContain(key);
  });
});
