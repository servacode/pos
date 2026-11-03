import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { StoreResponse } from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * The store's settings and the start wizard (packages/core › contracts/store.ts; 04 › معالج
 * البداية): what the owner sets on the first day, read back by everyone, changed by the owner only.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

let store: TestStore;
beforeEach(async () => {
  await resetDatabase();
  store = await testStore(app);
});

const get = (token = store.accessToken) =>
  app.inject({ method: 'GET', url: '/v1/store', headers: bearer(token) });
const put = (path: string, payload: Record<string, unknown>, token = store.accessToken) =>
  app.inject({ method: 'PUT', url: `/v1/store/${path}`, headers: bearer(token), payload });

const profile = {
  name: 'سوبرماركت الفرات',
  sectors: ['supermarket', 'produce'],
  legalName: 'شركة الفرات للتجارة',
  taxNumber: '123-456',
  address: 'الرقة، شارع تل أبيض',
  phone: '0933123456',
  receiptFooter: 'شكراً لزيارتكم',
};

describe('the start wizard', () => {
  it('shows to a new store, at its first step', async () => {
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(store.accessToken) });
    expect(me.json().onboarding).toEqual({ step: 0, done: false });
    expect(me.json().user.permissions).toContain('settings.manage');
  });

  it('remembers the step, and does not show again once finished', async () => {
    expect((await put('onboarding', { step: 2 })).json<StoreResponse>().onboarding).toEqual({
      step: 2,
      done: false,
    });
    const done = await put('onboarding', { step: 4, done: true });
    expect(done.json<StoreResponse>().onboarding).toEqual({ step: 4, done: true });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(store.accessToken) });
    expect(me.json().onboarding).toEqual({ step: 4, done: true });
  });
});

describe('the store profile', () => {
  it('starts with the sign-up values and the defaults', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json<StoreResponse>()).toMatchObject({
      baseCurrency: 'SYP',
      taxInclusive: true,
      usdRate: null,
      onboarding: { step: 0, done: false },
    });
  });

  it('saves what the receipt shows: name, activity, legal name, tax number, address, phone, footer', async () => {
    const res = await put('profile', profile);
    expect(res.statusCode).toBe(200);
    expect(res.json<StoreResponse>()).toMatchObject({ ...profile, phone: '+963933123456' });
    // The name is the store's name everywhere, the address and phone the main branch's
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(store.accessToken) });
    expect(me.json().tenant).toMatchObject({ name: 'سوبرماركت الفرات', sectors: ['supermarket', 'produce'] });
    const [branch] = await ownerDb()<{ address: string; phone: string }[]>`
      select address, phone from branches where id = ${store.branchId}`;
    expect(branch).toEqual({ address: 'الرقة، شارع تل أبيض', phone: '+963933123456' });
  });

  it('clears an optional field sent empty, and keeps one left out', async () => {
    await put('profile', profile);
    const res = await put('profile', { name: 'الفرات', sectors: ['supermarket'], taxNumber: '' });
    expect(res.json<StoreResponse>()).toMatchObject({
      name: 'الفرات',
      taxNumber: null,
      legalName: 'شركة الفرات للتجارة',
    });
  });

  it('says in Arabic what is wrong, field by field', async () => {
    const res = await put('profile', { name: 'ا', sectors: [], phone: '12' });
    expect(res.statusCode).toBe(400);
    const fields = res.json().error.fields;
    expect(fields.name).toBe('اكتب اسم المحل كما يظهر على الفاتورة');
    expect(fields.sectors).toBe('اختر نشاطاً واحداً على الأقل');
    expect(fields.phone).toBeTruthy();
  });

  it('writes each change to the audit log, before and after', async () => {
    await put('profile', profile);
    const [entry] = await ownerDb()<{ changes: Record<string, [unknown, unknown]> }[]>`
      select changes from audit_logs where tenant_id = ${store.tenantId} and action = 'store.profile_update'`;
    expect(entry!.changes.name![1]).toBe('سوبرماركت الفرات');
  });
});

describe('currency and the dollar rate', () => {
  it('turns the dollar on with today’s rate, which reaches the tills', async () => {
    const res = await put('currency', { usdEnabled: true, usdRate: '130.50' });
    expect(res.statusCode).toBe(200);
    expect(res.json<StoreResponse>()).toMatchObject({ enabledCurrencies: ['SYP', 'USD'], usdRate: '130.5' });
    const rates = await ownerDb()<{ unit: string; quote: string; rate: string; created_by: string }[]>`
      select unit, quote, rate, created_by from exchange_rates where tenant_id = ${store.tenantId}`;
    expect(rates).toEqual([{ unit: 'USD', quote: 'SYP', rate: '130.5', created_by: store.userId }]);
  });

  it('adds a row only when the rate changes, so a sale keeps the rate it was made at', async () => {
    await put('currency', { usdEnabled: true, usdRate: '130' });
    await put('currency', { usdEnabled: true, usdRate: '130' });
    await put('currency', { usdEnabled: true, usdRate: '132' });
    const rates = await ownerDb()<{ rate: string }[]>`
      select rate from exchange_rates where tenant_id = ${store.tenantId} order by effective_at, id`;
    expect(rates.map((r) => r.rate)).toEqual(['130', '132']);
    expect((await get()).json<StoreResponse>().usdRate).toBe('132');
  });

  it('turns the dollar off, and asks for a rate when turning it on', async () => {
    await put('currency', { usdEnabled: true, usdRate: '130' });
    const off = await put('currency', { usdEnabled: false });
    expect(off.json<StoreResponse>()).toMatchObject({ enabledCurrencies: ['SYP'], usdRate: null });
    const noRate = await put('currency', { usdEnabled: true });
    expect(noRate.statusCode).toBe(400);
    expect(noRate.json().error.fields.usdRate).toBe('اكتب سعر الدولار اليوم');
    expect((await put('currency', { usdEnabled: true, usdRate: 'abc' })).statusCode).toBe(400);
    expect((await put('currency', { usdEnabled: true, usdRate: '0' })).statusCode).toBe(400);
  });

  it('sets whether shelf prices include tax', async () => {
    const res = await put('currency', { usdEnabled: false, taxInclusive: false });
    expect(res.json<StoreResponse>().taxInclusive).toBe(false);
  });
});

describe('who may change the store', () => {
  it('everyone signed in reads it; only the owner changes it', async () => {
    const manager = await staffUser(app, store, 'manager', '0944000001');
    const cashier = await staffUser(app, store, 'cashier', '0944000002');
    for (const who of [manager, cashier]) {
      expect((await get(who.accessToken)).statusCode).toBe(200);
      expect((await put('profile', profile, who.accessToken)).statusCode).toBe(403);
      expect((await put('currency', { usdEnabled: true, usdRate: '130' }, who.accessToken)).statusCode).toBe(
        403,
      );
      expect((await put('onboarding', { step: 1 }, who.accessToken)).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/store' })).statusCode).toBe(401);
  });

  it('another store is not reachable', async () => {
    const other = await testStore(app, '0955000000');
    await put('profile', { ...profile, name: 'محل آخر' }, other.accessToken);
    expect((await get()).json<StoreResponse>().name).not.toBe('محل آخر');
  });
});
