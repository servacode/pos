import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REFRESH_COOKIE } from '../src/routes/auth';
import { closeAppDb, makeApp, refreshCookie, registerStore, resetDatabase, storeInput } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(resetDatabase);

const refresh = (cookie: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [REFRESH_COOKIE]: cookie } });

describe('POST /v1/auth/register', () => {
  it('opens a store and signs the owner in', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: storeInput() });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(900);
    expect(body.user).toMatchObject({ fullName: 'أحمد الخطيب', phone: '+963912345678' });
    expect(body.tenant.name).toBe('متجر الأمل');

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/v1/auth', sameSite: 'Strict' });
  });

  it('returns Arabic messages for each invalid field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        storeName: 'م',
        ownerName: '',
        phone: '123',
        password: 'short',
        sectors: [],
        baseCurrency: 'EUR',
      },
    });

    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('validation_failed');
    expect(Object.keys(error.fields).sort()).toEqual(
      ['baseCurrency', 'ownerName', 'password', 'phone', 'sectors', 'storeName'].sort(),
    );
    expect(error.fields.phone).toContain('رقم الجوال غير صحيح');
  });

  it('refuses a phone number that already has an account, whatever its format', async () => {
    await registerStore(app, { phone: '0912345678' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: storeInput({ phone: '+963 912 345 678', storeName: 'متجر آخر' }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'phone_taken', fields: { phone: expect.any(String) } });
  });

  it('accepts Arabic-Indic digits in the phone number', async () => {
    const { body } = await registerStore(app, { phone: '٠٩٤٤١٢٣٤٥٦' });
    expect(body.user.phone).toBe('+963944123456');
  });
});

describe('POST /v1/auth/login', () => {
  beforeEach(async () => {
    await registerStore(app);
  });

  it('signs in with the phone in any common format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '00963912345678', password: 'secret-pass-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tenant: { name: 'متجر الأمل' }, user: { phone: '+963912345678' } });
    expect(refreshCookie(res)).toEqual(expect.any(String));
  });

  it('gives the same answer for a wrong password and an unknown phone', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0912345678', password: 'not-the-password' },
    });
    const unknownPhone = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0999999999', password: 'secret-pass-1' },
    });

    for (const res of [wrongPassword, unknownPhone]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toEqual({
        code: 'invalid_credentials',
        message: 'رقم الجوال أو كلمة المرور غير صحيحة.',
      });
    }
  });

  it('limits repeated attempts from the same address', async () => {
    const limited = await makeApp({ AUTH_RATE_LIMIT_PER_MINUTE: '2' });
    try {
      const attempt = () =>
        limited.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { phone: '0912345678', password: 'x' },
        });
      await attempt();
      await attempt();
      const third = await attempt();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('rate_limited');
    } finally {
      await limited.close();
    }
  });
});

describe('refresh and logout', () => {
  it('rotates the refresh token and rejects the old one', async () => {
    const { cookie } = await registerStore(app);

    const first = await refresh(cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json().accessToken).toEqual(expect.any(String));
    const rotated = refreshCookie(first);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(cookie);

    // Within the grace window a reuse is treated as two tabs racing: 409, retry with the new cookie.
    const reused = await refresh(cookie);
    expect(reused.statusCode).toBe(409);
    expect((await refresh(rotated!)).statusCode).toBe(200);
  });

  it('refuses refresh without a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('logout ends the session', async () => {
    const { cookie } = await registerStore(app);
    const out = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { [REFRESH_COOKIE]: cookie },
    });

    expect(out.statusCode).toBe(204);
    expect((await refresh(cookie)).statusCode).toBe(401);
  });
});
