import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TERMS_VERSION } from '@serva/core';
import { otpSenderFor, otpText } from '../src/auth/otp';
import { buildApp } from '../src/app';
import { ManualClock } from '../src/clock';
import { appDb, closeAppDb, closeOwnerDb, ownerDb, resetDatabase, testEnv } from './helpers';

/**
 * OTP_DELIVERY=gateway (owner's decision, 3 Nov 2026: a WhatsApp bot for now): the sign-up code is
 * handed to a separate service over HTTP. Tested against a real HTTP server standing in for the
 * bot: what it receives, that the code it got opens the store, and that a gateway that is down or
 * refuses makes sign-up answer 503 without leaking anything.
 */

const TOKEN = 'gateway-token-0123456789';

interface Received {
  authorization: string | undefined;
  body: { phone: string; code: string; purpose: string; text: string };
}
let gateway: Server;
let gatewayUrl: string;
let received: Received[] = [];
let answer = 200;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

beforeAll(async () => {
  gateway = createServer(async (req, res) => {
    received.push({ authorization: req.headers.authorization, body: JSON.parse(await readBody(req)) });
    res.writeHead(answer).end();
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/send`;
});
afterAll(async () => {
  await new Promise((resolve) => gateway.close(resolve));
  await closeAppDb();
  await closeOwnerDb();
});

let app: FastifyInstance;
beforeEach(async () => {
  await resetDatabase();
  received = [];
  answer = 200;
  app = await buildApp({
    env: testEnv({ OTP_DELIVERY: 'gateway', OTP_GATEWAY_URL: gatewayUrl, OTP_GATEWAY_TOKEN: TOKEN }),
    database: appDb(),
    clock: new ManualClock(),
  });
});
afterEach(async () => {
  await app.close();
});

const start = (phone = '0933123456') =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { phone, fullName: 'متجر البوت', password: 'secret-pass-1', termsVersion: TERMS_VERSION },
  });

describe('sign-up codes through the gateway', () => {
  it('sends the code to the gateway with its token, and that code opens the store', async () => {
    const res = await start();
    expect(res.statusCode).toBe(202);
    // The code goes to the phone, never back to the screen
    expect(res.json()).not.toHaveProperty('testCode');
    expect(received).toHaveLength(1);
    const [sent] = received;
    expect(sent!.authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent!.body.phone).toBe('+963933123456');
    expect(sent!.body.purpose).toBe('registration');
    expect(sent!.body.code).toMatch(/^\d{6}$/);
    expect(sent!.body.text).toBe(otpText(sent!.body.code));
    expect(sent!.body.text).toContain(sent!.body.code);

    const verify = await app.inject({
      method: 'POST',
      url: '/v1/auth/register/verify',
      payload: {
        registrationId: res.json().registrationId,
        code: sent!.body.code,
        password: 'secret-pass-1',
      },
    });
    expect(verify.statusCode).toBe(201);
  });

  it('answers 503 when the gateway refuses, and the code is never shown', async () => {
    answer = 500;
    const res = await start();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('unavailable');
    expect(res.body).not.toContain(received[0]!.body.code);
  });

  it('answers 503 when the gateway is down', async () => {
    const down = await buildApp({
      env: testEnv({
        OTP_DELIVERY: 'gateway',
        OTP_GATEWAY_URL: 'http://127.0.0.1:9/send',
        OTP_GATEWAY_TOKEN: TOKEN,
      }),
      database: appDb(),
      clock: new ManualClock(),
    });
    const res = await down.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        phone: '0933123457',
        fullName: 'متجر',
        password: 'secret-pass-1',
        termsVersion: TERMS_VERSION,
      },
    });
    await down.close();
    expect(res.statusCode).toBe(503);
  });

  it('sends nothing for a number that already has an account', async () => {
    const first = await start();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register/verify',
      payload: {
        registrationId: first.json().registrationId,
        code: received[0]!.body.code,
        password: 'secret-pass-1',
      },
    });
    received = [];
    expect((await start()).statusCode).toBe(202);
    expect(received).toEqual([]);
    const [row] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from tenants`;
    expect(row!.n).toBe(1);
  });
});

describe('the gateway settings', () => {
  it('need a URL and a token of 16 characters at least', () => {
    expect(() => testEnv({ OTP_DELIVERY: 'gateway' })).toThrow(/OTP_GATEWAY_URL and OTP_GATEWAY_TOKEN/);
    expect(() =>
      testEnv({ OTP_DELIVERY: 'gateway', OTP_GATEWAY_URL: gatewayUrl, OTP_GATEWAY_TOKEN: 'short' }),
    ).toThrow();
  });

  it('must be https from the cloud in production, and may be plain http on the shop network', () => {
    const production = (extra: Record<string, string>) =>
      testEnv({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        DATABASE_URL: 'postgres://serva_app:Kq8vX2mPz7Lw4Rt9@db:5432/serva',
        JWT_SECRET: 'Zr4x9Qw2Lp8Vt6Nb3Hc7Jd1Kf5Gm0Sa-Yq7u2Pe9Ko4Ri1Tw6',
        OTP_DELIVERY: 'gateway',
        OTP_GATEWAY_TOKEN: TOKEN,
        ...extra,
      });
    expect(() => production({ OTP_GATEWAY_URL: 'http://bot.example/send' })).toThrow(/must be https/);
    expect(production({ OTP_GATEWAY_URL: 'https://bot.example/send' }).OTP_DELIVERY).toBe('gateway');
    expect(
      production({ OTP_GATEWAY_URL: 'http://192.168.1.30:3001/send', DEPLOYMENT: 'local' }).OTP_DELIVERY,
    ).toBe('gateway');
  });

  it('pick the gateway sender', () => {
    const env = testEnv({ OTP_DELIVERY: 'gateway', OTP_GATEWAY_URL: gatewayUrl, OTP_GATEWAY_TOKEN: TOKEN });
    expect(otpSenderFor(env, app.log)).not.toBeNull();
  });
});
