import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'serva-pos';
const AUDIENCE = 'serva-store';

export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

const keyCache = new Map<string, Uint8Array>();
const keyFor = (secret: string) => {
  let key = keyCache.get(secret);
  if (!key) {
    key = new TextEncoder().encode(secret);
    keyCache.set(secret, key);
  }
  return key;
};

export function signAccessToken(claims: AccessClaims, secret: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyFor(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
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
