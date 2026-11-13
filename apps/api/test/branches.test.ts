import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BranchAdminRow } from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/** The store's branches: add within the plan, rename, stop and restart (packages/core › contracts/branches.ts). */

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
  // The plans are shared by every test: start with no branch limit
  await ownerDb()`update plans set limits = limits - 'branches'`;
});
afterAll(async () => {
  await ownerDb()`update plans set limits = limits - 'branches'`;
});

const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });

describe('the store’s branches', () => {
  it('adds a branch with the next code, renames it, and lists them with their devices', async () => {
    const first = await call(s.accessToken, 'GET', '/v1/branches');
    expect(first.statusCode).toBe(200);
    const before = first.json<BranchAdminRow[]>();
    expect(before).toHaveLength(1);

    const made = await call(s.accessToken, 'POST', '/v1/branches', {
      name: 'فرع المزة',
      address: 'المزة - أوتوستراد',
      phone: '011 234 5678',
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<BranchAdminRow>()).toMatchObject({
      code: '002',
      name: 'فرع المزة',
      phone: '+96311' + '2345678',
      isActive: true,
      deviceCount: 0,
    });

    const id = made.json<BranchAdminRow>().id;
    const renamed = await call(s.accessToken, 'PATCH', `/v1/branches/${id}`, { name: 'فرع المالكي' });
    expect(renamed.json<BranchAdminRow>().name).toBe('فرع المالكي');
    expect(
      (await call(s.accessToken, 'GET', '/v1/branches')).json<BranchAdminRow[]>().map((b) => b.code),
    ).toEqual(['001', '002']);
    const logs = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${s.tenantId} and entity = 'branch' order by created_at`;
    expect(logs.map((l) => l.action)).toEqual(['branch.create', 'branch.update']);
  });

  it('stops and restarts a branch, never the last active one, and a stopped one frees its place in the plan', async () => {
    const made = (
      await call(s.accessToken, 'POST', '/v1/branches', { name: 'فرع ثانٍ' })
    ).json<BranchAdminRow>();
    const [main] = (await call(s.accessToken, 'GET', '/v1/branches')).json<BranchAdminRow[]>();

    const stopped = await call(s.accessToken, 'POST', `/v1/branches/${made.id}/active`, { active: false });
    expect(stopped.json<BranchAdminRow>().isActive).toBe(false);
    const last = await call(s.accessToken, 'POST', `/v1/branches/${main!.id}/active`, { active: false });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('conflict');

    await ownerDb()`
      update plans set limits = ${ownerDb().json({ branches: 1 })}
      where id = (select plan_id from subscriptions where tenant_id = ${s.tenantId})`;
    const over = await call(s.accessToken, 'POST', '/v1/branches', { name: 'فرع زائد' });
    expect(over.statusCode).toBe(403);
    expect(over.json().error.code).toBe('plan_limit_reached');
    const restart = await call(s.accessToken, 'POST', `/v1/branches/${made.id}/active`, { active: true });
    expect(restart.statusCode).toBe(403);
  });

  it('says what is wrong in Arabic and keeps branches to whoever manages the settings', async () => {
    const bad = await call(s.accessToken, 'POST', '/v1/branches', { name: 'ف', phone: '12' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.name).toBe('اكتب اسم الفرع');
    expect(bad.json().error.fields.phone).toContain('رقم الهاتف غير صحيح');
    const cashier = await staffUser(app, s, 'cashier', '0944000009');
    expect((await call(cashier.accessToken, 'GET', '/v1/branches')).statusCode).toBe(403);
    expect((await call(cashier.accessToken, 'POST', '/v1/branches', { name: 'فرع' })).statusCode).toBe(403);
  });
});
