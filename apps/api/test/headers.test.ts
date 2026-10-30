import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REFRESH_COOKIE } from '../src/routes/auth';
import { closeAppDb, makeApp, registerStore, resetDatabase, testEnv } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(resetDatabase);

describe('security headers', () => {
  it('are on every answer, errors included', async () => {
    for (const url of ['/health', '/v1/me', '/nowhere']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(res.headers['content-security-policy'], url).toContain("default-src 'none'");
      expect(res.headers['strict-transport-security'], url).toMatch(/max-age=\d+/);
      expect(res.headers['x-frame-options'], url).toBe('DENY');
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
  });
});

describe('refresh cookie', () => {
  it('is Secure by default, whatever NODE_ENV is', async () => {
    const { res } = await registerStore(app);
    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
  });

  it('may drop Secure only outside production', () => {
    expect(testEnv({ COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(() => production({ COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false is not allowed/);
  });
});

/** A production configuration that is valid except for the overrides. */
function production(overrides: Record<string, string>) {
  return testEnv({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgres://serva_app:Kq8vX2mPz7Lw4Rt9@db:5432/serva',
    JWT_SECRET: 'Zr4x9Qw2Lp8Vt6Nb3Hc7Jd1Kf5Gm0Sa-Yq7u2Pe9Ko4Ri1Tw6',
    ...overrides,
  });
}

describe('startup refuses unsafe configuration', () => {
  it('accepts a sound production configuration', () => {
    expect(production({}).NODE_ENV).toBe('production');
  });

  it('refuses development mode on a non-local address (NODE_ENV forgotten on a server)', () => {
    expect(() => testEnv({ NODE_ENV: 'development', HOST: '0.0.0.0' })).toThrow(/NODE_ENV is "development"/);
    expect(testEnv({ NODE_ENV: 'development', HOST: '127.0.0.1' }).NODE_ENV).toBe('development');
  });

  it('refuses writing sign-up codes to the log in production', () => {
    expect(() => production({ OTP_DELIVERY: 'log' })).toThrow(/OTP_DELIVERY=log/);
  });

  it('refuses the development database passwords in production', () => {
    for (const password of ['serva_app', 'serva_owner', 'postgres']) {
      expect(() => production({ DATABASE_URL: `postgres://serva_app:${password}@db:5432/serva` })).toThrow(
        /development default password/,
      );
    }
    expect(() => production({ DATABASE_URL: 'postgres://serva_app@db:5432/serva' })).toThrow(
      /development default password/,
    );
  });
});
