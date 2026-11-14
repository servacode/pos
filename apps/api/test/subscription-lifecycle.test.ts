import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  MeResponse,
  PlatformLoginResponse,
  PlatformPayment,
  PlatformStore,
  SubscriptionInvoice,
} from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock } from '../src/clock';
import { documents, openStore, push, shiftOpen, type Store } from './accounting-fixtures';
import { activateDevice, firstBranch } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * The subscription lifecycle is enforced (07 › دورة حياة الاشتراك): trial, then a grace of the
 * plan's days, then read-only. Nothing moves in the background; the state comes from the dates, so
 * these tests only set the dates relative to a fixed clock.
 */

const NOW = '2026-10-30T09:00:00.000Z';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clock = new ManualClock(NOW);
let app: FastifyInstance;
let off: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({}, { clock });
  off = await makeApp({ SUBSCRIPTION_ENFORCEMENT: 'false' }, { clock });
});
afterAll(async () => {
  // Plans are not reset between tests: leave no limit behind for other files
  await ownerDb()`update plans set limits = '{}'`;
  await app.close();
  await off.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase();
  await ownerDb()`
    insert into plans (code, name, sort_order, limits, features, price_monthly_minor, price_yearly_minor)
    values ('basic', 'الأساسية', 1, '{}', '{}', 1000, 10000)
    on conflict (code) do update set price_monthly_minor = 1000, price_yearly_minor = 10000, is_active = true`;
});

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const ago = (ms: number) => new Date(clock.now().getTime() - ms);
const ahead = (ms: number) => new Date(clock.now().getTime() + ms);

/** Sets the dates of the store's subscription (and status) directly, as time passing would. */
async function setDates(store: Store, over: { status?: string; end?: Date; grace?: Date | null }) {
  const end = over.end ?? ago(0);
  await ownerDb()`
    update subscriptions set status = ${over.status ?? 'active'}::subscription_status,
      trial_ends_at = ${over.status === 'trialing' ? end : null}, current_period_end = ${end},
      grace_ends_at = ${over.grace ?? null}
    where tenant_id = ${store.tenantId}`;
}

const newProduct = (store: Store, nameAr = 'صنف تجريبي', on = app) =>
  on.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: { nameAr, variants: [{ price: { currency: 'SYP', priceMinor: 1000 } }] },
  });
const me = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/me', headers: as(store) })).json<MeResponse>();

describe('the write gate', () => {
  it('lets a store in its trial work and says so in /v1/me', async () => {
    const store = await openStore(app);
    expect((await newProduct(store)).statusCode).toBe(201);
    expect((await me(store)).subscription).toMatchObject({ lifecycle: 'trialing', readOnly: false });
  });

  it('keeps selling through the grace days, with the days left in /v1/me', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(3 * DAY) });
    expect((await newProduct(store)).statusCode).toBe(201);
    expect((await me(store)).subscription).toMatchObject({
      lifecycle: 'grace',
      readOnly: false,
      graceDaysLeft: 4,
    });
  });

  it('the grace boundary is exact: 7 days to the millisecond still sells, one more does not', async () => {
    const store = await openStore(app);
    await setDates(store, { status: 'trialing', end: ago(7 * DAY) });
    expect((await newProduct(store)).statusCode).toBe(201);
    await setDates(store, { status: 'trialing', end: ago(7 * DAY + 1) });
    const refused = await newProduct(store);
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error.code).toBe('subscription_read_only');
    expect(refused.json().error.message).toMatch(/للقراءة والتصدير/);
  });

  it('read-only refuses writes but reads, /v1/me, the subscription page and paying keep working', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(10 * DAY) });
    const headers = as(store);

    expect((await newProduct(store)).statusCode).toBe(402);
    for (const [method, url, payload] of [
      ['PUT', '/v1/store/profile', { name: 'x' }],
      ['POST', '/v1/staff', { fullName: 'س', roleKey: 'cashier', branchIds: null, pin: '4829' }],
      ['POST', '/v1/customers', { name: 'ز' }],
    ] as const) {
      const res = await app.inject({ method, url, headers, payload });
      expect(res.statusCode, url).toBe(402);
    }
    for (const url of ['/v1/products', '/v1/me', '/v1/subscription', '/v1/staff']) {
      expect((await app.inject({ method: 'GET', url, headers })).statusCode, url).toBe(200);
    }
    expect((await me(store)).subscription).toMatchObject({ lifecycle: 'read_only', readOnly: true });
    const invoice = await app.inject({
      method: 'POST',
      url: '/v1/subscription/invoices',
      headers,
      payload: { planCode: 'basic', billingCycle: 'monthly' },
    });
    expect(invoice.statusCode, invoice.body).toBe(201);
  });

  it('a suspended subscription is read-only at once, even inside its period', async () => {
    const store = await openStore(app);
    await setDates(store, { status: 'suspended', end: ahead(20 * DAY) });
    expect((await newProduct(store)).statusCode).toBe(402);
  });

  it('SUBSCRIPTION_ENFORCEMENT=false switches the refusal off', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(30 * DAY) });
    expect((await newProduct(store, 'x', off)).statusCode).toBe(201);
  });

  it('the till routes that create things are refused too; its reads are not', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(10 * DAY) });
    const dev = { authorization: store.device.authorization };
    const hold = await app.inject({ method: 'POST', url: '/v1/device/holds', headers: dev, payload: {} });
    expect(hold.statusCode).toBe(402);
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull', headers: dev })).statusCode).toBe(200);
  });
});

describe('provisional activation after a reported payment', () => {
  async function platformAdmin() {
    await ownerDb()`
      insert into platform_users (full_name, email, password_hash, role)
      values ('مدير', 'boss@serva.test', ${await hashSecret('platform-pass-1')}, 'super_admin')`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/platform/login',
      payload: { email: 'boss@serva.test', password: 'platform-pass-1' },
    });
    return { authorization: `Bearer ${res.json<PlatformLoginResponse>().token}` };
  }
  async function report(store: Store) {
    const invoice = (
      await app.inject({
        method: 'POST',
        url: '/v1/subscription/invoices',
        headers: as(store),
        payload: { planCode: 'basic', billingCycle: 'monthly' },
      })
    ).json<SubscriptionInvoice>();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/payments',
      headers: as(store),
      payload: {
        invoiceId: invoice.id,
        method: 'shamcash',
        transactionRef: 'TX-100200',
        amountMinor: invoice.usdMinor,
        currency: 'USD',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const pending = async (admin: { authorization: string }) =>
    (await app.inject({ method: 'GET', url: '/v1/platform/payments?status=pending', headers: admin })).json<{
      items: PlatformPayment[];
    }>().items;

  it('turns the store back on for 72 hours, and a rejection turns it off at once', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(20 * DAY) });
    expect((await newProduct(store)).statusCode).toBe(402);
    await report(store);
    expect((await newProduct(store)).statusCode).toBe(201);
    expect((await me(store)).subscription).toMatchObject({ lifecycle: 'grace', readOnly: false });

    const admin = await platformAdmin();
    const [payment] = await pending(admin);
    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/platform/payments/${payment!.id}/reject`,
      headers: admin,
      payload: { reason: 'الرقم غير صحيح' },
    });
    expect(rejected.statusCode, rejected.body).toBe(204);
    expect((await newProduct(store)).statusCode).toBe(402);
  });

  it('72 hours pass: read-only again; a confirmed payment makes the store active', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(20 * DAY) });
    await report(store);
    await ownerDb()`update subscriptions set grace_ends_at = ${ago(1)} where tenant_id = ${store.tenantId}`;
    expect((await newProduct(store)).statusCode).toBe(402);

    await ownerDb()`update subscriptions set grace_ends_at = ${ahead(HOUR)} where tenant_id = ${store.tenantId}`;
    const admin = await platformAdmin();
    const [payment] = await pending(admin);
    await app.inject({ method: 'POST', url: `/v1/platform/payments/${payment!.id}/confirm`, headers: admin });
    expect((await newProduct(store)).statusCode).toBe(201);
    expect((await me(store)).subscription).toMatchObject({ lifecycle: 'active', readOnly: false });
  });

  it('the platform list shows what is true now, without any job moving statuses', async () => {
    const store = await openStore(app);
    await setDates(store, { end: ago(3 * DAY) });
    const admin = await platformAdmin();
    const list = async () =>
      (await app.inject({ method: 'GET', url: '/v1/platform/stores', headers: admin }))
        .json<{ items: PlatformStore[] }>()
        .items.find((s) => s.tenantId === store.tenantId)!;
    expect((await list()).status).toBe('past_due');
    await setDates(store, { end: ago(9 * DAY) });
    expect((await list()).status).toBe('suspended');
    await setDates(store, { end: ahead(DAY) });
    expect((await list()).status).toBe('active');
  });
});

/** The same document at an exact device instant (and clock offset), re-hashed. */
function redo(doc: SyncDocument, when: Date, offsetMs = 0): SyncDocument {
  const { hash: _hash, ...body } = doc;
  const next = {
    ...body,
    deviceTime: new Date(when.getTime() + offsetMs).toISOString(),
    deviceOffsetMs: offsetMs,
    businessDate: when.toISOString().slice(0, 10),
  };
  return { ...next, hash: payloadHash(next) };
}

describe('offline documents at the cut-off', () => {
  // Read-only since the end of the grace, one day ago: cut-off = now - 1 day
  const cutOff = () => ago(DAY);

  async function readOnlyStore() {
    const store = await openStore(app);
    await setDates(store, { end: ago(8 * DAY) });
    return store;
  }
  const docAt = (store: Store, when: Date, offsetMs = 0) => {
    const make = documents(store.device, when.toISOString().slice(0, 10));
    return redo(make('shift_open', shiftOpen(store.userId)), when, offsetMs);
  };

  it('takes a sale made before the cut-off, and up to 24 hours after it', async () => {
    const store = await readOnlyStore();
    const make = documents(store.device);
    const at = (when: Date) => redo(make('shift_open', shiftOpen(store.userId)), when);
    const res = await push(app, store.device, [
      at(new Date(cutOff().getTime() - 3 * HOUR)),
      at(new Date(cutOff().getTime() + 23 * HOUR)),
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
  });

  it('keeps, but does not post, what was made after the cut-off plus 24 hours (nothing is lost)', async () => {
    const store = await readOnlyStore();
    const doc = docAt(store, new Date(cutOff().getTime() + 25 * HOUR));
    const res = await push(app, store.device, [doc]);
    expect(res.results[0]).toMatchObject({ status: 'quarantined', code: 'subscription_read_only' });
    const [row] = await ownerDb()<{ status: string; processed_at: Date | null }[]>`
      select status, processed_at from sync_inbox where doc_id = ${doc.id}`;
    expect(row).toMatchObject({ status: 'quarantined', processed_at: null });
    const again = await push(app, store.device, [doc]);
    expect(again.results[0]).toMatchObject({ status: 'duplicate', outcome: 'quarantined' });
  });

  it('the announced clock offset counts: a fast clock that really was before the cut-off is taken', async () => {
    const store = await readOnlyStore();
    // The device reads 30 hours after the cut-off but runs 10 hours fast: really 20 hours after
    const when = new Date(cutOff().getTime() + 20 * HOUR);
    expect((await push(app, store.device, [docAt(store, when, 10 * HOUR)])).results[0]).toMatchObject({
      status: 'accepted',
    });
  });

  it('a store that sells takes any document', async () => {
    const store = await openStore(app);
    expect((await push(app, store.device, [docAt(store, clock.now())])).results[0]).toMatchObject({
      status: 'accepted',
    });
  });
});

describe('plan limits', () => {
  async function limit(store: Store, limits: Record<string, number>) {
    await ownerDb()`
      update plans set limits = ${ownerDb().json(limits)}
      where id = (select plan_id from subscriptions where tenant_id = ${store.tenantId})`;
  }
  const hire = (store: Store, pin = '4829') =>
    app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: as(store),
      payload: { fullName: 'سامر', roleKey: 'cashier', branchIds: null, pin },
    });

  it('refuses a new user over the limit, clearly, and leaves the rest alone', async () => {
    const store = await openStore(app);
    await limit(store, { users: 2 });
    const first = await hire(store);
    expect(first.statusCode, first.body).toBe(201);
    const second = await hire(store);
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('plan_limit_reached');
    expect(second.json().error.message).toMatch(/حدّها/);
    const [row] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from users where tenant_id = ${store.tenantId}`;
    expect(row!.n).toBe(2);
  });

  it('a downgrade below the current count deletes nothing; pausing is allowed, resuming is counted', async () => {
    const store = await openStore(app);
    const a = (await hire(store)).json<{ id: string }>();
    await limit(store, { users: 1 });
    expect((await hire(store, '4830')).statusCode).toBe(403);
    const pause = await app.inject({
      method: 'POST',
      url: `/v1/staff/${a.id}/deactivate`,
      headers: as(store),
    });
    expect(pause.statusCode, pause.body).toBe(200);
    const resume = await app.inject({
      method: 'POST',
      url: `/v1/staff/${a.id}/reactivate`,
      headers: as(store),
    });
    expect(resume.statusCode).toBe(403);
  });

  it('no limit (missing) means unlimited', async () => {
    const store = await openStore(app);
    await limit(store, {});
    for (let i = 0; i < 3; i++) expect((await hire(store, `48${20 + i}`)).statusCode).toBe(201);
  });

  it('refuses a device over the limit when the owner links one', async () => {
    const store = await openStore(app); // one active device already
    const branch = await firstBranch(store.tenantId);
    await limit(store, { registers: 1 });
    await expect(activateDevice(app, store.accessToken, branch, 'كاشير 2')).rejects.toThrow(/403/);
    await limit(store, { registers: 2 });
    expect((await activateDevice(app, store.accessToken, branch, 'كاشير 2')).deviceId).toBeTruthy();
  });
});
