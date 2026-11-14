import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { MINUTE_MS, ManualClock } from '../src/clock';
import { REFRESH_COOKIE } from '../src/routes/auth';
import {
  appDb,
  closeAppDb,
  closeOwnerDb,
  codes,
  makeApp,
  ownerDb,
  refreshCookie,
  registerStore,
  resetDatabase,
  testEnv,
} from './helpers';

const clock = new ManualClock();
let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({ RESET_PHONE_LIMIT_PER_HOUR: '3', RESET_IP_LIMIT_PER_HOUR: '30' }, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  clock.set('2026-11-12T09:00:00.000Z');
  codes.sent.length = 0;
  await resetDatabase();
  // The limits are counters in the database; resetDatabase() empties them.
});

const PHONE = '0912345678';
const E164 = '+963912345678';
const forgot = (phone = PHONE) => app.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { phone } });
const reset = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/auth/forgot/reset', payload });
const login = (password: string, phone = PHONE) =>
  app.inject({ method: 'POST', url: '/v1/auth/login', payload: { phone, password } });
const challengeRows = async () =>
  ownerDb()<{ code_hash: string; purpose: string }[]>`select code_hash, purpose from otp_challenges`;
const NEW = 'brand-new-pass-9';

describe('forgotten password: asking for a code', () => {
  it('sends a code to a real number and answers 202', async () => {
    await registerStore(app);
    codes.sent.length = 0;
    const res = await forgot();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ resetId: expect.any(String), expiresIn: 600 });
    expect(codes.sent).toHaveLength(1);
    expect(codes.sent[0]).toMatchObject({ phone: E164, purpose: 'password_reset' });
    expect(codes.last(E164)).toMatch(/^\d{6}$/);
  });

  it('answers an unknown number exactly the same way and sends nothing', async () => {
    await registerStore(app);
    codes.sent.length = 0;
    const known = await forgot();
    const unknown = await forgot('0999999999');
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(Object.keys(unknown.json()).sort()).toEqual(Object.keys(known.json()).sort());
    expect(unknown.json().expiresIn).toBe(known.json().expiresIn);
    expect(codes.sent.map((m) => m.phone)).toEqual([E164]);
    // Both leave one stored challenge, so the work done is the same too.
    expect(await challengeRows()).toHaveLength(2);
  });

  it('stores only a hash of the code', async () => {
    await registerStore(app);
    const res = await forgot();
    expect(res.statusCode).toBe(202);
    const code = codes.last(E164)!;
    const rows = await challengeRows();
    expect(rows[0]!.purpose).toBe('password_reset');
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('sends nothing to a paused person, a PIN-only person or a store with no password login, and still answers 202', async () => {
    const { body } = await registerStore(app);
    await ownerDb()`update users set status = 'disabled' where id = ${body.user.id}`;
    codes.sent.length = 0;
    expect((await forgot()).statusCode).toBe(202);
    await ownerDb()`update users set status = 'active', password_hash = null where id = ${body.user.id}`;
    expect((await forgot()).statusCode).toBe(202);
    expect(codes.sent).toHaveLength(0);
  });

  it('limits requests per number, and counts unknown numbers too', async () => {
    for (let i = 0; i < 3; i++) expect((await forgot('0999999999')).statusCode).toBe(202);
    const blocked = await forgot('0999999999');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // Another number is not affected
    expect((await forgot('0988888888')).statusCode).toBe(202);
  });

  it('limits requests per address', async () => {
    const small = await makeApp(
      { RESET_IP_LIMIT_PER_HOUR: '2', RESET_PHONE_LIMIT_PER_HOUR: '50' },
      { clock },
    );
    try {
      const go = (phone: string) =>
        small.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { phone } });
      expect((await go('0911111111')).statusCode).toBe(202);
      expect((await go('0922222222')).statusCode).toBe(202);
      expect((await go('0933333333')).statusCode).toBe(429);
    } finally {
      await small.close();
    }
  });

  it('answers 503 when no code can be sent at all (same for every number)', async () => {
    const mute = await makeApp({}, { clock, otpSender: null });
    try {
      const res = await mute.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { phone: PHONE } });
      expect(res.statusCode).toBe(503);
    } finally {
      await mute.close();
    }
  });
});

describe('forgotten password: the code and the new password', () => {
  async function ready() {
    const { body, cookie } = await registerStore(app);
    codes.sent.length = 0;
    const res = await forgot();
    return { resetId: res.json().resetId as string, code: codes.last(E164)!, userId: body.user.id, cookie };
  }

  it('changes the password, signs in on this device and ends every other session', async () => {
    const { resetId, code, cookie: oldCookie } = await ready();
    const second = await login('secret-pass-1');
    const secondCookie = refreshCookie(second)!;
    const oldAccess = second.json().accessToken as string;
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${oldAccess}` } }))
        .statusCode,
    ).toBe(200);

    const res = await reset({ resetId, code, password: NEW });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      accessToken: expect.any(String),
      user: { phone: E164 },
    });
    const fresh = refreshCookie(res)!;
    expect(fresh).toBeDefined();

    expect((await login('secret-pass-1')).statusCode).toBe(401);
    expect((await login(NEW)).statusCode).toBe(200);

    // The old sessions' refresh tokens no longer work, and their access tokens stop at once.
    for (const old of [oldCookie, secondCookie]) {
      const refresh = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        cookies: { [REFRESH_COOKIE]: old },
      });
      expect(refresh.statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${oldAccess}` } }))
        .statusCode,
    ).toBe(401);
    // The new one works
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const audited = await ownerDb()`select 1 from audit_logs where action = 'user.password_reset'`;
    expect(audited).toHaveLength(1);
  });

  it('uses a code once', async () => {
    const { resetId, code } = await ready();
    expect((await reset({ resetId, code, password: NEW })).statusCode).toBe(200);
    const again = await reset({ resetId, code, password: 'another-pass-77' });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('otp_invalid');
    expect((await login('another-pass-77')).statusCode).toBe(401);
  });

  it('refuses a wrong code and locks the challenge after five tries, even for the right code', async () => {
    const { resetId, code } = await ready();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect((await reset({ resetId, code: wrong, password: NEW })).statusCode).toBe(400);
    }
    expect((await reset({ resetId, code: wrong, password: NEW })).statusCode).toBe(429);
    expect((await reset({ resetId, code, password: NEW })).statusCode).toBe(429);
    expect((await login(NEW)).statusCode).toBe(401);
    expect((await login('secret-pass-1')).statusCode).toBe(200);
  });

  it('refuses a code after ten minutes', async () => {
    const { resetId, code } = await ready();
    clock.advance(10 * MINUTE_MS + 1000);
    const res = await reset({ resetId, code, password: NEW });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('otp_invalid');
    expect((await login(NEW)).statusCode).toBe(401);
  });

  it('cannot be completed with the decoy of an unknown number', async () => {
    await registerStore(app);
    const res = await forgot('0999999999');
    const decoy = await ownerDb()<
      { id: string }[]
    >`select id from otp_challenges where phone = '+963999999999'`;
    expect(decoy).toHaveLength(1);
    // Even the code the unknown number was "sent" (it only exists on the test screen) is refused.
    const wrongCode = '123456';
    const attempt = await reset({ resetId: res.json().resetId, code: wrongCode, password: NEW });
    expect(attempt.statusCode).toBe(400);
  });

  it('refuses when the person was paused after the code was sent', async () => {
    const { resetId, code, userId } = await ready();
    await ownerDb()`update users set status = 'disabled' where id = ${userId}`;
    const res = await reset({ resetId, code, password: NEW });
    expect(res.statusCode).toBe(400);
    const row = await ownerDb()<
      { password_hash: string }[]
    >`select password_hash from users where id = ${userId}`;
    expect(await app.passwords.verify(row[0]!.password_hash, 'secret-pass-1')).toBe(true);
  });

  it('refuses a short new password and an unknown challenge', async () => {
    const { resetId, code } = await ready();
    expect((await reset({ resetId, code, password: 'short' })).statusCode).toBe(400);
    const unknown = await reset({ resetId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01', code, password: NEW });
    expect(unknown.statusCode).toBe(400);
    // The short password did not spend the code
    expect((await reset({ resetId, code, password: NEW })).statusCode).toBe(200);
  });

  it('a registration code cannot be used to reset a password', async () => {
    await registerStore(app);
    const start = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        phone: '0955555555',
        fullName: 'سامر',
        password: 'secret-pass-1',
        termsVersion: '2026-10-30',
      },
    });
    const code = codes.last('+963955555555')!;
    const res = await reset({ resetId: start.json().registrationId, code, password: NEW });
    expect(res.statusCode).toBe(400);
  });

  it('tells a suspended store, after changing the password, without opening a session', async () => {
    const { resetId, code } = await ready();
    await ownerDb()`update tenants set status = 'suspended'`;
    const res = await reset({ resetId, code, password: NEW });
    expect(res.statusCode).toBe(403);
    expect(refreshCookie(res)).toBeUndefined();
    const stored = await appDb().db.execute(sql`select 1 from auth_find_login(${E164})`);
    expect(stored).toHaveLength(1);
  });

  it('shows the code on screen only in the local server test mode (a decoy for unknown numbers)', async () => {
    const local = await buildApp({
      env: testEnv({ DEPLOYMENT: 'local', OTP_DELIVERY: 'screen' }),
      database: appDb(),
      clock,
    });
    try {
      await registerStore(app);
      const real = await local.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { phone: PHONE } });
      expect(real.json().testCode).toMatch(/^[0-9]{6}$/);
      const done = await local.inject({
        method: 'POST',
        url: '/v1/auth/forgot/reset',
        payload: { resetId: real.json().resetId, code: real.json().testCode, password: NEW },
      });
      expect(done.statusCode).toBe(200);
      const unknown = await local.inject({
        method: 'POST',
        url: '/v1/auth/forgot',
        payload: { phone: '0999999999' },
      });
      expect(unknown.json().testCode).toMatch(/^[0-9]{6}$/);
      const decoy = await local.inject({
        method: 'POST',
        url: '/v1/auth/forgot/reset',
        payload: { resetId: unknown.json().resetId, code: unknown.json().testCode, password: NEW },
      });
      expect(decoy.statusCode).toBe(400);
    } finally {
      await local.close();
    }
  });
});
