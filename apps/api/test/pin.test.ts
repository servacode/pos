import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { StaffSessionResponse } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { ManualClock } from '../src/clock';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

let app: FastifyInstance;
let clock: ManualClock;
let s: TestStore;

beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
  s = await testStore(app);
});

const OWNER_PASSWORD = 'secret-pass-1';

const setPin = (token: string, pin: string, password = OWNER_PASSWORD) =>
  app.inject({ method: 'PUT', url: '/v1/me/pin', headers: bearer(token), payload: { pin, password } });

const signIn = (device: TestDevice, userId: string, pin: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/staff-sessions',
    headers: { authorization: device.authorization },
    payload: { userId, pin },
  });

const userRow = async (id: string) =>
  (
    await ownerDb()<{ pin_hash: string | null; pin_length: number | null; pin_version: number }[]>`
      select pin_hash, pin_length, pin_version from users where id = ${id}`
  )[0]!;

describe('PUT /v1/me/pin', () => {
  it('sets my PIN (Arabic digits accepted) as a slow hash, with its length and a new version', async () => {
    const res = await setPin(s.accessToken, '٢٨٥٧١٣');
    expect(res.statusCode, res.body).toBe(204);
    const row = await userRow(s.userId);
    expect(row.pin_length).toBe(6);
    expect(row.pin_version).toBe(1);
    expect(row.pin_hash).toMatch(/^\$argon2id\$/);
    expect(row.pin_hash).not.toContain('285713');
    expect((await setPin(s.accessToken, '491627')).statusCode).toBe(204);
    expect((await userRow(s.userId)).pin_version).toBe(2);
    const [log] = await ownerDb()<{ data: unknown }[]>`
      select data from audit_logs where action = 'user.pin_set' order by created_at desc limit 1`;
    expect(log!.data).toEqual({ pinLength: 6, pinVersion: 2 });
  });

  it('devices see the new length and version, never the hash', async () => {
    await setPin(s.accessToken, '285713');
    const device = await createDevice(s.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: device.authorization },
    });
    const users = res.json<PullResponse>().sets.users!.upserts;
    expect(users).toEqual([expect.objectContaining({ id: s.userId, pinLength: 6, pinVersion: 1 })]);
    expect(res.body).not.toMatch(/\$argon2/);
  });

  it('asks owners and managers for 6 digits; a cashier may use 4', async () => {
    const owner4 = await setPin(s.accessToken, '2857');
    expect(owner4.statusCode).toBe(400);
    expect(owner4.json().error.fields).toEqual({ pin: 'رمز المدير والمالك 6 أرقام' });
    const manager = await staffUser(app, s, 'manager', '0933333333');
    expect((await setPin(manager.accessToken, '2857', 'secret-pass-2')).statusCode).toBe(400);
    const cashier = await staffUser(app, s, 'cashier', '0944444444');
    expect((await setPin(cashier.accessToken, '2857', 'secret-pass-2')).statusCode).toBe(204);
    expect((await userRow(cashier.userId)).pin_length).toBe(4);
    expect((await userRow(s.userId)).pin_hash).toBeNull();
  });

  it('refuses trivial PINs', async () => {
    for (const pin of ['123456', '000000', '987654', '1234']) {
      const res = await setPin(s.accessToken, pin);
      expect(res.statusCode, pin).toBe(400);
      expect(res.json().error.fields.pin).toBeDefined();
    }
  });

  it('a wrong password answers 400 invalid_credentials on password, not 401, and changes nothing', async () => {
    const res = await setPin(s.accessToken, '285713', 'wrong-password');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'invalid_credentials',
      fields: { password: 'كلمة السر غير صحيحة' },
    });
    expect((await userRow(s.userId)).pin_hash).toBeNull();
    // The sign-in is still good.
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(s.accessToken) })).statusCode,
    ).toBe(200);
  });
});

describe('POST /v1/device/staff-sessions', () => {
  it('signs in with the PIN: the roles and permissions of the device’s branch, the PIN version and length', async () => {
    await setPin(s.accessToken, '285713');
    const device = await createDevice(s.tenantId);
    const res = await signIn(device, s.userId, '٢٨٥٧١٣');
    expect(res.statusCode, res.body).toBe(200);
    const session = res.json<StaffSessionResponse>();
    expect(session).toMatchObject({
      userId: s.userId,
      fullName: 'أحمد الخطيب',
      roles: [{ key: 'owner', name: 'المالك', branchId: null }],
      pinVersion: 1,
      pinLength: 6,
    });
    expect(session.permissions).toContain('sale.discount_over_limit');
    const [log] = await ownerDb()<{ action: string; actor_type: string; device_id: string }[]>`
      select action, actor_type, device_id from audit_logs where action like 'staff_session.%'`;
    expect(log).toEqual({
      action: 'staff_session.signed_in',
      actor_type: 'device',
      device_id: device.deviceId,
    });
  });

  it('a wrong PIN is 401 pin_invalid; the fifth locks for a minute, doubling after; the lock is per device', async () => {
    await setPin(s.accessToken, '285713');
    const device = await createDevice(s.tenantId);
    for (let i = 1; i <= 4; i++) {
      const res = await signIn(device, s.userId, '111222');
      expect(res.statusCode, `try ${i}`).toBe(401);
      expect(res.json().error.code).toBe('pin_invalid');
    }
    const fifth = await signIn(device, s.userId, '111222');
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().error).toMatchObject({ code: 'locked', retryAfter: 60 });
    expect(fifth.headers['retry-after']).toBe('60');
    // Locked: even the right PIN waits.
    clock.set('2026-10-30T09:00:30.000Z');
    const waiting = await signIn(device, s.userId, '285713');
    expect(waiting.json().error).toMatchObject({ code: 'locked', retryAfter: 30 });
    // Another device of the store is not locked for this user.
    const other = await createDevice(s.tenantId);
    expect((await signIn(other, s.userId, '285713')).statusCode).toBe(200);
    // After the minute, one more failure locks for two minutes.
    clock.set('2026-10-30T09:01:01.000Z');
    expect((await signIn(device, s.userId, '111222')).json().error).toMatchObject({ retryAfter: 120 });
    clock.set('2026-10-30T09:03:02.000Z');
    expect((await signIn(device, s.userId, '285713')).statusCode).toBe(200);
    // A success clears the count: four more failures do not lock.
    for (let i = 0; i < 4; i++) expect((await signIn(device, s.userId, '111222')).statusCode).toBe(401);

    const actions = await ownerDb()<{ action: string; n: number }[]>`
      select action, count(*)::int as n from audit_logs where action like 'staff_session.%'
      group by action order by action`;
    expect(actions).toEqual([
      { action: 'staff_session.failed', n: 10 },
      { action: 'staff_session.locked', n: 1 },
      { action: 'staff_session.signed_in', n: 2 },
    ]);
  });

  it('two wrong PINs sent at once both count', async () => {
    await setPin(s.accessToken, '285713');
    const device = await createDevice(s.tenantId);
    await Promise.all([1, 2, 3, 4, 5].map(() => signIn(device, s.userId, '111222')));
    const [row] = await ownerDb()<{ failures: number }[]>`select failures from pin_attempts`;
    expect(row!.failures).toBe(5);
    expect((await signIn(device, s.userId, '285713')).statusCode).toBe(429);
  });

  it('refuses a user of another branch, a disabled user, a user without PIN and an unknown id alike', async () => {
    const device = await createDevice(s.tenantId);
    const [branch] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${s.tenantId}, '002', 'فرع آخر') returning id`;
    const elsewhere = await staffUser(app, s, 'cashier', '0944444444', { branchId: branch!.id });
    await setPin(elsewhere.accessToken, '2857', 'secret-pass-2');
    const disabled = await staffUser(app, s, 'cashier', '0955555555');
    await setPin(disabled.accessToken, '2857', 'secret-pass-2');
    await ownerDb()`update users set status = 'disabled' where id = ${disabled.userId}`;
    const noPin = await staffUser(app, s, 'cashier', '0966666666');
    for (const userId of [
      elsewhere.userId,
      disabled.userId,
      noPin.userId,
      '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
    ]) {
      const res = await signIn(device, userId, '2857');
      expect(res.statusCode, userId).toBe(401);
      expect(res.json().error.code).toBe('pin_invalid');
    }
    // A cashier given a role for this branch signs in with 4 digits.
    const here = await staffUser(app, s, 'cashier', '0977777777', { branchId: device.branchId });
    await setPin(here.accessToken, '2857', 'secret-pass-2');
    const ok = await signIn(device, here.userId, '2857');
    expect(ok.json()).toMatchObject({ pinLength: 4, roles: [{ key: 'cashier', branchId: device.branchId }] });
    expect(ok.json<StaffSessionResponse>().permissions).toEqual([
      'sale.create',
      'sale.discount',
      'shift.close_own',
    ]);
  });

  it('a new PIN clears the lockout and the old PIN stops working', async () => {
    await setPin(s.accessToken, '285713');
    const device = await createDevice(s.tenantId);
    for (let i = 0; i < 5; i++) await signIn(device, s.userId, '111222');
    expect((await signIn(device, s.userId, '285713')).statusCode).toBe(429);
    await setPin(s.accessToken, '491627');
    expect((await signIn(device, s.userId, '285713')).statusCode).toBe(401);
    const res = await signIn(device, s.userId, '491627');
    expect(res.json()).toMatchObject({ pinVersion: 2 });
  });

  it('validates the body', async () => {
    const device = await createDevice(s.tenantId);
    const res = await signIn(device, 'nope', '12');
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['pin', 'userId']);
  });
});
