import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { StaffListResponse, StaffMember } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, STAFF_PASSWORD, staffUser, testStore, type TestStore } from './staff';

let app: FastifyInstance;
let s: TestStore;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  s = await testStore(app);
});

const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });

const create = (token: string, extra: Record<string, unknown> = {}) =>
  call(token, 'POST', '/v1/staff', {
    fullName: 'سامر الكاشير',
    roleKey: 'cashier',
    branchIds: null,
    pin: '4829',
    ...extra,
  });

/** Signs a person in on a (new) device of the store's first branch. */
const tillSignIn = async (userId: string, pin: string) => {
  const device = await createDevice(s.tenantId);
  return app.inject({
    method: 'POST',
    url: '/v1/device/staff-sessions',
    headers: { authorization: device.authorization },
    payload: { userId, pin },
  });
};

const pullUsers = async () => {
  const device = await createDevice(s.tenantId);
  await settled();
  const pull = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: device.authorization },
  });
  expect(pull.body).not.toMatch(/\$argon2/);
  return pull.json<PullResponse>().sets.users!.upserts as { id: string; status: string; pinLength: number }[];
};

describe('GET /v1/staff', () => {
  it('lists the people, the roles (owner not assignable) and the branches for the owner', async () => {
    const res = await call(s.accessToken, 'GET', '/v1/staff');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<StaffListResponse>();
    expect(body.staff).toHaveLength(1);
    expect(body.staff[0]).toMatchObject({ id: s.userId, isOwner: true, roleKey: 'owner', branchIds: null });
    expect(body.roles.map((r) => [r.key, r.assignable])).toEqual(
      expect.arrayContaining([
        ['owner', false],
        ['manager', true],
        ['cashier', true],
      ]),
    );
    expect(body.roles.find((r) => r.key === 'cashier')!.pinLength).toBe(4);
    expect(body.roles.find((r) => r.key === 'manager')!.pinLength).toBe(6);
    expect(body.branches).toHaveLength(1);
    expect(res.body).not.toMatch(/argon2|pin_hash|passwordHash/);
  });

  it('refuses a manager and a cashier (no users.manage) on every staff route', async () => {
    const manager = await staffUser(app, s, 'manager', '0922222222');
    const cashier = await staffUser(app, s, 'cashier', '0933333333');
    for (const who of [manager, cashier]) {
      expect((await call(who.accessToken, 'GET', '/v1/staff')).statusCode).toBe(403);
      expect((await create(who.accessToken)).statusCode).toBe(403);
      expect((await call(who.accessToken, 'POST', `/v1/staff/${s.userId}/deactivate`)).statusCode).toBe(403);
    }
    expect((await ownerDb()`select 1 from users where tenant_id = ${s.tenantId}`).length).toBe(3);
  });

  it('shows only this store people', async () => {
    const other = await testStore(app, '0955555555');
    await create(other.accessToken, { fullName: 'موظف المتجر الآخر' });
    const body = (await call(s.accessToken, 'GET', '/v1/staff')).json<StaffListResponse>();
    expect(body.staff.map((p) => p.id)).toEqual([s.userId]);
  });
});

describe('POST /v1/staff', () => {
  it('adds a PIN-only cashier who signs in on the till, and syncs to devices', async () => {
    const res = await create(s.accessToken);
    expect(res.statusCode, res.body).toBe(201);
    const member = res.json<StaffMember>();
    expect(member).toMatchObject({
      fullName: 'سامر الكاشير',
      roleKey: 'cashier',
      status: 'active',
      hasPin: true,
      pinLength: 4,
      hasLogin: false,
      branchIds: null,
    });
    const session = await tillSignIn(member.id, '4829');
    expect(session.statusCode, session.body).toBe(200);
    expect(session.json().permissions).toContain('sale.create');
    expect((await tillSignIn(member.id, '1357')).statusCode).toBe(401);

    expect((await pullUsers()).find((u) => u.id === member.id)).toMatchObject({
      status: 'active',
      pinLength: 4,
    });
    const logs = await ownerDb()`select 1 from audit_logs where action = 'staff.create'`;
    expect(logs).toHaveLength(1);
  });

  it('adds a manager with an admin login, who can then sign in to the panel', async () => {
    const res = await create(s.accessToken, {
      fullName: 'منى المديرة',
      roleKey: 'manager',
      phone: '0966666666',
      password: STAFF_PASSWORD,
      pin: '482913',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<StaffMember>()).toMatchObject({ hasLogin: true, pinLength: 6, roleKey: 'manager' });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0966666666', password: STAFF_PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
  });

  it('restricts a person to chosen branches', async () => {
    const [branch2] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${s.tenantId}, '002', 'فرع ثانٍ') returning id`;
    const res = await create(s.accessToken, { branchIds: [branch2!.id] });
    expect(res.statusCode, res.body).toBe(201);
    const member = res.json<StaffMember>();
    expect(member.branchIds).toEqual([branch2!.id]);
    // The device is in the first branch: this person is not allowed there.
    expect((await tillSignIn(member.id, '4829')).statusCode).toBe(401);
  });

  it('refuses bad input with field messages', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ pin: '1234' }, 'pin'],
      [{ roleKey: 'manager', pin: '4829' }, 'pin'],
      [{ password: STAFF_PASSWORD }, 'phone'],
      [{ roleKey: 'ghost' }, 'roleKey'],
      [{ branchIds: ['0192a000-0000-7000-8000-000000000001'] }, 'branchIds'],
      [{ branchIds: [] }, 'branchIds'],
      [{ fullName: 'س' }, 'fullName'],
    ];
    for (const [extra, field] of cases) {
      const res = await create(s.accessToken, extra);
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(Object.keys(res.json().error.fields), JSON.stringify(extra)).toContain(field);
    }
    expect((await ownerDb()`select 1 from users where tenant_id = ${s.tenantId}`).length).toBe(1);
  });

  it('refuses a phone already used by an account (409 phone_taken)', async () => {
    await testStore(app, '0955555555');
    const res = await create(s.accessToken, { phone: '0955555555' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('phone_taken');
  });

  it('never gives the owner role', async () => {
    const res = await create(s.accessToken, { roleKey: 'owner', pin: '482913' });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /v1/staff/:id and the PIN', () => {
  it('renames, promotes (a longer PIN is asked for) and demotes', async () => {
    const member = (await create(s.accessToken)).json<StaffMember>();
    const renamed = await call(s.accessToken, 'PATCH', `/v1/staff/${member.id}`, { fullName: 'سامر الجديد' });
    expect(renamed.json<StaffMember>().fullName).toBe('سامر الجديد');

    const noPin = await call(s.accessToken, 'PATCH', `/v1/staff/${member.id}`, { roleKey: 'manager' });
    expect(noPin.statusCode).toBe(400);
    expect(Object.keys(noPin.json().error.fields)).toContain('pin');

    const promoted = await call(s.accessToken, 'PATCH', `/v1/staff/${member.id}`, {
      roleKey: 'manager',
      pin: '482913',
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json<StaffMember>()).toMatchObject({ roleKey: 'manager', pinLength: 6 });
    expect((await tillSignIn(member.id, '482913')).statusCode).toBe(200);

    const demoted = await call(s.accessToken, 'PATCH', `/v1/staff/${member.id}`, { roleKey: 'cashier' });
    expect(demoted.json<StaffMember>().roleKey).toBe('cashier');
    expect((await ownerDb()`select 1 from user_roles where user_id = ${member.id}`).length).toBe(1);
  });

  it('resets a PIN: the old one stops and the version moves up', async () => {
    const member = (await create(s.accessToken)).json<StaffMember>();
    const res = await call(s.accessToken, 'POST', `/v1/staff/${member.id}/pin`, { pin: '7391' });
    expect(res.statusCode, res.body).toBe(204);
    expect((await tillSignIn(member.id, '4829')).statusCode).toBe(401);
    expect((await tillSignIn(member.id, '7391')).statusCode).toBe(200);
    const [row] = await ownerDb()<
      { pin_version: number }[]
    >`select pin_version from users where id = ${member.id}`;
    expect(row!.pin_version).toBe(2);
    expect(
      (await call(s.accessToken, 'POST', `/v1/staff/${member.id}/pin`, { pin: '1234' })).statusCode,
    ).toBe(400);
  });

  it('sets a new admin password', async () => {
    const member = (
      await create(s.accessToken, { phone: '0977777777', password: STAFF_PASSWORD })
    ).json<StaffMember>();
    const res = await call(s.accessToken, 'PATCH', `/v1/staff/${member.id}`, { password: 'another-pass-9' });
    expect(res.statusCode, res.body).toBe(200);
    const login = (password: string) =>
      app.inject({ method: 'POST', url: '/v1/auth/login', payload: { phone: '0977777777', password } });
    expect((await login(STAFF_PASSWORD)).statusCode).toBe(401);
    expect((await login('another-pass-9')).statusCode).toBe(200);
  });
});

describe('owner protection and escalation', () => {
  it('the owner cannot be edited, demoted, deactivated or have their PIN reset here', async () => {
    const attempts: ['PATCH' | 'POST', string, unknown?][] = [
      ['PATCH', `/v1/staff/${s.userId}`, { roleKey: 'cashier' }],
      ['PATCH', `/v1/staff/${s.userId}`, { fullName: 'غيره' }],
      ['POST', `/v1/staff/${s.userId}/deactivate`],
      ['POST', `/v1/staff/${s.userId}/pin`, { pin: '482913' }],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await call(s.accessToken, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    const [row] = await ownerDb()<{ status: string }[]>`select status from users where id = ${s.userId}`;
    expect(row!.status).toBe('active');
    const owned = await ownerDb()`
      select 1 from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = ${s.userId} and r.key = 'owner'`;
    expect(owned).toHaveLength(1);
  });

  it('refuses giving a role with more than the giver holds, and touching a stronger person', async () => {
    // A role that can manage staff and sell, and nothing else.
    await ownerDb()`
      insert into roles (tenant_id, key, name, permissions)
      values (${s.tenantId}, 'lead', 'مسؤول موظفين', ${['users.manage', 'sale.create']})`;
    const lead = await staffUser(app, s, 'lead', '0988888888');
    const manager = await staffUser(app, s, 'manager', '0999999999');

    const list = (await call(lead.accessToken, 'GET', '/v1/staff')).json<StaffListResponse>();
    expect(list.roles.find((r) => r.key === 'manager')!.assignable).toBe(false);
    expect(list.roles.find((r) => r.key === 'cashier')!.assignable).toBe(false);
    expect(list.roles.find((r) => r.key === 'lead')!.assignable).toBe(true);

    expect((await create(lead.accessToken, { roleKey: 'manager', pin: '482913' })).statusCode).toBe(403);
    expect((await create(lead.accessToken, { roleKey: 'cashier' })).statusCode).toBe(403);
    expect((await create(lead.accessToken, { roleKey: 'lead', pin: '482913' })).statusCode).toBe(201);
    // The manager holds more than the lead: not theirs to change, stop or re-PIN.
    expect((await call(lead.accessToken, 'POST', `/v1/staff/${manager.userId}/deactivate`)).statusCode).toBe(
      403,
    );
    expect(
      (await call(lead.accessToken, 'PATCH', `/v1/staff/${manager.userId}`, { fullName: 'اسم جديد' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(lead.accessToken, 'POST', `/v1/staff/${manager.userId}/pin`, { pin: '482913' })).statusCode,
    ).toBe(403);
    // Nor oneself.
    expect((await call(lead.accessToken, 'POST', `/v1/staff/${lead.userId}/deactivate`)).statusCode).toBe(
      403,
    );
    expect(
      (
        await call(lead.accessToken, 'PATCH', `/v1/staff/${lead.userId}`, {
          roleKey: 'manager',
          pin: '482913',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('deactivate and reactivate', () => {
  it('ends their sessions at once, blocks the till, and reactivating brings them back', async () => {
    const member = (
      await create(s.accessToken, { phone: '0977777777', password: STAFF_PASSWORD })
    ).json<StaffMember>();
    const signIn = () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { phone: '0977777777', password: STAFF_PASSWORD },
      });
    const token = (await signIn()).json<{ accessToken: string }>().accessToken;
    expect((await call(token, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await tillSignIn(member.id, '4829')).statusCode).toBe(200);

    const off = await call(s.accessToken, 'POST', `/v1/staff/${member.id}/deactivate`);
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json<StaffMember>().status).toBe('disabled');
    expect((await call(token, 'GET', '/v1/me')).statusCode).toBe(401);
    const live = await ownerDb()`select 1 from sessions where user_id = ${member.id} and revoked_at is null`;
    expect(live).toHaveLength(0);
    expect((await tillSignIn(member.id, '4829')).statusCode).toBe(401);
    expect((await signIn()).statusCode).toBe(401);

    // The till learns of it through the users pull set.
    expect((await pullUsers()).find((u) => u.id === member.id)!.status).toBe('disabled');

    const on = await call(s.accessToken, 'POST', `/v1/staff/${member.id}/reactivate`);
    expect(on.json<StaffMember>().status).toBe('active');
    expect((await tillSignIn(member.id, '4829')).statusCode).toBe(200);
    const actions = await ownerDb()<
      { action: string }[]
    >`select action from audit_logs where action like 'staff.%'`;
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['staff.create', 'staff.deactivate', 'staff.reactivate']),
    );
  });
});
