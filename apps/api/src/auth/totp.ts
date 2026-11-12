import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { deriveKey } from './tokens';

/**
 * TOTP, RFC 6238: HMAC-SHA1 over the 30-second step counter, six digits (RFC 4226 truncation).
 * Authenticator apps (Google Authenticator, Authy, 1Password, Microsoft Authenticator) all speak it.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes of the previous and the next step are accepted too (clock drift between phone and server) */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('not base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (the size RFC 4226 recommends) */
export const newTotpSecret = (): Buffer => randomBytes(20);

export const totpStep = (now: Date): number => Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);

/** The code for one step (RFC 4226 dynamic truncation). */
export function totpCode(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

/**
 * The step a submitted code belongs to within the window, or null. Every candidate is compared in
 * constant time and all of them are always checked.
 */
export function matchTotp(secret: Uint8Array, code: string, now: Date): number | null {
  if (code.length !== TOTP_DIGITS) return null;
  const given = Buffer.from(code);
  const current = totpStep(now);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The key typed by hand, in groups of four. */
export const groupKey = (secret: Uint8Array): string =>
  base32Encode(secret)
    .replace(/(.{4})/g, '$1 ')
    .trim();

// ─── Recovery codes ──────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

/** SHA-256 of the normalised code. The code is random and long, so no salt or slow hash is needed. */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

/** Ten characters (about 49 bits), written «abcde-fghij»; shown once, stored as a hash. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const raw = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]!).join(''),
  );
  return { codes: raw.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`), hashes: raw.map(hashRecoveryCode) };
}

// ─── Secrets at rest ─────────────────────────────────────────────────────────

/**
 * The repo had no encryption helper, so this is it: AES-256-GCM, a fresh random IV per value, the
 * key derived (HKDF) from JWT_SECRET under its own label. A rotated JWT_SECRET moved to
 * JWT_PREVIOUS_SECRETS still opens old values. Stored as "v1.iv.tag.ciphertext" (base64url).
 */
export class SecretBox {
  private readonly keys: Buffer[];

  constructor(current: string, previous: readonly string[] = []) {
    this.keys = [current, ...previous].map((s) => Buffer.from(deriveKey(s, 'platform-totp').key));
  }

  seal(plain: Uint8Array): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys[0]!, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  open(sealed: string): Buffer | null {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !body) return null;
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
      } catch {
        // a rotated secret or a damaged value; try the next key
      }
    }
    return null;
  }
}
