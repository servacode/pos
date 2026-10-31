import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUuidV7, parseSnapshot, payloadHash, type SyncDocumentBody } from '@serva/sync';
import { createDevice, deviceFields, firstBranch } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * Every route is classified here. A new route fails this file until it is: public routes are
 * listed on purpose, signed-in routes must refuse a missing token, and any route that takes an id
 * must get an IDOR case below (another store's id must answer 404), per 17 «الصلاحية في الخادم».
 * Device routes take no id: the store comes from the device token alone, and each gets a probe
 * that another store's device can neither see nor touch this store's data.
 */
const ROUTES: Record<string, 'public' | 'signed-in' | 'device' | 'activation'> = {
  'GET /health': 'public',
  'GET /v1/meta': 'public',
  'POST /v1/auth/register': 'public',
  'POST /v1/auth/register/verify': 'public',
  'POST /v1/auth/login': 'public',
  'POST /v1/auth/refresh': 'public',
  'POST /v1/auth/logout': 'public',
  'GET /v1/me': 'signed-in',
  'POST /v1/sync/push': 'device',
  'GET /v1/sync/pull': 'device',
  'POST /v1/sync/resync': 'device',
  'POST /v1/sync/heartbeat': 'device',
  'GET /v1/sync/bootstrap': 'device',
  'GET /v1/sync/snapshots/:id': 'device',
  'POST /v1/devices/pairing-codes': 'signed-in',
  // The pairing code is the proof (rate limited); the owner method needs a Bearer token.
  'POST /v1/devices/activate': 'public',
  // A waiting device: `Authorization: Activation <secret>`
  'GET /v1/devices/activations/:id': 'activation',
  'GET /v1/devices': 'signed-in',
  'PATCH /v1/devices/:id': 'signed-in',
  'POST /v1/devices/:id/approve': 'signed-in',
  'POST /v1/devices/:id/reject': 'signed-in',
  'POST /v1/devices/:id/revoke': 'signed-in',
};

interface Stores {
  a: { tenantId: string; accessToken: string };
  b: { tenantId: string; accessToken: string };
}

const owner = (store: { accessToken: string }) => ({ authorization: `Bearer ${store.accessToken}` });

/** A device of store A waiting for approval, linked with a typed code. */
async function pendingDevice(app: FastifyInstance, a: Stores['a']) {
  const pairing = await app.inject({
    method: 'POST',
    url: '/v1/devices/pairing-codes',
    headers: owner(a),
    payload: { branchId: await firstBranch(a.tenantId) },
  });
  const { storeCode, manualCode } = pairing.json<{ storeCode: string; manualCode: string }>();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices/activate',
    payload: { method: 'code', storeCode, manualCode, ...deviceFields() },
  });
  return res.json<{ activationId: string; activationSecret: string }>();
}

const deviceRow = async (id: string) =>
  (
    await ownerDb()<{ name: string; status: string; version: number }[]>`
      select name, status, version from devices where id = ${id}`
  )[0];

/** Store B's owner acting on store A's device: 404, and the device is untouched. */
function deviceIdor(path: (id: string) => string, method: 'PATCH' | 'POST') {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    for (const target of [
      await createDevice(a.tenantId),
      { deviceId: (await pendingDevice(app, a)).activationId },
    ]) {
      const before = await deviceRow(target.deviceId);
      const res = await app.inject({
        method,
        url: path(target.deviceId),
        headers: owner(b),
        ...(method === 'PATCH' ? { payload: { name: 'مسروق', version: before!.version } } : {}),
      });
      expect(res.statusCode, `${method} ${path(':id')}`).toBe(404);
      expect(await deviceRow(target.deviceId)).toEqual(before);
    }
  };
}

/** Routes with an id in the path, each with a probe using another store's record. */
const IDOR_PROBES: Record<string, (app: FastifyInstance, stores: Stores) => Promise<void>> = {
  'PATCH /v1/devices/:id': deviceIdor((id) => `/v1/devices/${id}`, 'PATCH'),
  'POST /v1/devices/:id/approve': deviceIdor((id) => `/v1/devices/${id}/approve`, 'POST'),
  'POST /v1/devices/:id/reject': deviceIdor((id) => `/v1/devices/${id}/reject`, 'POST'),
  'POST /v1/devices/:id/revoke': deviceIdor((id) => `/v1/devices/${id}/revoke`, 'POST'),
  // The poll secret of a device of store B never reads store A's waiting device.
  'GET /v1/devices/activations/:id': async (app, { a, b }) => {
    const deviceA = await pendingDevice(app, a);
    const deviceB = await pendingDevice(app, b);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/devices/activations/${deviceA.activationId}`,
      headers: { authorization: `Activation ${deviceB.activationSecret}` },
    });
    expect(res.statusCode).toBe(401);
  },
  'GET /v1/sync/snapshots/:id': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const boot = await app.inject({
      method: 'GET',
      url: '/v1/sync/bootstrap',
      headers: { authorization: deviceA.authorization },
    });
    const res = await app.inject({
      method: 'GET',
      url: boot.json<{ url: string }>().url,
      headers: { authorization: deviceB.authorization },
    });
    expect(res.statusCode).toBe(404);
  },
};

/** Device routes: store B's device acting on store A's ids gets nothing of store A. */
const DEVICE_SCOPE_PROBES: Record<string, (app: FastifyInstance, stores: Stores) => Promise<void>> = {
  'POST /v1/sync/push': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const body: SyncDocumentBody = {
      id: createUuidV7()(),
      seq: 1,
      type: 'customer',
      number: null,
      deviceTime: '2026-10-30T09:00:00.000Z',
      businessDate: '2026-10-30',
      deviceOffsetMs: 0,
      engineVersion: '1',
      contractVersion: 1,
      deps: [],
      payload: { name: 'A' },
    };
    const send = (authorization: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: { authorization },
        payload: {
          contractVersion: 1,
          appVersion: '1',
          sentAt: '2026-10-30T09:00:00.000Z',
          documents: [{ ...body, payload, hash: payloadHash({ ...body, payload }) }],
        },
      });
    expect((await send(deviceA.authorization, { name: 'A' })).json().results[0].status).toBe('accepted');
    // Same id from store B: a document of store B, never a conflict with (or a read of) store A's.
    const fromB = await send(deviceB.authorization, { name: 'B' });
    expect(fromB.json().results[0].status).toBe('accepted');
    const rows = await ownerDb()<{ tenant_id: string; device_id: string }[]>`
      select tenant_id, device_id from sync_inbox where doc_id = ${body.id} order by tenant_id = ${a.tenantId} desc`;
    expect(rows).toEqual([
      { tenant_id: a.tenantId, device_id: deviceA.deviceId },
      { tenant_id: b.tenantId, device_id: deviceB.deviceId },
    ]);
  },
  'GET /v1/sync/pull': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: deviceB.authorization },
    });
    const text = res.body;
    expect(res.json().sets.settings.upserts.map((s: { id: string }) => s.id)).toEqual([b.tenantId]);
    expect(text).not.toContain(a.tenantId);
    const [userA] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    expect(text).not.toContain(userA!.id);
  },
  'POST /v1/sync/resync': async (app, { b }) => {
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/resync',
      headers: { authorization: deviceB.authorization },
      payload: { sets: ['users'] },
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().sets)).toEqual(['users']);
  },
  'POST /v1/sync/heartbeat': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/heartbeat',
      headers: { authorization: deviceB.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1',
        sentAt: '2026-10-30T09:00:00.000Z',
        lastIssued: { INV: 5 },
        unsentCount: 7,
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ownerDb()<{ device_id: string }[]>`select device_id from doc_sequences`;
    expect(rows.map((r) => r.device_id)).toEqual([deviceB.deviceId]);
    const [rowA] = await ownerDb()<{ unsent_count: number | null }[]>`
      select unsent_count from devices where id = ${deviceA.deviceId}`;
    expect(rowA!.unsent_count).toBeNull();
  },
  'GET /v1/sync/bootstrap': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const boot = await app.inject({
      method: 'GET',
      url: '/v1/sync/bootstrap',
      headers: { authorization: deviceB.authorization },
    });
    const file = await app.inject({
      method: 'GET',
      url: boot.json<{ url: string }>().url,
      headers: { authorization: deviceB.authorization },
    });
    const text = gunzipSync(file.rawPayload).toString('utf8');
    expect(parseSnapshot(text).sets.settings!.map((s) => s.id)).toEqual([b.tenantId]);
    expect(text).not.toContain(a.tenantId);
  },
  'GET /v1/sync/snapshots/:id': async (app, { a, b }) => {
    await IDOR_PROBES['GET /v1/sync/snapshots/:id']!(app, { a, b });
  },
};

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const registeredRoutes = () => [...app.routeList].sort();

async function twoStores(): Promise<Stores> {
  const a = (await registerStore(app, { phone: '0911111111' })).body;
  const b = (await registerStore(app, { phone: '0922222222' })).body;
  return {
    a: { tenantId: a.tenant.id as string, accessToken: a.accessToken as string },
    b: { tenantId: b.tenant.id as string, accessToken: b.accessToken as string },
  };
}

describe('route registry', () => {
  it('every route is classified', () => {
    expect(registeredRoutes()).toEqual(Object.keys(ROUTES).sort());
  });

  it('signed-in routes refuse a missing or forged token', async () => {
    for (const [route, access] of Object.entries(ROUTES)) {
      if (access !== 'signed-in') continue;
      const [method, url] = route.split(' ') as ['GET', string];
      for (const authorization of [undefined, 'Bearer forged']) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(res.statusCode, `${route} ${authorization ?? 'no token'}`).toBe(401);
      }
    }
  });

  it('device routes refuse a missing token, a forged one and a signed-in user’s token', async () => {
    const { body } = await registerStore(app);
    for (const [route, access] of Object.entries(ROUTES)) {
      if (access !== 'device') continue;
      const [method, url] = route.split(' ') as ['GET', string];
      for (const authorization of [undefined, `Device sdt_${'x'.repeat(43)}`, `Bearer ${body.accessToken}`]) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(res.statusCode, `${route} ${authorization ?? 'no token'}`).toBe(401);
      }
    }
  });

  it('every device route has a cross-store probe', () => {
    const deviceRoutes = Object.entries(ROUTES)
      .filter(([, access]) => access === 'device')
      .map(([route]) => route);
    expect(deviceRoutes.sort()).toEqual(Object.keys(DEVICE_SCOPE_PROBES).sort());
  });

  it('device scope probes: another store’s device sees and touches nothing of this store', async () => {
    const stores = await twoStores();
    for (const probe of Object.values(DEVICE_SCOPE_PROBES)) await probe(app, stores);
  });

  it('every route with an id in its path has an IDOR probe', () => {
    const withIds = registeredRoutes().filter((r) => r.includes(':'));
    expect(withIds.sort()).toEqual(Object.keys(IDOR_PROBES).sort());
  });

  it('IDOR probes: another store’s ids answer 404', async () => {
    const stores = await twoStores();
    for (const probe of Object.values(IDOR_PROBES)) await probe(app, stores);
  });

  it('the activation poll refuses a missing, malformed or unknown secret', async () => {
    for (const authorization of [
      undefined,
      'Activation nope',
      `Activation sda_${'x'.repeat(43)}`,
      'Bearer x',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/devices/activations/0192a000-0000-7000-8000-000000000001',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode, authorization ?? 'no secret').toBe(401);
    }
  });
});
