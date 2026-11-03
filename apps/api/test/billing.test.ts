import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  PlatformLoginResponse,
  PlatformPayment,
  PlatformStore,
  SubscriptionInvoice,
  SubscriptionPage,
} from '@serva/core';
import { hashSecret } from '../src/auth/passwords';
import { openStore, type Store } from './accounting-fixtures';
import { sql } from 'drizzle-orm';
import { withTenant } from '@serva/db';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * The subscription and the platform panel (contracts/billing.ts; 07 › فوترة الاشتراكات): the
 * store opens an invoice and reports what it paid, keeps working 72 hours while it waits, and
 * the platform team confirms it, which moves the store onto its plan for the period.
 */

let app: FastifyInstance;
/** The instructions migration 0019 installs */
const DEFAULT_METHODS = ['shamcash', 'syriatel', 'transfer'].map((key) => ({
  key,
  label: key,
  account: 'يُضبط من لوحة المنصة',
  beneficiary: 'سيرفا',
  instructions: 'حوّل المبلغ واكتب رقم الفاتورة في الملاحظة.',
  enabled: true,
}));
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
  await ownerDb()`
    insert into plans (code, name, sort_order, limits, features, price_monthly_minor, price_yearly_minor)
    values ('basic', 'الأساسية', 1, '{}', '{}', 1000, 10000)
    on conflict (code) do update set price_monthly_minor = 1000, price_yearly_minor = 10000, is_active = true`;
  await ownerDb()`
    update platform_settings set syp_per_usd = 13000, payment_methods = ${ownerDb().json(DEFAULT_METHODS)}
    where id = 1`;
});

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function platformAdmin(role: 'super_admin' | 'support' = 'super_admin') {
  const email = `${role}@serva.test`;
  await ownerDb()`
    insert into platform_users (full_name, email, password_hash, role)
    values ('مدير المنصة', ${email}, ${await hashSecret('platform-pass-1')}, ${role})`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/platform/login',
    payload: { email, password: 'platform-pass-1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { authorization: `Bearer ${res.json<PlatformLoginResponse>().token}` };
}

async function invoiceFor(store: Store, cycle: 'monthly' | 'yearly' = 'monthly') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/subscription/invoices',
    headers: as(store),
    payload: { planCode: 'basic', billingCycle: cycle },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SubscriptionInvoice>();
}

const page = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/subscription', headers: as(store) })).json<SubscriptionPage>();

describe('the store’s subscription', () => {
  it('shows the trial, the paid plans with their prices, and how to pay', async () => {
    const store = await openStore(app);
    const p = await page(store);
    expect(p).toMatchObject({ status: 'trialing', planCode: 'free', sypPerUsd: '13000' });
    expect(p.plans.map((x) => [x.code, x.priceMonthlyMinor, x.priceYearlyMinor])).toEqual([
      ['basic', 1000, 10000],
    ]);
    expect(p.paymentMethods.map((m) => m.key)).toEqual(['shamcash', 'syriatel', 'transfer']);
  });

  it('opens one invoice per plan and cycle, priced in dollars and in pounds rounded up to 1,000', async () => {
    const store = await openStore(app);
    const a = await invoiceFor(store);
    expect(a).toMatchObject({
      planCode: 'basic',
      billingCycle: 'monthly',
      usdMinor: 1000,
      sypMinor: 13_000_000,
      status: 'open',
    });
    expect(a.number).toMatch(/^SUB-\d{4}-\d{6}$/);
    expect((await invoiceFor(store)).id).toBe(a.id);
    const yearly = await invoiceFor(store, 'yearly');
    expect(yearly).toMatchObject({ usdMinor: 10000, sypMinor: 130_000_000 });
  });

  it('reports a payment, keeps the store working 72 hours, and refuses a second one while it waits', async () => {
    const store = await openStore(app);
    const invoice = await invoiceFor(store);
    const body = {
      invoiceId: invoice.id,
      method: 'shamcash',
      transactionRef: 'SC-778899',
      amountMinor: 13_000_000,
      currency: 'SYP',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/payments',
      headers: as(store),
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending', transactionRef: 'SC-778899' });
    expect((await page(store)).graceEndsAt).not.toBeNull();
    const again = await app.inject({
      method: 'POST',
      url: '/v1/subscription/payments',
      headers: as(store),
      payload: body,
    });
    expect(again.statusCode).toBe(409);
  });

  it('is the owner’s alone, and a store cannot write its own subscription', async () => {
    const store = await openStore(app);
    const cashier = await staffUser(
      app,
      { ...store, branchId: store.device.branchId },
      'cashier',
      '0944000003',
    );
    expect(
      (await app.inject({ method: 'GET', url: '/v1/subscription', headers: as(cashier) })).statusCode,
    ).toBe(403);
    await expect(
      withTenant(appDb().db, store.tenantId, (tx) =>
        tx.execute(sql`update subscriptions set status = 'active'`),
      ),
    ).rejects.toThrow();
  });
});

describe('the platform panel', () => {
  it('signs in with its own realm: a store token never opens it, nor a wrong password', async () => {
    const store = await openStore(app);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/platform/stores', headers: as(store) })).statusCode,
    ).toBe(401);
    await platformAdmin();
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/platform/login',
      payload: { email: 'super_admin@serva.test', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('lists the stores, confirms a payment, and the store is on its plan for a month', async () => {
    const store = await openStore(app);
    const admin = await platformAdmin();
    const invoice = await invoiceFor(store);
    await app.inject({
      method: 'POST',
      url: '/v1/subscription/payments',
      headers: as(store),
      payload: {
        invoiceId: invoice.id,
        method: 'shamcash',
        transactionRef: 'SC-1',
        amountMinor: 13_000_000,
        currency: 'SYP',
      },
    });
    const stores = (await app.inject({ method: 'GET', url: '/v1/platform/stores', headers: admin })).json<{
      items: PlatformStore[];
    }>();
    expect(stores.items).toEqual([
      expect.objectContaining({ tenantId: store.tenantId, status: 'trialing', pendingPayments: 1 }),
    ]);
    const pending = (
      await app.inject({ method: 'GET', url: '/v1/platform/payments?status=pending', headers: admin })
    ).json<{ items: PlatformPayment[] }>();
    expect(pending.items).toEqual([
      expect.objectContaining({ invoiceNumber: invoice.number, transactionRef: 'SC-1' }),
    ]);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/platform/payments/${pending.items[0]!.id}/confirm`,
      headers: admin,
    });
    expect(ok.statusCode, ok.body).toBe(204);

    const after = await page(store);
    expect(after).toMatchObject({
      status: 'active',
      planCode: 'basic',
      billingCycle: 'monthly',
      graceEndsAt: null,
    });
    expect(after.invoices[0]!.status).toBe('paid');
    const days = (Date.parse(after.currentPeriodEnd!) - app.clock.now().getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThan(32);
    const [log] = await ownerDb()<{ action: string }[]>`select action from platform_audit_logs`;
    expect(log!.action).toBe('payment.confirm');
  });

  it('rejects a payment with its reason, which ends the 72 hours', async () => {
    const store = await openStore(app);
    const admin = await platformAdmin();
    const invoice = await invoiceFor(store);
    const paid = await app.inject({
      method: 'POST',
      url: '/v1/subscription/payments',
      headers: as(store),
      payload: {
        invoiceId: invoice.id,
        method: 'shamcash',
        transactionRef: 'SC-2',
        amountMinor: 1,
        currency: 'SYP',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/platform/payments/${paid.json<{ id: string }>().id}/reject`,
      headers: admin,
      payload: { reason: 'المبلغ ناقص' },
    });
    expect(res.statusCode, res.body).toBe(204);
    const after = await page(store);
    expect(after.payments[0]).toMatchObject({ status: 'rejected', reason: 'المبلغ ناقص' });
    expect(after.graceEndsAt).toBeNull();
  });

  it('edits plan prices and payment instructions (general manager only), and sets a store by hand', async () => {
    const store = await openStore(app);
    const admin = await platformAdmin();
    const support = await platformAdmin('support');
    const plan = {
      name: 'الأساسية',
      priceMonthlyMinor: 1200,
      priceYearlyMinor: 12000,
      trialDays: null,
      isActive: true,
    };
    expect(
      (await app.inject({ method: 'PUT', url: '/v1/platform/plans/basic', headers: support, payload: plan }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'PUT', url: '/v1/platform/plans/basic', headers: admin, payload: plan }))
        .statusCode,
    ).toBe(204);
    expect((await page(store)).plans[0]).toMatchObject({ priceMonthlyMinor: 1200 });

    const settings = {
      paymentMethods: [
        {
          key: 'shamcash',
          label: 'شام كاش',
          account: '0991234567',
          beneficiary: 'شركة سيرفا',
          instructions: 'حوّل واكتب رقم الفاتورة',
          enabled: true,
        },
      ],
      sypPerUsd: '13500',
    };
    expect(
      (await app.inject({ method: 'PUT', url: '/v1/platform/settings', headers: admin, payload: settings }))
        .statusCode,
    ).toBe(204);
    expect((await page(store)).paymentMethods).toEqual(settings.paymentMethods);

    const end = '2026-12-31T00:00:00.000Z';
    const set = await app.inject({
      method: 'PUT',
      url: `/v1/platform/stores/${store.tenantId}/subscription`,
      headers: admin,
      payload: { planCode: 'basic', status: 'active', currentPeriodEnd: end },
    });
    expect(set.statusCode, set.body).toBe(204);
    expect(await page(store)).toMatchObject({ status: 'active', planCode: 'basic', currentPeriodEnd: end });
  });
});
