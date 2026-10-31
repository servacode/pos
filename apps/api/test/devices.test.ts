import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  normalizePhone,
  PAIRING_CODE_ALPHABET,
  parsePairingQr,
  type ActivatedDevice,
  type DeviceSummary,
  type PairingCodeResponse,
  type PendingActivation,
} from '@serva/core';
import type { ActivatedDeviceInfo } from '@serva/sync/client';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock } from '../src/clock';
import { activateDevice, createDevice, deviceFields, firstBranch, linkDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

// The device helpers of @serva/sync take the contract's ActivatedDevice as it is.
const _sameShape: ActivatedDeviceInfo = {} as ActivatedDevice;
void _sameShape;

let app: FastifyInstance;
let clock: ManualClock;

beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({ PUBLIC_WEB_ORIGIN: 'https://app.serva.test/' }, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
});

interface Store {
  tenantId: string;
  userId: string;
  accessToken: string;
  branchId: string;
}

async function store(phone = '0911111111'): Promise<Store> {
  const { body } = await registerStore(app, { phone });
  return {
    tenantId: body.tenant.id,
    userId: body.user.id,
    accessToken: body.accessToken,
    branchId: await firstBranch(body.tenant.id),
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Another person of the store with one system role (optionally for one branch), signed in. */
async function staff(s: Store, role: 'manager' | 'cashier', phone: string, branchId: string | null = null) {
  const e164 = normalizePhone(phone)!;
  const [user] = await ownerDb()<{ id: string }[]>`
    insert into users (tenant_id, full_name, phone, password_hash)
    values (${s.tenantId}, 'موظف', ${e164}, ${await hashSecret('secret-pass-2')}) returning id`;
  await ownerDb()`
    insert into user_roles (tenant_id, user_id, role_id, branch_id)
    select ${s.tenantId}, ${user!.id}, id, ${branchId} from roles where tenant_id = ${s.tenantId} and key = ${role}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { phone, password: 'secret-pass-2' },
  });
  return res.json<{ accessToken: string }>().accessToken;
}

async function secondBranch(s: Store): Promise<string> {
  const [branch] = await ownerDb()<{ id: string }[]>`
    insert into branches (tenant_id, code, name) values (${s.tenantId}, '002', 'فرع المزة') returning id`;
  return branch!.id;
}

async function pairingCode(s: Store, branchId = s.branchId): Promise<PairingCodeResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices/pairing-codes',
    headers: bearer(s.accessToken),
    payload: { branchId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

function activate(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/v1/devices/activate', headers, payload });
}

async function typeCode(pairing: PairingCodeResponse, manualCode = pairing.manualCode, name = 'كاشير 1') {
  return activate({ method: 'code', storeCode: pairing.storeCode, manualCode, ...deviceFields(name) });
}

async function pending(s: Store, name = 'كاشير 1'): Promise<PendingActivation> {
  const res = await typeCode(await pairingCode(s), undefined, name);
  expect(res.statusCode, res.body).toBe(202);
  return res.json();
}

const poll = (activation: Pick<PendingActivation, 'activationId' | 'activationSecret'>) =>
  app.inject({
    method: 'GET',
    url: `/v1/devices/activations/${activation.activationId}`,
    headers: { authorization: `Activation ${activation.activationSecret}` },
  });

const act = (s: Store, id: string, action: 'approve' | 'reject' | 'revoke', token = s.accessToken) =>
  app.inject({ method: 'POST', url: `/v1/devices/${id}/${action}`, headers: bearer(token) });

async function list(token: string): Promise<DeviceSummary[]> {
  const res = await app.inject({ method: 'GET', url: '/v1/devices', headers: bearer(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ devices: DeviceSummary[] }>().devices;
}

const auditActions = async (tenantId: string) =>
  (
    await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${tenantId} and action like 'device.%' order by created_at, id`
  ).map((r) => r.action);

describe('POST /v1/devices/pairing-codes', () => {
  it('gives the owner a QR and a typed code for a branch, valid 10 minutes, and keeps only their hashes', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    const [tenant] = await ownerDb()<
      { store_code: string }[]
    >`select store_code from tenants where id = ${s.tenantId}`;
    expect(pairing).toMatchObject({
      branchId: s.branchId,
      branchName: 'الفرع الرئيسي',
      storeCode: tenant!.store_code,
      expiresAt: '2026-10-30T09:10:00.000Z',
      maxAttempts: 5,
    });
    expect(pairing.qrPayload).toBe(`https://app.serva.test/link#${pairing.qrToken}`);
    expect(parsePairingQr(pairing.qrPayload)).toBe(pairing.qrToken);
    expect(pairing.manualCode).toHaveLength(8);
    expect([...pairing.manualCode].every((c) => PAIRING_CODE_ALPHABET.includes(c))).toBe(true);

    const rows = await ownerDb()`select * from device_pairings where tenant_id = ${s.tenantId}`;
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(pairing.qrToken);
    expect(stored).not.toContain(pairing.manualCode);
    expect(rows[0]).toMatchObject({ created_by: s.userId, attempts: 0, used_at: null });
    expect(await auditActions(s.tenantId)).toEqual(['device.pairing_created']);
  });

  it('refuses a manager or a cashier (403), another store’s branch (404) and no sign-in (401)', async () => {
    const s = await store();
    const other = await store('0922222222');
    const manager = await staff(s, 'manager', '0933333333');
    const cashier = await staff(s, 'cashier', '0944444444');
    for (const token of [manager, cashier]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/devices/pairing-codes',
        headers: bearer(token),
        payload: { branchId: s.branchId },
      });
      expect(res.statusCode).toBe(403);
    }
    const foreign = await app.inject({
      method: 'POST',
      url: '/v1/devices/pairing-codes',
      headers: bearer(s.accessToken),
      payload: { branchId: other.branchId },
    });
    expect(foreign.statusCode).toBe(404);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/devices/pairing-codes',
      payload: { branchId: s.branchId },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('POST /v1/devices/activate with a typed code or a QR', () => {
  it('links a device waiting for approval: no code, no token, its poll secret kept only as a hash', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    // Typed with a dash, in lower case and with Arabic digits where it has digits.
    const typed = `${pairing.manualCode.slice(0, 4)}-${pairing.manualCode.slice(4)}`
      .toLowerCase()
      .replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
    const res = await typeCode(pairing, typed);
    expect(res.statusCode, res.body).toBe(202);
    const body = res.json<PendingActivation>();
    expect(body).toMatchObject({
      status: 'pending_approval',
      storeName: 'متجر أحمد الخطيب',
      branchName: 'الفرع الرئيسي',
      deviceName: 'كاشير 1',
      expiresAt: '2026-10-30T09:30:00.000Z',
      pollAfterSeconds: 5,
    });
    expect(body.activationSecret).toMatch(/^sda_[A-Za-z0-9_-]{43}$/);

    const [device] = await ownerDb()`select * from devices where id = ${body.activationId}`;
    expect(device).toMatchObject({
      status: 'pending_approval',
      code: null,
      token_hash: null,
      kind: 'cashier',
    });
    expect(JSON.stringify(device)).not.toContain(body.activationSecret);
    const [used] =
      await ownerDb()`select used_at, device_id from device_pairings where tenant_id = ${s.tenantId}`;
    expect(used).toMatchObject({ device_id: body.activationId });
    expect(used!.used_at).not.toBeNull();

    // One pairing, one device.
    const again = await typeCode(pairing, pairing.manualCode, 'كاشير 2');
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('otp_invalid');
    expect(await auditActions(s.tenantId)).toEqual(['device.pairing_created', 'device.link_requested']);
  });

  it('links with the scanned QR token too', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    const res = await activate({
      method: 'qr',
      qrToken: parsePairingQr(pairing.qrPayload),
      ...deviceFields(),
    });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ status: 'pending_approval', branchName: 'الفرع الرئيسي' });
  });

  it('refuses a code or a QR after its 10 minutes', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    clock.advance(10 * 60_000);
    const byCode = await typeCode(pairing);
    expect(byCode.statusCode).toBe(400);
    expect(byCode.json().error).toMatchObject({
      code: 'otp_invalid',
      message: expect.stringContaining('انتهت'),
    });
    const byQr = await activate({ method: 'qr', qrToken: pairing.qrToken, ...deviceFields() });
    expect(byQr.statusCode).toBe(400);
    expect(await ownerDb()`select id from devices where tenant_id = ${s.tenantId}`).toEqual([]);
  });

  it('kills a pairing after 5 wrong codes: even the right code is refused then', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    const wrong = pairing.manualCode.startsWith('2') ? '3333-3333' : '2222-2222';
    for (let i = 0; i < 5; i++) {
      const res = await typeCode(pairing, wrong);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: 'otp_invalid',
        fields: { manualCode: expect.any(String) },
      });
    }
    const [row] = await ownerDb()<{ attempts: number }[]>`select attempts from device_pairings`;
    expect(row!.attempts).toBe(5);
    const right = await typeCode(pairing);
    expect(right.statusCode).toBe(429);
    expect(right.json().error.code).toBe('locked');
    expect(await ownerDb()`select id from devices`).toEqual([]);
    expect((await auditActions(s.tenantId)).filter((a) => a === 'device.link_wrong_code')).toHaveLength(5);
  });

  it('answers an unknown store code, an unknown QR and a suspended store exactly like a wrong code', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    const unknownStore = pairing.storeCode === '000000' ? '000001' : '000000';
    const answers = [
      await activate({
        method: 'code',
        storeCode: unknownStore,
        manualCode: pairing.manualCode,
        ...deviceFields(),
      }),
      await activate({ method: 'qr', qrToken: `spq_${'A'.repeat(22)}`, ...deviceFields() }),
    ];
    await ownerDb()`update tenants set status = 'suspended' where id = ${s.tenantId}`;
    answers.push(
      await typeCode(pairing),
      await activate({ method: 'qr', qrToken: pairing.qrToken, ...deviceFields() }),
    );
    for (const res of answers) {
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('otp_invalid');
    }
    // Nothing was counted against the store's pairing by guesses at another store.
    const [row] = await ownerDb()<{ attempts: number }[]>`select attempts from device_pairings`;
    expect(row!.attempts).toBe(0);
  });

  it('refuses a malformed request (validation) before anything else', async () => {
    const s = await store();
    const pairing = await pairingCode(s);
    for (const payload of [
      { method: 'code', storeCode: pairing.storeCode, manualCode: 'ABC', ...deviceFields() },
      { method: 'code', storeCode: '12', manualCode: pairing.manualCode, ...deviceFields() },
      { method: 'qr', qrToken: 'nope', ...deviceFields() },
      {
        method: 'code',
        storeCode: pairing.storeCode,
        manualCode: pairing.manualCode,
        ...deviceFields(),
        publicKey: 'x',
      },
      {
        method: 'code',
        storeCode: pairing.storeCode,
        manualCode: pairing.manualCode,
        ...deviceFields(),
        kind: 'hub',
      },
      { method: 'magic' },
    ]) {
      expect((await activate(payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const [row] = await ownerDb()<{ attempts: number }[]>`select attempts from device_pairings`;
    expect(row!.attempts).toBe(0);
  });

  it('is limited per address and per store code', async () => {
    const limited = await makeApp({ ACTIVATE_RATE_LIMIT_PER_MINUTE: '2' }, { clock });
    const perStore = await makeApp({ ACTIVATE_STORE_LIMIT_PER_HOUR: '2' }, { clock });
    try {
      const s = await store();
      const pairing = await pairingCode(s);
      const send = (target: FastifyInstance) =>
        target.inject({
          method: 'POST',
          url: '/v1/devices/activate',
          payload: { method: 'qr', qrToken: `spq_${'B'.repeat(22)}`, ...deviceFields() },
        });
      expect((await send(limited)).statusCode).toBe(400);
      expect((await send(limited)).statusCode).toBe(400);
      const third = await send(limited);
      expect(third.statusCode).toBe(429);
      expect(third.headers['retry-after']).toBeDefined();

      const typed = () =>
        perStore.inject({
          method: 'POST',
          url: '/v1/devices/activate',
          payload: {
            method: 'code',
            storeCode: pairing.storeCode,
            manualCode: '2222-3333',
            ...deviceFields(),
          },
        });
      await typed();
      await typed();
      expect((await typed()).statusCode).toBe(429);
    } finally {
      await limited.close();
      await perStore.close();
    }
  });
});

describe('waiting for approval: GET /v1/devices/activations/{id}', () => {
  it('waits, then gives the device its token once (only its hash is kept), and 410 after that', async () => {
    const s = await store();
    const activation = await pending(s);
    expect((await poll(activation)).json()).toEqual({
      status: 'pending_approval',
      expiresAt: '2026-10-30T09:30:00.000Z',
      pollAfterSeconds: 5,
    });

    const approved = await act(s, activation.activationId, 'approve');
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<DeviceSummary>()).toMatchObject({ status: 'active', code: '001' });

    const first = await poll(activation);
    expect(first.statusCode).toBe(200);
    const { device } = first.json<{ status: 'active'; device: ActivatedDevice }>();
    expect(device).toEqual({
      deviceId: activation.activationId,
      token: expect.stringMatching(/^sdt_[A-Za-z0-9_-]{43}$/),
      deviceCode: '001',
      tenantId: s.tenantId,
      storeName: 'متجر أحمد الخطيب',
      branchId: s.branchId,
      branchCode: '001',
      branchName: 'الفرع الرئيسي',
      deviceName: 'كاشير 1',
      serverEpoch: 1,
    });
    const again = await poll(activation);
    expect(again.statusCode).toBe(410);
    expect(JSON.stringify(await ownerDb()`select * from devices`)).not.toContain(device.token);

    // The token works for the device routes.
    const pull = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: `Device ${device.token}` },
    });
    expect(pull.statusCode).toBe(200);
    expect(await auditActions(s.tenantId)).toEqual([
      'device.pairing_created',
      'device.link_requested',
      'device.approved',
      'device.token_issued',
    ]);
  });

  it('gives the token to only one of two polls arriving together', async () => {
    const s = await store();
    const activation = await pending(s);
    await act(s, activation.activationId, 'approve');
    const answers = await Promise.all([poll(activation), poll(activation), poll(activation)]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 410, 410]);
  });

  it('a rejected device hears it, and cannot be approved afterwards', async () => {
    const s = await store();
    const activation = await pending(s);
    const rejected = await act(s, activation.activationId, 'reject');
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', code: null });
    expect((await poll(activation)).json()).toEqual({ status: 'rejected' });
    expect((await act(s, activation.activationId, 'approve')).statusCode).toBe(409);
    expect((await act(s, activation.activationId, 'reject')).statusCode).toBe(409);
    expect(await list(s.accessToken)).toEqual([]);
  });

  it('a request nobody answered expires: the device hears it and the owner can no longer approve it', async () => {
    const s = await store();
    const activation = await pending(s);
    clock.advance(30 * 60_000);
    expect((await poll(activation)).json()).toEqual({ status: 'expired' });
    // The owner signs in again (his access token lasts 15 minutes).
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0911111111', password: 'secret-pass-1' },
    });
    const fresh = { ...s, accessToken: login.json<{ accessToken: string }>().accessToken };
    const late = await act(fresh, activation.activationId, 'approve');
    expect(late.statusCode).toBe(409);
    expect(await list(fresh.accessToken)).toEqual([]);
    const [row] = await ownerDb()<{ code: string | null }[]>`select code from devices`;
    expect(row!.code).toBeNull();
  });

  it('refuses a wrong secret, or a right secret with another id', async () => {
    const s = await store();
    const a = await pending(s, 'كاشير 1');
    const b = await pending(s, 'كاشير 2');
    for (const attempt of [
      { activationId: a.activationId, activationSecret: b.activationSecret },
      { activationId: a.activationId, activationSecret: `sda_${'x'.repeat(43)}` },
      { activationId: 'not-a-uuid', activationSecret: a.activationSecret },
    ]) {
      expect((await poll(attempt)).statusCode).toBe(401);
    }
  });
});

describe('the owner signs in on the device (method owner)', () => {
  it('is active at once with its code and token, without approval', async () => {
    const s = await store();
    const device = await activateDevice(app, s.accessToken, s.branchId, 'كاشير المالك');
    expect(device.activated).toMatchObject({
      deviceCode: '001',
      branchCode: '001',
      deviceName: 'كاشير المالك',
    });
    expect((await list(s.accessToken)).map((d) => [d.name, d.status, d.code])).toEqual([
      ['كاشير المالك', 'active', '001'],
    ]);
    expect(await auditActions(s.tenantId)).toEqual(['device.activated']);
  });

  it('needs the owner’s token and permission, and a branch of the store', async () => {
    const s = await store();
    const other = await store('0922222222');
    const manager = await staff(s, 'manager', '0933333333');
    const payload = { method: 'owner', branchId: s.branchId, ...deviceFields() };
    expect((await activate(payload)).statusCode).toBe(401);
    expect((await activate(payload, bearer('forged'))).statusCode).toBe(401);
    expect((await activate(payload, bearer(manager))).statusCode).toBe(403);
    expect((await activate({ ...payload, branchId: other.branchId }, bearer(s.accessToken))).statusCode).toBe(
      404,
    );
    expect(await ownerDb()`select id from devices`).toEqual([]);
  });
});

describe('device codes', () => {
  it('takes the next code of the branch at approval, never reuses one after a revoke, and counts per branch', async () => {
    const s = await store();
    const first = await linkDevice(app, s.accessToken, s.branchId, 'كاشير 1');
    const waiting = await pending(s, 'كاشير 2');
    const second = await activateDevice(app, s.accessToken, s.branchId, 'كاشير 3');
    expect([first.code, second.code]).toEqual(['001', '002']);
    expect((await act(s, first.deviceId, 'revoke')).statusCode).toBe(200);
    const approved = await act(s, waiting.activationId, 'approve');
    expect(approved.json()).toMatchObject({ code: '003' });

    const branch2 = await secondBranch(s);
    const elsewhere = await activateDevice(app, s.accessToken, branch2, 'كاشير الفرع 2');
    expect(elsewhere.activated).toMatchObject({
      deviceCode: '001',
      branchCode: '002',
      branchName: 'فرع المزة',
    });
  });

  it('refuses when the branch has used all 999 codes (000 is the server’s)', async () => {
    const s = await store();
    await createDevice(s.tenantId, { code: '999' });
    const waiting = await pending(s);
    const res = await act(s, waiting.activationId, 'approve');
    expect(res.statusCode).toBe(409);
    expect((await poll(waiting)).json()).toMatchObject({ status: 'pending_approval' });
  });
});

describe('GET /v1/devices', () => {
  it('lists waiting devices first, with branch, last contact and what has not arrived', async () => {
    const s = await store();
    const active = await activateDevice(app, s.accessToken, s.branchId, 'كاشير 1');
    const waiting = await pending(s, 'كاشير جديد');
    const rejected = await pending(s, 'جهاز غريب');
    await act(s, rejected.activationId, 'reject');

    const devices = await list(s.accessToken);
    expect(devices.map((d) => [d.name, d.status, d.code, d.branchName])).toEqual([
      ['كاشير جديد', 'pending_approval', null, 'الفرع الرئيسي'],
      ['كاشير 1', 'active', '001', 'الفرع الرئيسي'],
    ]);
    expect(devices[0]).toMatchObject({ id: waiting.activationId, missingDocuments: null, lastSeenAt: null });
    expect(devices[1]).toMatchObject({
      id: active.deviceId,
      kind: 'cashier',
      platform: 'browser',
      appVersion: '1.0.0',
      missingDocuments: null,
      unsentCount: null,
      revokedAt: null,
      version: 1,
    });
  });

  it('counts the announced numbers that never arrived, less an approved loss', async () => {
    const s = await store();
    const device = await activateDevice(app, s.accessToken, s.branchId);
    const heartbeat = await app.inject({
      method: 'POST',
      url: '/v1/sync/heartbeat',
      headers: { authorization: device.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1.1.0',
        sentAt: '2026-10-30T09:00:02.000Z',
        lastIssued: { INV: 5, SRT: 2 },
        unsentCount: 4,
        storageUsedBytes: 5_000_000,
      },
    });
    expect(heartbeat.statusCode, heartbeat.body).toBe(200);
    expect((await list(s.accessToken))[0]).toMatchObject({
      missingDocuments: 7,
      unsentCount: 4,
      appVersion: '1.1.0',
      clockOffsetMs: 2000,
      lastSeenAt: '2026-10-30T09:00:00.000Z',
    });

    // Three sales arrive, and the owner approves the loss of INV 5.
    await pushSales(device, [1, 2, 3]);
    await ownerDb()`
      insert into number_gaps (tenant_id, device_id, series, from_seq, to_seq, reason, approved_at)
      values (${s.tenantId}, ${device.deviceId}, 'INV', 5, 9, 'جهاز تلف', now())`;
    expect((await list(s.accessToken))[0]!.missingDocuments).toBe(3);
  });

  it('shows a manager the devices of his branches only, and refuses a cashier', async () => {
    const s = await store();
    const branch2 = await secondBranch(s);
    await activateDevice(app, s.accessToken, s.branchId, 'كاشير الرئيسي');
    await activateDevice(app, s.accessToken, branch2, 'كاشير المزة');
    const everywhere = await staff(s, 'manager', '0933333333');
    const mazzeh = await staff(s, 'manager', '0955555555', branch2);
    const cashier = await staff(s, 'cashier', '0944444444');
    expect((await list(everywhere)).map((d) => d.name)).toEqual(['كاشير الرئيسي', 'كاشير المزة']);
    expect((await list(mazzeh)).map((d) => d.name)).toEqual(['كاشير المزة']);
    const refused = await app.inject({ method: 'GET', url: '/v1/devices', headers: bearer(cashier) });
    expect(refused.statusCode).toBe(403);
    // A manager sees, the owner acts.
    const [device] = await list(everywhere);
    expect((await act(s, device!.id, 'revoke', everywhere)).statusCode).toBe(403);
  });
});

async function pushSales(device: { code: string; authorization: string }, numbers: number[]) {
  const { createUuidV7, formatDocNumber, payloadHash } = await import('@serva/sync');
  const newId = createUuidV7();
  const documents = numbers.map((n) => {
    const body = {
      id: newId(),
      seq: n,
      type: 'sale' as const,
      number: formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: device.code, sequence: n }),
      deviceTime: '2026-10-30T08:59:00.000Z',
      businessDate: '2026-10-30',
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload: { total: 100 },
    };
    return { ...body, hash: payloadHash(body) };
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: { authorization: device.authorization },
    payload: { contractVersion: 1, appVersion: '1.0.0', sentAt: '2026-10-30T09:00:00.000Z', documents },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ results: Array<{ status: string; code?: string }>; commands: Record<string, unknown> }>();
}

describe('PATCH /v1/devices/{id}', () => {
  it('renames with the version it read, and refuses a stale version', async () => {
    const s = await store();
    const device = await activateDevice(app, s.accessToken, s.branchId);
    const rename = (name: string, version: number) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/devices/${device.deviceId}`,
        headers: bearer(s.accessToken),
        payload: { name, version },
      });
    const ok = await rename('  كاشير الواجهة ', 1);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'كاشير الواجهة', version: 2 });
    expect((await rename('اسم آخر', 1)).statusCode).toBe(409);
    expect((await rename('', 2)).statusCode).toBe(400);
    expect((await rename('x'.repeat(41), 2)).statusCode).toBe(400);
    const [log] = await ownerDb()<{ changes: unknown }[]>`
      select changes from audit_logs where action = 'device.renamed'`;
    expect(log!.changes).toEqual({ name: ['كاشير 1', 'كاشير الواجهة'] });
    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/not-a-uuid',
      headers: bearer(s.accessToken),
      payload: { name: 'x', version: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /v1/devices/{id}/revoke', () => {
  it('stops the device: what it numbered up to its heartbeat is accepted, the rest quarantined, then wipe', async () => {
    const s = await store();
    const device = await linkDevice(app, s.accessToken, s.branchId);
    const beat = (lastIssued: Record<string, number>) =>
      app.inject({
        method: 'POST',
        url: '/v1/sync/heartbeat',
        headers: { authorization: device.authorization },
        payload: {
          contractVersion: 1,
          appVersion: '1',
          sentAt: '2026-10-30T09:00:00.000Z',
          lastIssued,
          unsentCount: 2,
        },
      });
    expect((await beat({ INV: 2 })).json().commands).toEqual({});

    const revoked = await act(s, device.deviceId, 'revoke');
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ status: 'revoked', revokedAt: '2026-10-30T09:00:00.000Z' });
    // It can no longer read the store …
    for (const url of ['/v1/sync/pull', '/v1/sync/bootstrap']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: device.authorization } });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('device_revoked');
    }
    // … its heartbeat no longer moves its cut-off, and tells it to wipe …
    const late = await beat({ INV: 50 });
    expect(late.statusCode).toBe(200);
    expect(late.json().commands).toEqual({ wipe: true });
    // … and what it still sends is sorted by the number it announced before the revoke.
    const pushed = await pushSales(device, [1, 2, 3]);
    expect(pushed.results.map((r) => [r.status, r.code])).toEqual([
      ['accepted', undefined],
      ['accepted', undefined],
      ['quarantined', 'after_revocation'],
    ]);
    expect(pushed.commands).toEqual({ wipe: true });

    expect((await act(s, device.deviceId, 'revoke')).statusCode).toBe(409);
    const [log] = await ownerDb()<
      { data: unknown }[]
    >`select data from audit_logs where action = 'device.revoked'`;
    expect(log!.data).toEqual({ lastAnnounced: { INV: 2 } });
  });

  it('a waiting device is rejected, not revoked', async () => {
    const s = await store();
    const waiting = await pending(s);
    expect((await act(s, waiting.activationId, 'revoke')).statusCode).toBe(409);
  });
});
