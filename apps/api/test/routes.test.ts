import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUuidV7, payloadHash, type SyncDocumentBody } from '@serva/sync';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * Every route is classified here. A new route fails this file until it is: public routes are
 * listed on purpose, signed-in routes must refuse a missing token, and any route that takes an id
 * must get an IDOR case below (another store's id must answer 404), per 17 «الصلاحية في الخادم».
 * Device routes take no id: the store comes from the device token alone, and each gets a probe
 * that another store's device can neither see nor touch this store's data.
 */
const ROUTES: Record<string, 'public' | 'signed-in' | 'device'> = {
  'GET /health': 'public',
  'POST /v1/auth/register': 'public',
  'POST /v1/auth/register/verify': 'public',
  'POST /v1/auth/login': 'public',
  'POST /v1/auth/refresh': 'public',
  'POST /v1/auth/logout': 'public',
  'GET /v1/me': 'signed-in',
  'POST /v1/sync/push': 'device',
  'GET /v1/sync/pull': 'device',
  'POST /v1/sync/resync': 'device',
};

/** Routes with an id in the path, each with a probe using another store's record. None yet. */
const IDOR_PROBES: Record<string, (app: FastifyInstance) => Promise<void>> = {};

interface Stores {
  a: { tenantId: string };
  b: { tenantId: string };
}

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
    const a = (await registerStore(app, { phone: '0911111111' })).body;
    const b = (await registerStore(app, { phone: '0922222222' })).body;
    const stores = { a: { tenantId: a.tenant.id as string }, b: { tenantId: b.tenant.id as string } };
    for (const probe of Object.values(DEVICE_SCOPE_PROBES)) await probe(app, stores);
  });

  it('every route with an id in its path has an IDOR probe', () => {
    const withIds = registeredRoutes().filter((r) => r.includes(':'));
    expect(withIds.sort()).toEqual(Object.keys(IDOR_PROBES).sort());
  });

  it('IDOR probes: another store’s ids answer 404', async () => {
    await registerStore(app, { phone: '0911111111' });
    await registerStore(app, { phone: '0922222222' });
    for (const probe of Object.values(IDOR_PROBES)) await probe(app);
  });
});
