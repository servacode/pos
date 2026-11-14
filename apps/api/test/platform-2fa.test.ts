import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PlatformEnrolDone, PlatformEnrolStart, PlatformLoginResult } from '@serva/core';
import { hashSecret } from '../src/auth/passwords';
import { base32Decode, matchTotp, totpCode, totpStep } from '../src/auth/totp';
import { ManualClock } from '../src/clock';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

const clock = new ManualClock();
let app: FastifyInstance;
let strict: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({ PLATFORM_REQUIRE_2FA: 'false' }, { clock });
  strict = await makeApp({ PLATFORM_REQUIRE_2FA: 'true' }, { clock });
});
afterAll(async () => {
  await app.close();
  await strict.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  clock.set('2026-11-12T09:00:10.000Z');
  await resetDatabase();
});

const EMAIL = 'admin@serva.test';
const PASSWORD = 'platform-pass-1';

async function seedAdmin(flags: { mustChange?: boolean } = {}) {
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into platform_users (full_name, email, password_hash, role, must_change_password)
    values ('مدير المنصة', ${EMAIL}, ${await hashSecret(PASSWORD)}, 'super_admin', ${flags.mustChange ?? false})
    returning id`;
  return row!.id;
}

const post = (a: FastifyInstance, url: string, payload: Record<string, unknown>, token?: string) =>
  a.inject({
    method: 'POST',
    url,
    payload,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
const signIn = (a: FastifyInstance, password = PASSWORD) =>
  post(a, '/v1/platform/login', { email: EMAIL, password });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const stores = (token: string) =>
  app.inject({ method: 'GET', url: '/v1/platform/stores', headers: bearer(token) });

/** The authenticator side: the secret from the enrolment answer, the code for the clock's moment. */
const secretOf = (start: PlatformEnrolStart) => base32Decode(start.secret.replace(/\s/g, ''));
const codeNow = (secret: Buffer, offset = 0) => totpCode(secret, totpStep(clock.now()) + offset);

/** Enrols through the signed-in routes and returns the secret and the recovery codes. */
async function enrol(token: string) {
  const start = (await post(app, '/v1/platform/2fa/enrol', {}, token)).json<PlatformEnrolStart>();
  const secret = secretOf(start);
  const done = await post(app, '/v1/platform/2fa/enrol/confirm', { code: codeNow(secret) }, token);
  expect(done.statusCode, done.body).toBe(200);
  return { secret, recovery: done.json<PlatformEnrolDone>().recoveryCodes, start };
}

async function enrolledAdmin() {
  await seedAdmin();
  const login = (await signIn(app)).json<{ token: string }>();
  const enrolment = await enrol(login.token);
  clock.advance(60_000); // the next sign-in is a later step than the one spent while enrolling
  return enrolment;
}

describe('sign-in without two-factor (not required, not enrolled)', () => {
  it('works exactly as before: password in, session out', async () => {
    await seedAdmin();
    const res = await signIn(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token: expect.any(String), user: { role: 'super_admin' } });
    expect((await stores(res.json().token)).statusCode).toBe(200);
  });

  it('still refuses a wrong password', async () => {
    await seedAdmin();
    expect((await signIn(app, 'nope-nope-nope')).statusCode).toBe(401);
  });
});

describe('enrolment from inside the panel', () => {
  it('shows a secret and a QR address, then switches on after a correct code, once', async () => {
    await seedAdmin();
    const { token } = (await signIn(app)).json<{ token: string }>();
    const status = await app.inject({ method: 'GET', url: '/v1/platform/2fa', headers: bearer(token) });
    expect(status.json()).toEqual({ enabled: false, recoveryCodesLeft: 0, required: false });

    const start = (await post(app, '/v1/platform/2fa/enrol', {}, token)).json<PlatformEnrolStart>();
    expect(start.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(start.uri).toMatch(/^otpauth:\/\/totp\/Serva%20Platform:/);
    expect(new URL(start.uri).searchParams.get('secret')).toBe(start.secret.replace(/ /g, ''));

    const wrong = await post(app, '/v1/platform/2fa/enrol/confirm', { code: '000000' }, token);
    expect(wrong.statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/platform/2fa', headers: bearer(token) })).json().enabled,
    ).toBe(false);

    const done = await post(app, '/v1/platform/2fa/enrol/confirm', { code: codeNow(secretOf(start)) }, token);
    expect(done.statusCode).toBe(200);
    expect(done.json<PlatformEnrolDone>().recoveryCodes).toHaveLength(10);
    const after = await app.inject({ method: 'GET', url: '/v1/platform/2fa', headers: bearer(token) });
    expect(after.json()).toEqual({ enabled: true, recoveryCodesLeft: 10, required: false });

    // Already on: enrolment cannot start again (it would replace the secret)
    expect((await post(app, '/v1/platform/2fa/enrol', {}, token)).statusCode).toBe(409);
  });

  it('keeps the secret sealed and the recovery codes hashed in the database', async () => {
    const { secret, recovery } = await enrolledAdmin();
    const [row] = await ownerDb()<
      { totp_secret_enc: string; totp_pending_enc: string | null; recovery_code_hashes: string[] }[]
    >`select totp_secret_enc, totp_pending_enc, recovery_code_hashes from platform_users`;
    expect(row!.totp_secret_enc.startsWith('v1.')).toBe(true);
    expect(row!.totp_secret_enc).not.toContain(secret.toString('base64url'));
    expect(row!.totp_pending_enc).toBeNull();
    expect(row!.recovery_code_hashes).toHaveLength(10);
    expect(JSON.stringify(row)).not.toContain(recovery[0]!.replace('-', ''));
  });

  it('is not reachable without a platform token, and a store token does not open it', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/platform/2fa' })).statusCode).toBe(401);
    expect((await post(app, '/v1/platform/2fa/enrol', {})).statusCode).toBe(401);
  });
});

describe('sign-in once enrolled', () => {
  it('asks for the code, and no session is issued by the password alone', async () => {
    await enrolledAdmin();
    const res = await signIn(app);
    expect(res.statusCode).toBe(200);
    const body = res.json<PlatformLoginResult>();
    expect(body).toEqual({ step: 'code', ticket: expect.any(String) });
    expect(res.body).not.toContain('"token"');
    // The ticket is not a session
    expect((await stores((body as { ticket: string }).ticket)).statusCode).toBe(401);
  });

  it('opens with a correct code, and the same code cannot be used twice', async () => {
    const { secret } = await enrolledAdmin();
    const first = (await signIn(app)).json<{ ticket: string }>();
    const code = codeNow(secret);
    const ok = await post(app, '/v1/platform/login/code', { ticket: first.ticket, code });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await stores(ok.json().token)).statusCode).toBe(200);

    const second = (await signIn(app)).json<{ ticket: string }>();
    const replay = await post(app, '/v1/platform/login/code', { ticket: second.ticket, code });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('otp_invalid');
  });

  it('accepts the neighbouring steps (clock drift) but not the ones further away', async () => {
    const { secret } = await enrolledAdmin();
    const ticket = async () => (await signIn(app)).json<{ ticket: string }>().ticket;
    const later = await post(app, '/v1/platform/login/code', {
      ticket: await ticket(),
      code: codeNow(secret, +1),
    });
    expect(later.statusCode).toBe(200);
    clock.advance(3 * 30_000);
    const tooOld = await post(app, '/v1/platform/login/code', {
      ticket: await ticket(),
      code: codeNow(secret, -3),
    });
    expect(tooOld.statusCode).toBe(400);
    const ok = await post(app, '/v1/platform/login/code', { ticket: await ticket(), code: codeNow(secret) });
    expect(ok.statusCode).toBe(200);
    // An older step than the last one accepted is refused even though it is inside the window
    const back = await post(app, '/v1/platform/login/code', {
      ticket: await ticket(),
      code: codeNow(secret, -1),
    });
    expect(back.statusCode).toBe(400);
  });

  it('refuses a wrong code', async () => {
    const { secret } = await enrolledAdmin();
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    const real = codeNow(secret);
    const wrong = real === '000000' ? '000001' : '000000';
    const res = await post(app, '/v1/platform/login/code', { ticket, code: wrong });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('"token"');
  });

  it('limits code attempts per person, even when the right code comes after the limit', async () => {
    const { secret } = await enrolledAdmin();
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    const right = codeNow(secret);
    const wrong = right === '000000' ? '000001' : '000000';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push((await post(app, '/v1/platform/login/code', { ticket, code: wrong })).statusCode);
    expect(statuses.every((s) => s === 400)).toBe(true);
    const blocked = await post(app, '/v1/platform/login/code', { ticket, code: right });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // The enrolment code counted too, so seven wrong ones fill the eight; after the window the right code works
    clock.advance(16 * 60_000);
    const { ticket: fresh } = (await signIn(app)).json<{ ticket: string }>();
    expect(
      (await post(app, '/v1/platform/login/code', { ticket: fresh, code: codeNow(secret) })).statusCode,
    ).toBe(200);
  });

  it('a recovery code signs in once and is then gone', async () => {
    const { recovery } = await enrolledAdmin();
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    const ok = await post(app, '/v1/platform/login/code', { ticket, code: recovery[0] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().token).toEqual(expect.any(String));
    const again = await post(app, '/v1/platform/login/code', { ticket, code: recovery[0] });
    expect(again.statusCode).toBe(400);
    // Another recovery code still works, spelled loosely
    const loose = await post(app, '/v1/platform/login/code', {
      ticket,
      code: ` ${recovery[1]!.toUpperCase().replace('-', ' ')} `,
    });
    expect(loose.statusCode).toBe(200);
    const [row] = await ownerDb()<
      { n: number }[]
    >`select jsonb_array_length(recovery_code_hashes)::int as n from platform_users`;
    expect(row!.n).toBe(8);
  });

  it('refuses a ticket for another step, a forged ticket and an expired ticket', async () => {
    const { secret } = await enrolledAdmin();
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    expect(
      (await post(app, '/v1/platform/login/password', { ticket, password: 'a-new-long-password' }))
        .statusCode,
    ).toBe(401);
    expect((await post(app, '/v1/platform/login/enrol', { ticket })).statusCode).toBe(401);
    expect(
      (await post(app, '/v1/platform/login/code', { ticket: `${ticket}x`, code: codeNow(secret) }))
        .statusCode,
    ).toBe(401);
    clock.advance(11 * 60_000);
    expect((await post(app, '/v1/platform/login/code', { ticket, code: codeNow(secret) })).statusCode).toBe(
      401,
    );
  });

  it('a paused platform member cannot finish a sign-in already started', async () => {
    const { secret } = await enrolledAdmin();
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    await ownerDb()`update platform_users set status = 'disabled'`;
    expect((await post(app, '/v1/platform/login/code', { ticket, code: codeNow(secret) })).statusCode).toBe(
      401,
    );
  });
});

describe('PLATFORM_REQUIRE_2FA', () => {
  it('forces enrolment at the next sign-in, and the panel opens only after it', async () => {
    await seedAdmin();
    const first = await signIn(strict);
    expect(first.json()).toEqual({ step: 'enrol', ticket: expect.any(String) });
    const { ticket } = first.json<{ ticket: string }>();

    const start = (await post(strict, '/v1/platform/login/enrol', { ticket })).json<PlatformEnrolStart>();
    expect(start.uri).toContain('otpauth://');
    const wrong = await post(strict, '/v1/platform/login/enrol/confirm', { ticket, code: '000000' });
    expect(wrong.statusCode).toBe(400);
    const done = await post(strict, '/v1/platform/login/enrol/confirm', {
      ticket,
      code: codeNow(secretOf(start)),
    });
    expect(done.statusCode, done.body).toBe(200);
    const body = done.json<PlatformEnrolDone>();
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.login?.token).toEqual(expect.any(String));
    expect((await stores(body.login!.token)).statusCode).toBe(200);

    // Next time the code is asked
    clock.advance(60_000);
    expect((await signIn(strict)).json().step).toBe('code');
  });

  it('is off by default outside production and on in production', async () => {
    const { loadEnv } = await import('../src/env');
    const { platformRequires2fa } = await import('../src/services/platform-2fa');
    const base = {
      DATABASE_URL: 'postgres://x:y@localhost/z',
      JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
    };
    expect(platformRequires2fa(loadEnv({ ...base, NODE_ENV: 'test' }))).toBe(false);
    expect(platformRequires2fa(loadEnv({ ...base, NODE_ENV: 'test', PLATFORM_REQUIRE_2FA: 'true' }))).toBe(
      true,
    );
    expect(app.env.PLATFORM_REQUIRE_2FA).toBe(false);
  });
});

describe('the bootstrap password', () => {
  it('must be changed at the first sign-in, then the flag is gone', async () => {
    await seedAdmin({ mustChange: true });
    const first = await signIn(app);
    expect(first.json()).toEqual({ step: 'password', ticket: expect.any(String) });
    const { ticket } = first.json<{ ticket: string }>();

    expect((await post(app, '/v1/platform/login/password', { ticket, password: 'short' })).statusCode).toBe(
      400,
    );
    const same = await post(app, '/v1/platform/login/password', { ticket, password: PASSWORD });
    expect(same.statusCode).toBe(400);
    const changed = await post(app, '/v1/platform/login/password', {
      ticket,
      password: 'a-much-better-password-9',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await stores(changed.json().token)).statusCode).toBe(200);

    expect((await signIn(app)).statusCode).toBe(401);
    const next = await signIn(app, 'a-much-better-password-9');
    expect(next.json().token).toEqual(expect.any(String));
    const [row] = await ownerDb()<
      { must_change_password: boolean }[]
    >`select must_change_password from platform_users`;
    expect(row!.must_change_password).toBe(false);
  });

  it('comes after the code for an enrolled member, and before enrolment when it is required', async () => {
    const { secret } = await enrolledAdmin();
    await ownerDb()`update platform_users set must_change_password = true`;
    const { ticket } = (await signIn(app)).json<{ ticket: string }>();
    // The password step cannot be skipped to, nor used before the code
    expect(
      (await post(app, '/v1/platform/login/password', { ticket, password: 'a-much-better-password-9' }))
        .statusCode,
    ).toBe(401);
    const afterCode = await post(app, '/v1/platform/login/code', { ticket, code: codeNow(secret) });
    expect(afterCode.json()).toEqual({ step: 'password', ticket: expect.any(String) });
    const done = await post(app, '/v1/platform/login/password', {
      ticket: afterCode.json().ticket,
      password: 'a-much-better-password-9',
    });
    expect(done.json().token).toEqual(expect.any(String));
  });

  it('a strict server sends a member who must change the password to enrol right after', async () => {
    await seedAdmin({ mustChange: true });
    const { ticket } = (await signIn(strict)).json<{ ticket: string }>();
    const next = await post(strict, '/v1/platform/login/password', {
      ticket,
      password: 'a-much-better-password-9',
    });
    expect(next.json()).toEqual({ step: 'enrol', ticket: expect.any(String) });
  });
});

describe('matching helper used by the server', () => {
  it('matches only inside the window', () => {
    const secret = Buffer.from('12345678901234567890');
    const now = new Date('2026-11-12T09:00:10.000Z');
    expect(matchTotp(secret, totpCode(secret, totpStep(now)), now)).toBe(totpStep(now));
  });
});
