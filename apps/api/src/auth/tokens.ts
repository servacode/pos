import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';

const ISSUER = 'serva-pos';

/**
 * Each entry gate has its own signing key and audience, so a token from one gate never opens
 * another. Only the store gate exists today; device, platform, agent and accountant gates add
 * their realm here (their keys derive the same way, with no new secret to manage).
 */
export const REALMS = { store: 'serva-store' } as const;
export type Realm = keyof typeof REALMS;

interface SigningKey {
  kid: string;
  key: Uint8Array;
}

/**
 * Signing keys for every realm: the current secret signs, previous secrets (during a rotation)
 * still verify. Keys are derived per realm with HKDF and named by `kid`, so rotating the secret
 * does not sign everyone out: move it to JWT_PREVIOUS_SECRETS and set a new JWT_SECRET.
 */
export class TokenKeys {
  private readonly signing = new Map<Realm, SigningKey>();
  private readonly verifying = new Map<Realm, Map<string, Uint8Array>>();

  constructor(current: string, previous: readonly string[] = []) {
    for (const realm of Object.keys(REALMS) as Realm[]) {
      const keys = [current, ...previous].map((secret) => deriveKey(secret, realm));
      this.signing.set(realm, keys[0]!);
      this.verifying.set(realm, new Map(keys.map((k) => [k.kid, k.key])));
    }
  }

  signingKey(realm: Realm): SigningKey {
    return this.signing.get(realm)!;
  }

  verificationKey(realm: Realm, kid: string): Uint8Array | undefined {
    return this.verifying.get(realm)?.get(kid);
  }
}

/** HKDF-SHA256 of the secret, one key per realm; kid is a fingerprint of the derived key. */
export function deriveKey(secret: string, realm: string): SigningKey {
  const key = new Uint8Array(hkdfSync('sha256', secret, 'serva-pos/jwt/v1', `realm:${realm}`, 32));
  const kid = createHash('sha256').update(key).digest('base64url').slice(0, 16);
  return { kid, key };
}

export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

export function signAccessToken(
  claims: AccessClaims,
  keys: TokenKeys,
  ttlSeconds: number,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const { kid, key } = keys.signingKey('store');
  return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(REALMS.store)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(key);
}

export async function verifyAccessToken(
  token: string,
  keys: TokenKeys,
  now: Date,
): Promise<AccessClaims | null> {
  try {
    const { kid } = decodeProtectedHeader(token);
    const key = typeof kid === 'string' ? keys.verificationKey('store', kid) : undefined;
    if (!key) return null;
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: REALMS.store,
      algorithms: ['HS256'],
      currentDate: now,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tid !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      return null;
    }
    return { userId: payload.sub, tenantId: payload.tid, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** A new opaque refresh token. Only its SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Values published in examples and docs; a server must never sign with them. */
const KNOWN_SECRETS = new Set(['change-me-to-a-long-random-secret-of-32-chars-or-more']);

/**
 * Why a signing secret is unacceptable, or null when it is fine: too short, a published example,
 * or too predictable (estimated entropy under 128 bits). Placeholder words are refused in
 * production. Generate one with: openssl rand -base64 48
 */
export function weakSecretReason(secret: string, production: boolean): string | null {
  if (secret.length < 32) return 'must be at least 32 characters';
  if (KNOWN_SECRETS.has(secret)) return 'is a published example value; generate your own';
  if (production && /change.?me|example|placeholder|secret|password|test/i.test(secret)) {
    return 'looks like a placeholder; generate a random value';
  }
  const counts = new Map<string, number>();
  for (const ch of secret) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bitsPerChar = 0;
  for (const n of counts.values()) bitsPerChar -= (n / secret.length) * Math.log2(n / secret.length);
  if (bitsPerChar * secret.length < 128 || counts.size < 10)
    return 'is too predictable; generate a random value';
  return null;
}
