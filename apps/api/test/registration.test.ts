import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TERMS_VERSION } from '@serva/core';
import { MINUTE_MS, ManualClock } from '../src/clock';
import { REFRESH_COOKIE } from '../src/routes/auth';
import {
  closeAppDb,
  closeOwnerDb,
  codes,
  makeApp,
  ownerDb,
  registerStore,
  resetDatabase,
  storeInput,
} from './helpers';

const clock = new ManualClock();
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
  clock.set('2026-10-30T09:00:00.000Z');
  codes.sent.length = 0;
  await resetDatabase();
});

const start = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/auth/register', payload });
const verify = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/auth/register/verify', payload });
const count = async (table: string) =>
  (await ownerDb().unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]!.n;

describe('opening an account: three fields, then the code', () => {
  it('sends a code and creates nothing until it is confirmed', async () => {
    const res = await start(storeInput());
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ registrationId: expect.any(String), expiresIn: 600 });
    expect(codes.last('+963912345678')).toMatch(/^\d{6}$/);
    expect(await count('tenants')).toBe(0);
    expect(await count('users')).toBe(0);
  });

  it('the code opens the store, signs the owner in and starts a 30-day trial', async () => {
    const { registrationId } = (await start(storeInput())).json();
    const res = await verify({
      registrationId,
      code: codes.last('+963912345678'),
      password: 'secret-pass-1',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ fullName: 'أحمد الخطيب', phone: '+963912345678' });
    expect(body.tenant.name).toBe('متجر أحمد الخطيب');
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
    });

    const [sub] = await ownerDb()<{ days: number }[]>`
      select extract(day from trial_ends_at - current_period_start)::int as days from subscriptions`;
    expect(sub?.days).toBe(30);
  });

  it('creates no device at sign-up and records the accepted terms', async () => {
    const { body } = await registerStore(app);
    expect(await count('devices')).toBe(0);
    const [settings] = await ownerDb()<{ steps: Record<string, number> }[]>`
      select cash_rounding_steps as steps from tenant_settings`;
    expect(settings?.steps).toEqual({ SYP: 1000, USD: 25 }); // cash step per currency (09/10)

    const rows = await ownerDb()<
      { document: string; document_version: string; context: string; user_id: string }[]
    >`
      select document, document_version, context, user_id from legal_acceptances`;
    expect(rows).toEqual([
      { document: 'terms', document_version: TERMS_VERSION, context: 'registration', user_id: body.user.id },
    ]);
  });

  it('refuses a sign-up without the terms version, and old fields are not required', async () => {
    const res = await start({ phone: '123', fullName: '', password: 'short' });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(Object.keys(error.fields).sort()).toEqual(['fullName', 'password', 'phone', 'termsVersion']);
    expect(error.fields.password).toBe('كلمة السر 8 أحرف على الأقل');
  });

  it('accepts Arabic-Indic digits in the phone number and the code', async () => {
    const { registrationId } = (await start(storeInput({ phone: '٠٩٤٤١٢٣٤٥٦' }))).json();
    const code = codes.last('+963944123456')!;
    const arabic = code.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
    const res = await verify({ registrationId, code: arabic, password: 'secret-pass-1' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.phone).toBe('+963944123456');
  });
});

describe('sign-up does not reveal or reserve phone numbers', () => {
  it('answers a registered number exactly like a new one, and sends it no code', async () => {
    await registerStore(app, { phone: '0912345678' });
    codes.sent.length = 0;

    const taken = await start(storeInput({ phone: '+963 912 345 678' }));
    const fresh = await start(storeInput({ phone: '0933333333' }));
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(Object.keys(taken.json()).sort()).toEqual(Object.keys(fresh.json()).sort());
    expect(taken.json().expiresIn).toBe(fresh.json().expiresIn);
    expect(codes.sent.map((m) => m.phone)).toEqual(['+963933333333']);

    // Guessing a code for the registered number goes nowhere.
    const guess = await verify({
      registrationId: taken.json().registrationId,
      code: '123456',
      password: 'x'.repeat(10),
    });
    expect(guess.json().error.code).toBe('otp_invalid');
  });

  it('an unconfirmed sign-up does not stop the real owner from opening the account', async () => {
    await start(storeInput({ fullName: 'منتحل' }));
    const { body } = await registerStore(app, { fullName: 'صاحب الرقم' });
    expect(body.user.fullName).toBe('صاحب الرقم');
  });

  it('unconfirmed sign-ups are deleted after 24 hours', async () => {
    await start(storeInput());
    expect(await count('otp_challenges')).toBe(1);
    clock.advance(25 * 60 * MINUTE_MS);
    await start(storeInput({ phone: '0933333333' }));
    const phones = await ownerDb()<{ phone: string }[]>`select phone from otp_challenges`;
    expect(phones).toEqual([{ phone: '+963933333333' }]);
  });

  it('limits codes sent to one number', async () => {
    const limited = await makeApp({ REGISTER_PHONE_LIMIT_PER_HOUR: '2' }, { clock });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push(
          (await limited.inject({ method: 'POST', url: '/v1/auth/register', payload: storeInput() }))
            .statusCode,
        );
      }
      expect(statuses).toEqual([202, 202, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('the code', () => {
  it('a wrong code is refused, and five wrong codes lock it', async () => {
    const { registrationId } = (await start(storeInput())).json();
    const right = codes.last('+963912345678')!;
    const wrong = right === '000000' ? '111111' : '000000';

    const first = await verify({ registrationId, code: wrong, password: 'secret-pass-1' });
    expect(first.statusCode).toBe(400);
    expect(first.json().error).toMatchObject({ code: 'otp_invalid', fields: { code: expect.any(String) } });

    for (let i = 0; i < 3; i++) await verify({ registrationId, code: wrong, password: 'secret-pass-1' });
    const fifth = await verify({ registrationId, code: wrong, password: 'secret-pass-1' });
    expect(fifth.json().error.code).toBe('locked');
    const late = await verify({ registrationId, code: right, password: 'secret-pass-1' });
    expect(late.json().error.code).toBe('locked');
    expect(await count('tenants')).toBe(0);
  });

  it('expires after 10 minutes and works only once', async () => {
    const { registrationId } = (await start(storeInput())).json();
    const code = codes.last('+963912345678')!;
    clock.advance(11 * MINUTE_MS);
    const expired = await verify({ registrationId, code, password: 'secret-pass-1' });
    expect(expired.json().error).toMatchObject({
      code: 'otp_invalid',
      message: expect.stringContaining('انتهت صلاحية'),
    });

    const again = (await start(storeInput())).json();
    const ok = await verify({
      registrationId: again.registrationId,
      code: codes.last('+963912345678'),
      password: 'secret-pass-1',
    });
    expect(ok.statusCode).toBe(201);
    const reused = await verify({
      registrationId: again.registrationId,
      code: codes.last('+963912345678'),
      password: 'secret-pass-1',
    });
    expect(reused.json().error.code).toBe('otp_invalid');
  });

  it('is never stored in clear', async () => {
    await start(storeInput());
    const code = codes.last('+963912345678')!;
    const rows = await ownerDb()<
      { code_hash: string; payload: unknown }[]
    >`select code_hash, payload from otp_challenges`;
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(JSON.stringify(rows)).not.toContain('secret-pass-1');
  });

  it('a number registered between the two steps is told only after its code is confirmed', async () => {
    const { registrationId } = (await start(storeInput())).json();
    const code = codes.last('+963912345678');
    await registerStore(app, { fullName: 'أسرع' });

    const res = await verify({ registrationId, code, password: 'secret-pass-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('phone_taken');
  });
});

describe('agent code', () => {
  beforeEach(async () => {
    await ownerDb()`insert into agents (code, full_name) values ('AG-42', 'وكيل الرقة')`;
    await ownerDb()`insert into agents (code, full_name, status) values ('AG-OLD', 'وكيل موقوف', 'suspended')`;
  });

  it('links the store to an active agent, whatever the letter case', async () => {
    const { body } = await registerStore(app, { agentCode: 'ag-42' });
    const [tenant] = await ownerDb()<{ code: string }[]>`
      select a.code from tenants t join agents a on a.id = t.agent_id where t.id = ${body.tenant.id}`;
    expect(tenant?.code).toBe('AG-42');
  });

  it('refuses an unknown or suspended agent code before sending anything', async () => {
    for (const agentCode of ['AG-404', 'AG-OLD']) {
      const res = await start(storeInput({ agentCode }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toEqual({ agentCode: expect.stringContaining('كود الوكيل غير صحيح') });
    }
    expect(codes.sent).toEqual([]);
  });
});

describe('without a code channel', () => {
  it('sign-up answers 503 instead of pretending to send', async () => {
    const offline = await makeApp({}, { clock, otpSender: null });
    try {
      const res = await offline.inject({ method: 'POST', url: '/v1/auth/register', payload: storeInput() });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('unavailable');
    } finally {
      await offline.close();
    }
  });
});
