import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TERMS_VERSION } from '@serva/core';
import { OtpDeliveryError, fillTemplate, otpSenderFor, otpText, smsOtpSender } from '../src/auth/otp';
import { buildApp } from '../src/app';
import { ManualClock } from '../src/clock';
import { appDb, closeAppDb, closeOwnerDb, resetDatabase, testEnv } from './helpers';

/**
 * OTP_DELIVERY=sms: a generic HTTP SMS gateway described by environment variables, and the
 * fallback chain (OTP_FALLBACK). Tested against real HTTP servers standing in for the providers.
 */

interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

function provider() {
  const received: Received[] = [];
  const state = { answer: 200 };
  const server: Server = createServer(async (req, res) => {
    received.push({ method: req.method, url: req.url, headers: req.headers, body: await readBody(req) });
    res.writeHead(state.answer).end();
  });
  return {
    received,
    state,
    server,
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const sms = provider();
const bot = provider();
let smsBase: string;
let botBase: string;
const TOKEN = 'gateway-token-0123456789';

beforeAll(async () => {
  smsBase = await sms.listen();
  botBase = await bot.listen();
});
afterAll(async () => {
  await sms.close();
  await bot.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(() => {
  sms.received.length = 0;
  bot.received.length = 0;
  sms.state.answer = 200;
  bot.state.answer = 200;
});

const log = { warn: () => {} } as never;
const defaults = {
  method: 'POST' as const,
  body: '{"to":"{phone}","text":"{message}"}',
  contentType: 'application/json',
  allowBroadcasts: false,
};

describe('the request is built from the template', () => {
  it('fills a JSON body with escaped values and sends the auth header', async () => {
    const sender = smsOtpSender(
      { ...defaults, url: `${smsBase}/send`, authHeader: 'X-Api-Key: key-123' },
      log,
    );
    await sender.send({ phone: '+963933123456', code: '123456', purpose: 'registration' });
    const [got] = sms.received;
    expect(got!.method).toBe('POST');
    expect(got!.headers['x-api-key']).toBe('key-123');
    expect(got!.headers['content-type']).toBe('application/json');
    const body = JSON.parse(got!.body) as { to: string; text: string };
    expect(body.to).toBe('+963933123456');
    expect(body.text).toBe(otpText('123456'));
  });

  it('keeps a body valid JSON whatever the message holds', async () => {
    const sender = smsOtpSender({ ...defaults, url: `${smsBase}/send` }, log);
    await sender.send({
      phone: '+963933123456',
      code: '',
      purpose: 'shop_order',
      text: 'a "quoted"\nline \\ end',
    });
    expect((JSON.parse(sms.received[0]!.body) as { text: string }).text).toBe('a "quoted"\nline \\ end');
  });

  it('percent-encodes a form body', async () => {
    const sender = smsOtpSender(
      {
        ...defaults,
        url: `${smsBase}/send`,
        contentType: 'application/x-www-form-urlencoded',
        body: 'to={digits}&code={code}&msg={message}',
      },
      log,
    );
    await sender.send({ phone: '+963933123456', code: '654321', purpose: 'registration' });
    const form = new URLSearchParams(sms.received[0]!.body);
    expect(form.get('to')).toBe('963933123456');
    expect(form.get('code')).toBe('654321');
    expect(form.get('msg')).toBe(otpText('654321'));
  });

  it('can be a GET with the values in the URL', async () => {
    const sender = smsOtpSender(
      {
        ...defaults,
        method: 'GET',
        body: '',
        url: `${smsBase}/api?to={phone}&text={message}`,
      },
      log,
    );
    await sender.send({ phone: '+963933123456', code: '111222', purpose: 'registration' });
    const [got] = sms.received;
    expect(got!.method).toBe('GET');
    expect(got!.body).toBe('');
    const url = new URL(got!.url!, 'http://x');
    expect(url.searchParams.get('to')).toBe('+963933123456');
    expect(url.searchParams.get('text')).toBe(otpText('111222'));
  });

  it('leaves text that is not a placeholder alone', () => {
    expect(fillTemplate('{"a":1,"x":"{nope}"} {code}', { code: '9' }, (v) => v)).toBe(
      '{"a":1,"x":"{nope}"} 9',
    );
  });

  it('throws OtpDeliveryError, without the code, when the provider refuses or is down', async () => {
    const warnings: unknown[] = [];
    const quiet = { warn: (...args: unknown[]) => warnings.push(args) } as never;
    sms.state.answer = 502;
    const refused = smsOtpSender({ ...defaults, url: `${smsBase}/send` }, quiet);
    await expect(
      refused.send({ phone: '+963933123456', code: '246810', purpose: 'registration' }),
    ).rejects.toBeInstanceOf(OtpDeliveryError);
    const down = smsOtpSender({ ...defaults, url: 'http://127.0.0.1:9/send' }, quiet);
    await expect(
      down.send({ phone: '+963933123456', code: '246810', purpose: 'registration' }),
    ).rejects.toBeInstanceOf(OtpDeliveryError);
    expect(JSON.stringify(warnings)).not.toContain('246810');
    expect(JSON.stringify(warnings)).not.toContain('963933123456');
  });

  it('does not send broadcast messages unless allowed', async () => {
    const sender = smsOtpSender({ ...defaults, url: `${smsBase}/send` }, log);
    await expect(
      sender.send({ phone: '+963933123456', code: '', purpose: 'broadcast', text: 'عرض' }),
    ).rejects.toBeInstanceOf(OtpDeliveryError);
    expect(sms.received).toHaveLength(0);
    const allowed = smsOtpSender({ ...defaults, url: `${smsBase}/send`, allowBroadcasts: true }, log);
    await allowed.send({ phone: '+963933123456', code: '', purpose: 'broadcast', text: 'عرض' });
    expect(sms.received).toHaveLength(1);
  });
});

describe('sign-up through sms, with whatsapp as the fallback', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await app.close();
  });

  const build = async (extra: Record<string, string>) => {
    app = await buildApp({
      env: testEnv({
        OTP_DELIVERY: 'sms',
        SMS_GATEWAY_URL: `${smsBase}/send`,
        SMS_GATEWAY_AUTH_HEADER: 'Authorization: Bearer sms-secret',
        ...extra,
      }),
      database: appDb(),
      clock: new ManualClock(),
    });
  };
  const start = (phone = '0933123456') =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { phone, fullName: 'متجر', password: 'secret-pass-1', termsVersion: TERMS_VERSION },
    });

  it('delivers the code by sms, and that code opens the store', async () => {
    await build({});
    const res = await start();
    expect(res.statusCode).toBe(202);
    expect(res.json()).not.toHaveProperty('testCode');
    expect(bot.received).toHaveLength(0);
    const { text } = JSON.parse(sms.received[0]!.body) as { text: string };
    const code = /\d{6}/.exec(text)![0];
    const verify = await app.inject({
      method: 'POST',
      url: '/v1/auth/register/verify',
      payload: { registrationId: res.json().registrationId, code, password: 'secret-pass-1' },
    });
    expect(verify.statusCode).toBe(201);
  });

  it('answers 503 when sms fails and there is no fallback', async () => {
    await build({});
    sms.state.answer = 500;
    const res = await start();
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatch(/\d{6}/);
  });

  it('falls back to the whatsapp gateway when sms fails', async () => {
    await build({ OTP_FALLBACK: 'gateway', OTP_GATEWAY_URL: `${botBase}/send`, OTP_GATEWAY_TOKEN: TOKEN });
    sms.state.answer = 500;
    const res = await start();
    expect(res.statusCode).toBe(202);
    expect(bot.received).toHaveLength(1);
    expect(bot.received[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('does not use the fallback when the first channel works', async () => {
    await build({ OTP_FALLBACK: 'gateway', OTP_GATEWAY_URL: `${botBase}/send`, OTP_GATEWAY_TOKEN: TOKEN });
    expect((await start()).statusCode).toBe(202);
    expect(sms.received).toHaveLength(1);
    expect(bot.received).toHaveLength(0);
  });

  it('answers 503 when every channel fails', async () => {
    await build({ OTP_FALLBACK: 'gateway', OTP_GATEWAY_URL: `${botBase}/send`, OTP_GATEWAY_TOKEN: TOKEN });
    sms.state.answer = 500;
    bot.state.answer = 500;
    expect((await start()).statusCode).toBe(503);
  });

  it('can run the other way round: whatsapp first, sms after', async () => {
    await build({
      OTP_DELIVERY: 'gateway',
      OTP_GATEWAY_URL: `${botBase}/send`,
      OTP_GATEWAY_TOKEN: TOKEN,
      OTP_FALLBACK: 'sms',
    });
    bot.state.answer = 500;
    expect((await start()).statusCode).toBe(202);
    expect(sms.received).toHaveLength(1);
  });
});

describe('the sms settings', () => {
  const production = (extra: Record<string, string>) =>
    testEnv({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgres://serva_app:Kq8vX2mPz7Lw4Rt9@db:5432/serva',
      JWT_SECRET: 'Zr4x9Qw2Lp8Vt6Nb3Hc7Jd1Kf5Gm0Sa-Yq7u2Pe9Ko4Ri1Tw6',
      OTP_DELIVERY: 'sms',
      ...extra,
    });

  it('need a URL', () => {
    expect(() => testEnv({ OTP_DELIVERY: 'sms' })).toThrow(/SMS_GATEWAY_URL/);
  });

  it('must be https from the cloud in production, and may be plain http on the shop network', () => {
    expect(() => production({ SMS_GATEWAY_URL: 'http://sms.example/send' })).toThrow(/must be https/);
    expect(production({ SMS_GATEWAY_URL: 'https://sms.example/send' }).OTP_DELIVERY).toBe('sms');
    expect(
      production({ SMS_GATEWAY_URL: 'http://192.168.1.30/send', DEPLOYMENT: 'local' }).OTP_DELIVERY,
    ).toBe('sms');
  });

  it('refuse an unknown placeholder and a template that carries neither the code nor the message', () => {
    const base = { OTP_DELIVERY: 'sms', SMS_GATEWAY_URL: 'https://sms.example/send' };
    expect(() => testEnv({ ...base, SMS_GATEWAY_BODY: '{"to":"{phone}","t":"{texte}"}' })).toThrow(
      /unknown placeholder \{texte\}/,
    );
    expect(() => testEnv({ ...base, SMS_GATEWAY_BODY: '{"to":"{phone}"}' })).toThrow(
      /must contain \{message\} or \{code\}/,
    );
    expect(
      testEnv({
        ...base,
        SMS_GATEWAY_METHOD: 'GET',
        SMS_GATEWAY_URL: 'https://sms.example/s?to={phone}&m={message}',
      }).SMS_GATEWAY_METHOD,
    ).toBe('GET');
  });

  it('refuse an auth header that is not one line', () => {
    const base = { OTP_DELIVERY: 'sms', SMS_GATEWAY_URL: 'https://sms.example/send' };
    expect(() => testEnv({ ...base, SMS_GATEWAY_AUTH_HEADER: 'no-colon' })).toThrow(/Name: value/);
    expect(() => testEnv({ ...base, SMS_GATEWAY_AUTH_HEADER: 'X-Key: a\r\nX-Evil: 1' })).toThrow(
      /Name: value/,
    );
    expect(testEnv({ ...base, SMS_GATEWAY_AUTH_HEADER: 'Authorization: Bearer abc' }).OTP_DELIVERY).toBe(
      'sms',
    );
  });

  it('check the fallback', () => {
    const sms = { SMS_GATEWAY_URL: 'https://sms.example/send' };
    const bot = { OTP_GATEWAY_URL: 'https://bot.example/send', OTP_GATEWAY_TOKEN: TOKEN };
    expect(() => testEnv({ OTP_FALLBACK: 'sms', ...sms })).toThrow(/needs OTP_DELIVERY/);
    expect(() => testEnv({ OTP_DELIVERY: 'sms', OTP_FALLBACK: 'sms', ...sms })).toThrow(/other channel/);
    // The fallback's own settings are required too
    expect(() => testEnv({ OTP_DELIVERY: 'sms', OTP_FALLBACK: 'gateway', ...sms })).toThrow(
      /OTP_GATEWAY_URL/,
    );
    expect(() => testEnv({ OTP_DELIVERY: 'gateway', OTP_FALLBACK: 'sms', ...bot })).toThrow(
      /SMS_GATEWAY_URL/,
    );
    expect(testEnv({ OTP_DELIVERY: 'sms', OTP_FALLBACK: 'gateway', ...sms, ...bot }).OTP_FALLBACK).toBe(
      'gateway',
    );
  });

  it('read as not set when empty, as docker compose passes an unset value', () => {
    const env = testEnv({
      SMS_GATEWAY_URL: '',
      SMS_GATEWAY_METHOD: '',
      SMS_GATEWAY_AUTH_HEADER: '',
      SMS_GATEWAY_CONTENT_TYPE: '',
      OTP_FALLBACK: '',
    });
    expect(env.SMS_GATEWAY_URL).toBeUndefined();
    expect(env.SMS_GATEWAY_METHOD).toBe('POST');
    expect(env.SMS_GATEWAY_CONTENT_TYPE).toBe('application/json');
    expect(env.OTP_FALLBACK).toBeUndefined();
  });

  it('pick the sms sender', () => {
    const env = testEnv({ OTP_DELIVERY: 'sms', SMS_GATEWAY_URL: `${smsBase}/send` });
    expect(otpSenderFor(env, log)).not.toBeNull();
  });
});
