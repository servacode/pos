import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  otpauthUri,
  SecretBox,
  totpCode,
  totpStep,
} from '../src/auth/totp';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890", last six digits of the 8-digit codes.
const RFC_SECRET = Buffer.from('12345678901234567890');
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('matches the RFC test vector at %i seconds', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(expected);
  });

  it('accepts the previous, current and next step and nothing else', () => {
    const now = new Date(1_700_000_000_000);
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) {
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + offset), now)).toBe(step + offset);
    }
    for (const offset of [-2, 2, 5]) {
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + offset), now)).toBeNull();
    }
  });

  it('refuses codes of the wrong shape', () => {
    const now = new Date(1_700_000_000_000);
    expect(matchTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '1234567', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '', now)).toBeNull();
  });

  it('encodes base32 as RFC 4648 does and round-trips', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    expect(() => base32Decode('0189')).toThrow();
  });

  it('builds the otpauth address an authenticator reads', () => {
    const uri = new URL(otpauthUri(RFC_SECRET, 'مدير المنصة', 'Serva Platform'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(uri.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri.searchParams.get('issuer')).toBe('Serva Platform');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('recovery codes', () => {
  it('makes ten distinct codes of ten characters with matching hashes', () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const [i, code] of codes.entries()) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(hashRecoveryCode(code)).toBe(hashes[i]);
      expect(hashes[i]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('hashes the same whatever the dash, space or case', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK')).toBe(hashRecoveryCode('abcde fghjk'));
  });
});

describe('sealing secrets at rest', () => {
  const secret = 'a-long-enough-jwt-secret-for-the-test-1234567890';

  it('round-trips, never shows the plain value and uses a fresh IV each time', () => {
    const box = new SecretBox(secret);
    const a = box.seal(RFC_SECRET);
    const b = box.seal(RFC_SECRET);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain(RFC_SECRET.toString('base64url'));
    expect(box.open(a)?.equals(RFC_SECRET)).toBe(true);
  });

  it('rejects a damaged value and another key, and still opens after a rotation', () => {
    const sealed = new SecretBox(secret).seal(RFC_SECRET);
    const parts = sealed.split('.');
    const damaged = [
      parts[0],
      parts[1],
      parts[2],
      Buffer.from('xxxxxxxxxxxxxxxxxxxx').toString('base64url'),
    ].join('.');
    expect(new SecretBox(secret).open(damaged)).toBeNull();
    expect(new SecretBox('another-secret-another-secret-another-secret').open(sealed)).toBeNull();
    const rotated = new SecretBox('brand-new-secret-brand-new-secret-123456', [secret]);
    expect(rotated.open(sealed)?.equals(RFC_SECRET)).toBe(true);
  });
});
