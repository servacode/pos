import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ManualClock, SECOND_MS } from '../src/clock';
import { closeAppDb, makeApp, registerStore, resetDatabase, testEnv } from './helpers';

const clock = new ManualClock();
const apps: FastifyInstance[] = [];

async function app(overrides: Record<string, string>): Promise<FastifyInstance> {
  const built = await makeApp(overrides, { clock });
  apps.push(built);
  return built;
}

beforeEach(async () => {
  clock.set('2026-10-30T09:00:00.000Z');
  await resetDatabase();
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await closeAppDb();
});

const login = (target: FastifyInstance, headers: Record<string, string> = {}, phone = '0912345678') =>
  target.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers,
    payload: { phone, password: 'not-the-password' },
  });

async function statuses(count: number, send: (i: number) => Promise<{ statusCode: number }>) {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push((await send(i)).statusCode);
  return result;
}

describe('client address behind proxies (forged X-Forwarded-For)', () => {
  it('ignores X-Forwarded-For when no proxy is trusted, so rotating it does not escape the limit', async () => {
    const target = await app({ AUTH_RATE_LIMIT_PER_MINUTE: '2' });
    const result = await statuses(3, (i) => login(target, { 'x-forwarded-for': `198.51.100.${i}` }));
    expect(result).toEqual([401, 401, 429]);
  });

  it('behind one proxy, uses the address the proxy appended, not the one the client wrote', async () => {
    const target = await app({ AUTH_RATE_LIMIT_PER_MINUTE: '2', TRUST_PROXY: '127.0.0.1' });
    const result = await statuses(3, (i) =>
      login(target, { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.9` }),
    );
    expect(result).toEqual([401, 401, 429]);

    const someoneElse = await login(target, { 'x-forwarded-for': '203.0.113.10' });
    expect(someoneElse.statusCode).toBe(401);
  });

  it('refuses TRUST_PROXY=true or a hop count, which would let a client pick its address', () => {
    expect(() => testEnv({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY=true/);
    expect(() => testEnv({ TRUST_PROXY: '1' })).toThrow(/hop count/);
    expect(() => testEnv({ TRUST_PROXY: '10.0.0.0/33' })).toThrow(/not an IP address or CIDR range/);
  });

  it('believes CF-Connecting-IP only from a listed proxy', async () => {
    // Injected requests come from 127.0.0.1.
    const viaEdge = await app({
      AUTH_RATE_LIMIT_PER_MINUTE: '2',
      TRUST_PROXY: '127.0.0.1/32',
      CLIENT_IP_HEADER: 'cf-connecting-ip',
    });
    const distinct = await statuses(3, (i) => login(viaEdge, { 'cf-connecting-ip': `198.51.100.${i}` }));
    expect(distinct).toEqual([401, 401, 401]);

    const direct = await app({
      AUTH_RATE_LIMIT_PER_MINUTE: '2',
      TRUST_PROXY: '10.0.0.0/8',
      CLIENT_IP_HEADER: 'cf-connecting-ip',
    });
    const forged = await statuses(3, (i) => login(direct, { 'cf-connecting-ip': `198.51.100.${i}` }));
    expect(forged).toEqual([401, 401, 429]);
  });

  it('refuses CLIENT_IP_HEADER without a list of proxies allowed to set it', () => {
    expect(() => testEnv({ CLIENT_IP_HEADER: 'cf-connecting-ip' })).toThrow(/CLIENT_IP_HEADER/);
  });

  it('limits sign-in attempts per phone number, from any address', async () => {
    const target = await app({ TRUST_PROXY: '127.0.0.1', LOGIN_PHONE_LIMIT_PER_HOUR: '3' });
    const result = await statuses(4, (i) => login(target, { 'x-forwarded-for': `198.51.100.${i}` }));
    expect(result).toEqual([401, 401, 401, 429]);

    const res = await login(target, { 'x-forwarded-for': '198.51.100.99' }, '0999999999');
    expect(res.statusCode).toBe(401);
  });
});

describe('shared rate limits', () => {
  it('counts across server instances, because counters live in the database', async () => {
    const one = await app({ RATE_LIMIT_PER_MINUTE: '3' });
    const two = await app({ RATE_LIMIT_PER_MINUTE: '3' });
    const result = await statuses(4, (i) => (i % 2 ? two : one).inject({ method: 'GET', url: '/v1/me' }));
    expect(result).toEqual([401, 401, 401, 429]);

    const limited = await one.inject({ method: 'GET', url: '/v1/me' });
    expect(limited.json().error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('opens again when the window has passed', async () => {
    const target = await app({ RATE_LIMIT_PER_MINUTE: '1' });
    expect((await target.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await target.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(429);
    clock.advance(61 * SECOND_MS);
    expect((await target.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
  });

  it('limits each signed-in session', async () => {
    const target = await app({ SESSION_RATE_LIMIT_PER_MINUTE: '2' });
    const { body } = await registerStore(target);
    const me = () =>
      target.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${body.accessToken}` },
      });
    expect(await statuses(3, me)).toEqual([200, 200, 429]);
  });

  it('limits each store across its sessions', async () => {
    const target = await app({ STORE_RATE_LIMIT_PER_MINUTE: '2' });
    const { body } = await registerStore(target);
    const second = await target.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0912345678', password: 'secret-pass-1' },
    });
    const tokens = [body.accessToken as string, second.json().accessToken as string];
    const result = await statuses(3, (i) =>
      target.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tokens[i % 2]}` } }),
    );
    expect(result).toEqual([200, 200, 429]);
  });

  it('never limits the health check', async () => {
    const target = await app({ RATE_LIMIT_PER_MINUTE: '1' });
    expect(await statuses(3, () => target.inject({ method: 'GET', url: '/health' }))).toEqual([
      200, 200, 200,
    ]);
  });
});
