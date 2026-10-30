import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { sessions, withTenant } from '@serva/db';
import { DAY_MS, ManualClock, SECOND_MS } from '../src/clock';
import { REFRESH_COOKIE } from '../src/routes/auth';
import {
  appDb,
  closeAppDb,
  closeOwnerDb,
  makeApp,
  ownerDb,
  refreshCookie,
  registerStore,
  resetDatabase,
} from './helpers';

const START = '2026-10-30T09:00:00.000Z';
const clock = new ManualClock(START);
let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  clock.set(START);
  await resetDatabase();
});

const me = (accessToken: string, target = app) =>
  target.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
const refresh = (cookie: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [REFRESH_COOKIE]: cookie } });
const login = () =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { phone: '0912345678', password: 'secret-pass-1' },
  });
const setsCookie = (res: LightMyRequestResponse) => res.headers['set-cookie'] !== undefined;

describe('sessions are isolated per store (row-level security)', () => {
  it('the app role sees no sessions without a store, and only its own with one', async () => {
    const a = await registerStore(app, { phone: '0911111111' });
    await registerStore(app, { phone: '0922222222' });

    expect(await appDb().db.select().from(sessions)).toEqual([]);
    const own = await withTenant(appDb().db, a.body.tenant.id, (tx) =>
      tx.select({ tenantId: sessions.tenantId }).from(sessions),
    );
    expect(own).toEqual([{ tenantId: a.body.tenant.id }]);
  });

  it('a session cannot be planted in another store', async () => {
    const a = await registerStore(app, { phone: '0911111111' });
    const b = await registerStore(app, { phone: '0922222222' });
    const planted = withTenant(appDb().db, a.body.tenant.id, (tx) =>
      tx.execute(sql`insert into sessions (tenant_id, user_id, family_id, token_hash, expires_at, absolute_expires_at)
        values (${b.body.tenant.id}, ${b.body.user.id}, gen_random_uuid(), 'x', now(), now())`),
    );
    await expect(planted).rejects.toThrow();
  });
});

describe('access tokens follow the session (requireAuth)', () => {
  it('stop working as soon as the user signs out', async () => {
    const { body, cookie } = await registerStore(app);
    expect((await me(body.accessToken)).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/v1/auth/logout', cookies: { [REFRESH_COOKIE]: cookie } });
    expect((await me(body.accessToken)).statusCode).toBe(401);
  });

  it('stop working on another server instance within the cache window after sign-out', async () => {
    const other = await makeApp({}, { clock });
    try {
      const { body, cookie } = await registerStore(app);
      expect((await me(body.accessToken, other)).statusCode).toBe(200);

      await app.inject({ method: 'POST', url: '/v1/auth/logout', cookies: { [REFRESH_COOKIE]: cookie } });
      clock.advance(31 * SECOND_MS);
      expect((await me(body.accessToken, other)).statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });

  it('stop working when the user is disabled or the store is suspended', async () => {
    const first = await registerStore(app, { phone: '0911111111' });
    const second = await registerStore(app, { phone: '0922222222' });

    await ownerDb()`update users set status = 'disabled' where id = ${first.body.user.id}`;
    await ownerDb()`update tenants set status = 'suspended' where id = ${second.body.tenant.id}`;
    clock.advance(31 * SECOND_MS);

    expect((await me(first.body.accessToken)).statusCode).toBe(401);
    expect((await me(second.body.accessToken)).statusCode).toBe(401);
  });

  it('keep working across a refresh, which rotates the token but not the session', async () => {
    const { body, cookie } = await registerStore(app);
    expect((await refresh(cookie)).statusCode).toBe(200);
    expect((await me(body.accessToken)).statusCode).toBe(200);
  });
});

describe('session lifetime and store status', () => {
  it('ends 90 days after sign-in however often it is refreshed', async () => {
    let { cookie } = await registerStore(app);
    for (const day of [20, 40, 60, 80]) {
      clock.set(new Date(new Date(START).getTime() + day * DAY_MS));
      const res = await refresh(cookie);
      expect(res.statusCode, `day ${day}`).toBe(200);
      cookie = refreshCookie(res)!;
    }
    // Day 100: past the absolute end even though the last refresh was 20 days ago.
    clock.advance(20 * DAY_MS);
    expect((await refresh(cookie)).statusCode).toBe(401);
  });

  it('the cookie never outlives the absolute end', async () => {
    let { cookie } = await registerStore(app);
    let res: LightMyRequestResponse | undefined;
    for (let i = 0; i < 3; i++) {
      clock.advance(25 * DAY_MS);
      res = await refresh(cookie);
      cookie = refreshCookie(res)!;
    }
    // Day 75: a fresh token would last 30 days, but the session ends on day 90.
    const expires = res!.cookies.find((c) => c.name === REFRESH_COOKIE)!.expires!;
    expect(expires.getTime()).toBe(new Date(START).getTime() + 90 * DAY_MS);
  });

  it('a suspended store cannot sign in or refresh', async () => {
    const { body, cookie } = await registerStore(app);
    await ownerDb()`update tenants set status = 'suspended' where id = ${body.tenant.id}`;

    const signIn = await login();
    expect(signIn.statusCode).toBe(403);
    expect(signIn.json().error.code).toBe('forbidden');
    expect((await refresh(cookie)).statusCode).toBe(401);
  });

  it('a suspended store is not revealed to someone without the password', async () => {
    const { body } = await registerStore(app);
    await ownerDb()`update tenants set status = 'suspended' where id = ${body.tenant.id}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0912345678', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });
});

describe('refresh token rotation', () => {
  it('two tabs refreshing at once: one rotates, the other gets 409 and no cookie change', async () => {
    const { cookie } = await registerStore(app);
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
    const results = [a, b].sort((x, y) => x.statusCode - y.statusCode);

    expect(results.map((r) => r.statusCode)).toEqual([200, 409]);
    expect(setsCookie(results[0]!)).toBe(true);
    expect(setsCookie(results[1]!)).toBe(false);
    expect(results[1]!.json().error.code).toBe('conflict');
    expect((await refresh(refreshCookie(results[0]!)!)).statusCode).toBe(200);
  });

  it('reusing a rotated token within the grace window is a race, not theft', async () => {
    const { cookie } = await registerStore(app);
    const rotated = refreshCookie(await refresh(cookie))!;

    clock.advance(10 * SECOND_MS);
    const late = await refresh(cookie);
    expect(late.statusCode).toBe(409);
    expect(setsCookie(late)).toBe(false);
    expect((await refresh(rotated)).statusCode).toBe(200);
  });

  it('reusing a rotated token after the grace window ends every session of the user', async () => {
    const { body, cookie } = await registerStore(app);
    const rotated = refreshCookie(await refresh(cookie))!;
    const otherDevice = refreshCookie(await login())!;

    clock.advance(31 * SECOND_MS);
    const stolen = await refresh(cookie);
    expect(stolen.statusCode).toBe(401);
    expect(stolen.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');

    expect((await refresh(rotated)).statusCode).toBe(401);
    expect((await refresh(otherDevice)).statusCode).toBe(401);
    expect((await me(body.accessToken)).statusCode).toBe(401);
  });
});
