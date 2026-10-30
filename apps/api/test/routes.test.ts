import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeAppDb, makeApp, registerStore, resetDatabase } from './helpers';

/**
 * Every route is classified here. A new route fails this file until it is: public routes are
 * listed on purpose, signed-in routes must refuse a missing token, and any route that takes an id
 * must get an IDOR case below (another store's id must answer 404), per 17 «الصلاحية في الخادم».
 */
const ROUTES: Record<string, 'public' | 'signed-in'> = {
  'GET /health': 'public',
  'POST /v1/auth/register': 'public',
  'POST /v1/auth/register/verify': 'public',
  'POST /v1/auth/login': 'public',
  'POST /v1/auth/refresh': 'public',
  'POST /v1/auth/logout': 'public',
  'GET /v1/me': 'signed-in',
};

/** Routes with an id in the path, each with a probe using another store's record. None yet. */
const IDOR_PROBES: Record<string, (app: FastifyInstance) => Promise<void>> = {};

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
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
