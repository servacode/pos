import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { isTestMode, otpSenderFor } from '../src/auth/otp';
import { ManualClock } from '../src/clock';
import type { Env } from '../src/env';
import { TEST_MODE_HEADER } from '../src/http/test-mode';
import {
  appDb,
  closeAppDb,
  closeOwnerDb,
  makeApp,
  ownerDb,
  resetDatabase,
  storeInput,
  testEnv,
} from './helpers';

// The local server's test mode (OTP_DELIVERY=screen): no SMS, so the sign-up code comes back in
// the answer. Built with the real sender wiring, not the test helper's captured codes.
const logLines: string[] = [];
let local: FastifyInstance;
let cloud: FastifyInstance;

beforeAll(async () => {
  const logStream = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  local = await buildApp({
    env: testEnv({ DEPLOYMENT: 'local', OTP_DELIVERY: 'screen', LOG_LEVEL: 'warn' }),
    database: appDb(),
    clock: new ManualClock(),
    logStream,
  });
  cloud = await makeApp();
});
afterAll(async () => {
  await local.close();
  await cloud.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const start = (app: FastifyInstance, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/auth/register', payload });
const verify = (app: FastifyInstance, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/auth/register/verify', payload });
const count = async (table: string) =>
  (await ownerDb().unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]!.n;

describe('sign-up codes on screen (local server, test mode)', () => {
  it('warns loudly at startup', () => {
    expect(logLines.join('\n')).toMatch(/TEST MODE: OTP_DELIVERY=screen/);
  });

  it('answers the code, and that code opens the store', async () => {
    const res = await start(local, storeInput());
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body).toEqual({
      registrationId: expect.any(String),
      expiresIn: 600,
      testCode: expect.stringMatching(/^\d{6}$/),
    });

    const done = await verify(local, {
      registrationId: body.registrationId,
      code: body.testCode,
      password: 'secret-pass-1',
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().tenant.name).toBe('متجر أحمد الخطيب');
  });

  it('a registered number gets a code-shaped answer that verification rejects', async () => {
    const first = (await start(local, storeInput())).json();
    await verify(local, {
      registrationId: first.registrationId,
      code: first.testCode,
      password: 'secret-pass-1',
    });
    const challenges = await count('otp_challenges');

    const taken = await start(local, storeInput({ fullName: 'منتحل' }));
    const fresh = await start(local, storeInput({ phone: '0933333333' }));
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(Object.keys(taken.json()).sort()).toEqual(Object.keys(fresh.json()).sort());
    expect(taken.json().testCode).toMatch(/^\d{6}$/);
    // Nothing was stored for the registered number: only the fresh sign-up added a challenge.
    expect(await count('otp_challenges')).toBe(challenges + 1);

    const attempt = await verify(local, {
      registrationId: taken.json().registrationId,
      code: taken.json().testCode,
      password: 'other-pass-1',
    });
    expect(attempt.statusCode).toBe(400);
    expect(attempt.json().error.code).toBe('otp_invalid');
    expect(await count('users')).toBe(1);
  });

  it('is public through /v1/meta and marks every answer, errors included', async () => {
    const meta = await local.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.json()).toEqual({ testMode: true });
    expect(meta.headers[TEST_MODE_HEADER]).toBe('1');
    const missing = await local.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers[TEST_MODE_HEADER]).toBe('1');
  });
});

describe('never on the cloud', () => {
  it('a cloud server shows no code and reports no test mode', async () => {
    const res = await start(cloud, storeInput());
    expect(res.statusCode).toBe(202);
    expect(res.json()).not.toHaveProperty('testCode');
    expect(res.headers[TEST_MODE_HEADER]).toBeUndefined();
    const meta = await cloud.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.json()).toEqual({ testMode: false });
    expect(meta.headers[TEST_MODE_HEADER]).toBeUndefined();
  });

  it('the environment check refuses screen mode on a cloud deployment', () => {
    expect(() => testEnv({ OTP_DELIVERY: 'screen' })).toThrow(/allowed only with DEPLOYMENT=local/);
    expect(() => testEnv({ OTP_DELIVERY: 'screen', DEPLOYMENT: 'cloud' })).toThrow(/OTP_DELIVERY=screen/);
  });

  it('even a configuration that skipped the check gets no screen sender', () => {
    const forged = { ...testEnv(), OTP_DELIVERY: 'screen', DEPLOYMENT: 'cloud' } as Env;
    expect(isTestMode(forged)).toBe(false);
    expect(otpSenderFor(forged, cloud.log)).toBeNull();
  });
});
