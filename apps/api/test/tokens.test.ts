import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { decodeProtectedHeader, SignJWT } from 'jose';
import { ManualClock } from '../src/clock';
import {
  deriveKey,
  signAccessToken,
  TokenKeys,
  verifyAccessToken,
  weakSecretReason,
} from '../src/auth/tokens';
import { closeAppDb, makeApp, registerStore, resetDatabase, testEnv } from './helpers';

const OLD = 'Zr4x9Qw2Lp8Vt6Nb3Hc7Jd1Kf5Gm0Sa-old-key';
const NEW = 'Yq7u2Pe9Ko4Ri1Tw6Lz3Mx8Nc5Bv0Ds-new-key';
const claims = { userId: 'u1', tenantId: 't1', sessionId: 's1' };
const now = new Date('2026-10-30T09:00:00.000Z');

describe('access token keys', () => {
  it('tokens name their key (kid) and are signed with a key derived for the store gate', async () => {
    const token = await signAccessToken(claims, new TokenKeys(NEW), 900, now);
    expect(decodeProtectedHeader(token).kid).toBe(deriveKey(NEW, 'store').kid);
    expect(await verifyAccessToken(token, new TokenKeys(NEW), now)).toEqual(claims);
  });

  it('a token signed directly with the raw secret, or with another gate key, is refused', async () => {
    const raw = await new SignJWT({ tid: 't1', sid: 's1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer('serva-pos')
      .setAudience('serva-store')
      .setIssuedAt(now)
      .setExpirationTime(new Date(now.getTime() + 60_000))
      .sign(new TextEncoder().encode(NEW));
    expect(await verifyAccessToken(raw, new TokenKeys(NEW), now)).toBeNull();

    const device = deriveKey(NEW, 'device');
    const otherGate = await new SignJWT({ tid: 't1', sid: 's1' })
      .setProtectedHeader({ alg: 'HS256', kid: device.kid })
      .setSubject('u1')
      .setIssuer('serva-pos')
      .setAudience('serva-store')
      .setIssuedAt(now)
      .setExpirationTime(new Date(now.getTime() + 60_000))
      .sign(device.key);
    expect(await verifyAccessToken(otherGate, new TokenKeys(NEW), now)).toBeNull();
  });

  it('rotation: the previous secret still verifies while the new one signs', async () => {
    const issuedBefore = await signAccessToken(claims, new TokenKeys(OLD), 900, now);
    expect(await verifyAccessToken(issuedBefore, new TokenKeys(NEW, [OLD]), now)).toEqual(claims);
    expect(await verifyAccessToken(issuedBefore, new TokenKeys(NEW), now)).toBeNull();

    const issuedAfter = await signAccessToken(claims, new TokenKeys(NEW, [OLD]), 900, now);
    expect(decodeProtectedHeader(issuedAfter).kid).toBe(deriveKey(NEW, 'store').kid);
  });
});

describe('signing secret checks', () => {
  it('refuses the published example, short and predictable secrets', () => {
    expect(weakSecretReason('change-me-to-a-long-random-secret-of-32-chars-or-more', false)).toMatch(
      /published example/,
    );
    expect(weakSecretReason('short', false)).toMatch(/at least 32/);
    expect(weakSecretReason('a'.repeat(64), false)).toMatch(/too predictable/);
    expect(weakSecretReason('abababababababababababababababababababab', false)).toMatch(/too predictable/);
    expect(weakSecretReason(NEW, false)).toBeNull();
  });

  it('refuses placeholder words in production only', () => {
    const placeholder = 'my-production-secret-value-9f8e7d6c5b4a3';
    expect(weakSecretReason(placeholder, true)).toMatch(/placeholder/);
    expect(weakSecretReason(placeholder, false)).toBeNull();
  });

  it('the server refuses to start with a weak secret', () => {
    expect(() => testEnv({ JWT_SECRET: 'change-me-to-a-long-random-secret-of-32-chars-or-more' })).toThrow(
      /JWT_SECRET is a published example/,
    );
    expect(() => testEnv({ JWT_PREVIOUS_SECRETS: 'too-short' })).toThrow(/JWT_PREVIOUS_SECRETS/);
  });
});

describe('rotation end to end', () => {
  const clock = new ManualClock();
  const apps: FastifyInstance[] = [];
  beforeEach(resetDatabase);
  afterAll(async () => {
    for (const a of apps) await a.close();
    await closeAppDb();
  });

  it('users stay signed in when the secret is rotated', async () => {
    const before = await makeApp({ JWT_SECRET: OLD }, { clock });
    const after = await makeApp({ JWT_SECRET: NEW, JWT_PREVIOUS_SECRETS: OLD }, { clock });
    const forgotten = await makeApp({ JWT_SECRET: NEW }, { clock });
    apps.push(before, after, forgotten);

    const { body } = await registerStore(before);
    const me = (target: FastifyInstance) =>
      target.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${body.accessToken}` },
      });
    expect((await me(after)).statusCode).toBe(200);
    expect((await me(forgotten)).statusCode).toBe(401);
  });
});
