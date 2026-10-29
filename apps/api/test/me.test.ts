import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ALL_PERMISSIONS } from '@serva/core';
import { daysLeft } from '../src/services/me';
import { closeAppDb, makeApp, registerStore, resetDatabase } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(resetDatabase);

describe('GET /v1/me', () => {
  it('returns the new store with its free period, branch, settings and owner permissions', async () => {
    const { body } = await registerStore(app, { sectors: ['supermarket', 'cafe'], baseCurrency: 'USD' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.tenant).toMatchObject({ name: 'متجر الأمل', sectors: ['supermarket', 'cafe'], country: 'SY' });
    expect(me.settings).toEqual({
      baseCurrency: 'USD',
      enabledCurrencies: ['USD', 'SYP'],
      taxInclusive: true,
      numberFormat: 'latn',
    });
    expect(me.subscription).toMatchObject({ status: 'trialing', planName: 'الباقة المجانية', daysLeft: 14 });
    expect(me.branches).toEqual([{ id: expect.any(String), code: '01', name: 'الفرع الرئيسي' }]);
    expect(me.user.roles).toEqual([{ key: 'owner', name: 'المالك', branchId: null }]);
    expect(me.user.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('requires a valid access token', async () => {
    const missing = await app.inject({ method: 'GET', url: '/v1/me' });
    const forged = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    for (const res of [missing, forged]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    }
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  it('rounds partial days up and never goes below zero', () => {
    expect(daysLeft(new Date('2026-11-12T10:00:00Z'), now)).toBe(14);
    expect(daysLeft(new Date('2026-10-29T11:00:00Z'), now)).toBe(1);
    expect(daysLeft(new Date('2026-10-20T10:00:00Z'), now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe('GET /health', () => {
  it('reports the database as reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
