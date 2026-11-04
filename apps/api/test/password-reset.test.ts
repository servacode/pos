import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TERMS_VERSION } from '@serva/core';
import { MINUTE_MS, ManualClock } from '../src/clock';
import { REFRESH_COOKIE, SESSION_ONLY_COOKIE } from '../src/routes/auth';
import { closeAppDb, closeOwnerDb, codes, makeApp, registerStore, resetDatabase } from './helpers';

const clock = new ManualClock();
let app: FastifyInstance;
const PHONE = '+963912345678';

beforeAll(async () => {
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  clock.set('2026-11-04T09:00:00.000Z');
  codes.sent.length = 0;
  await resetDatabase();
});

const post = (url: string, payload: Record<string, unknown>, cookie?: string) =>
  app.inject({ method: 'POST', url, payload, ...(cookie ? { headers: { cookie } } : {}) });
const login = (password: string, remember?: boolean) =>
  post('/v1/auth/login', { phone: '0912345678', password, ...(remember === undefined ? {} : { remember }) });

describe('«تذكّرني»', () => {
  it('keeps the refresh cookie for 30 days by default', async () => {
    await registerStore(app);
    const res = await login('secret-pass-1');
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)?.expires).toBeInstanceOf(Date);
    expect(res.cookies.find((c) => c.name === SESSION_ONLY_COOKIE && c.value)).toBeUndefined();
  });

  it('left off: the cookie ends with the browser, and stays so after a refresh', async () => {
    await registerStore(app);
    const res = await login('secret-pass-1', false);
    const rt = res.cookies.find((c) => c.name === REFRESH_COOKIE)!;
    expect(rt.expires).toBeUndefined();
    expect(res.cookies.find((c) => c.name === SESSION_ONLY_COOKIE)?.value).toBe('1');

    const refreshed = await post(
      '/v1/auth/refresh',
      {},
      `${REFRESH_COOKIE}=${rt.value}; ${SESSION_ONLY_COOKIE}=1`,
    );
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.cookies.find((c) => c.name === REFRESH_COOKIE)?.expires).toBeUndefined();
  });
});

describe('«نسيت كلمة السر»', () => {
  it('answers the same for a number with no account, and sends nothing', async () => {
    const res = await post('/v1/auth/password/forgot', { phone: '0999999999' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ resetId: expect.any(String), expiresIn: 600 });
    expect(codes.sent).toHaveLength(0);
  });

  it('the code sets a new password and ends every session', async () => {
    const { cookie } = await registerStore(app);
    codes.sent.length = 0;
    const { resetId } = (await post('/v1/auth/password/forgot', { phone: '0912345678' })).json();
    expect(codes.sent.at(-1)).toMatchObject({ phone: PHONE, purpose: 'password_reset' });

    const wrong = await post('/v1/auth/password/reset', {
      resetId,
      code: '000000',
      password: 'new-pass-123',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('otp_invalid');

    const code = codes.last(PHONE);
    const ok = await post('/v1/auth/password/reset', { resetId, code, password: 'new-pass-123' });
    expect(ok.statusCode).toBe(204);

    expect(
      (await post('/v1/auth/password/reset', { resetId, code, password: 'other-pass-1' })).statusCode,
    ).toBe(400);
    expect((await post('/v1/auth/refresh', {}, cookie)).statusCode).toBe(401);
    expect((await login('secret-pass-1')).statusCode).toBe(401);
    expect((await login('new-pass-123')).statusCode).toBe(200);
  });

  it('refuses an expired code', async () => {
    await registerStore(app);
    const { resetId } = (await post('/v1/auth/password/forgot', { phone: '0912345678' })).json();
    clock.advance(11 * MINUTE_MS);
    const res = await post('/v1/auth/password/reset', {
      resetId,
      code: codes.last(PHONE),
      password: 'new-pass-123',
    });
    expect(res.statusCode).toBe(400);
    expect((await login('secret-pass-1')).statusCode).toBe(200);
  });

  it('a registration code cannot reset a password', async () => {
    await registerStore(app);
    const start = await post('/v1/auth/register', {
      phone: '0933333333',
      fullName: 'سامر',
      password: 'secret-pass-2',
      termsVersion: TERMS_VERSION,
    });
    const res = await post('/v1/auth/password/reset', {
      resetId: start.json().registrationId,
      code: codes.last('+963933333333'),
      password: 'new-pass-123',
    });
    expect(res.statusCode).toBe(400);
  });
});
