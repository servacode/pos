import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DAY_MS, MINUTE_MS, ManualClock } from '../src/clock';
import { REFRESH_COOKIE } from '../src/routes/auth';
import { closeAppDb, makeApp, registerStore, resetDatabase } from './helpers';

let app: FastifyInstance;
const clock = new ManualClock('2026-10-30T09:00:00.000Z');

beforeAll(async () => {
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(async () => {
  clock.set('2026-10-30T09:00:00.000Z');
  await resetDatabase();
});

const me = (accessToken: string) =>
  app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
const refresh = (cookie: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [REFRESH_COOKIE]: cookie } });

describe('time travel with the injected clock', () => {
  it('an access token stops working once its 15 minutes are over', async () => {
    const { body } = await registerStore(app);

    clock.advance(15 * MINUTE_MS - 1_000);
    expect((await me(body.accessToken)).statusCode).toBe(200);

    clock.advance(2_000);
    expect((await me(body.accessToken)).statusCode).toBe(401);
  });

  it('a refresh token is refused after its lifetime', async () => {
    const { cookie } = await registerStore(app);

    clock.advance(30 * DAY_MS + MINUTE_MS);
    expect((await refresh(cookie)).statusCode).toBe(401);
  });

  it('the trial counts down with the clock', async () => {
    const { body } = await registerStore(app);
    const before = (await me(body.accessToken)).json().subscription.daysLeft as number;

    clock.advance(3 * DAY_MS);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0912345678', password: 'secret-pass-1' },
    });
    const after = (await me(login.json().accessToken)).json().subscription.daysLeft as number;
    expect(after).toBe(before - 3);
  });
});
