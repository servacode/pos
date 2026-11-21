import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type PlatformLoginResponse,
  type SalePayload,
  type SubscriptionInvoice,
  type SyncEvidence,
} from '@serva/core';
import { payloadHash, type SyncDocument } from '@serva/sync';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock } from '../src/clock';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { pushDocuments } from '../src/services/sync-push';
import {
  RELEASE_RETRY_AFTER_MS,
  releaseQuietly,
  releaseReadOnlyQuarantine,
} from '../src/services/subscription-release';
import {
  balances,
  cartLine,
  compact,
  documents,
  makeProduct,
  movement,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * What a read-only store held back is released when the store can write again: the sales made at
 * the till after the cut-off were kept whole (quarantined, subscription_read_only); once the store
 * pays they are posted exactly as if they had arrived on time, once, and never twice.
 */

const NOW = '2026-10-30T09:00:00.000Z';
const DAY = 24 * 3_600_000;
const clock = new ManualClock(NOW);
let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
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

/** The subscription ended 30 days ago: read-only since 23 days ago, so what is made now is held. */
async function expire(store: Store) {
  await ownerDb()`
    update subscriptions set status = 'active', trial_ends_at = null, current_period_end = ${ago(30 * DAY)},
      grace_ends_at = null, updated_at = ${ago(30 * DAY)}
    where tenant_id = ${store.tenantId}`;
}
async function renew(store: Store) {
  await ownerDb()`
    update subscriptions set status = 'active', current_period_end = ${new Date(clock.now().getTime() + 30 * DAY)}
    where tenant_id = ${store.tenantId}`;
}

interface Day {
  store: Store;
  doc: ReturnType<typeof documents>;
  open: SyncDocument;
  sold: SyncDocument;
  payload: SalePayload;
  variantId: string;
}

/** A store with a product, already read-only, whose till made a shift and a sale of 2 milk + bread. */
async function readOnlyDay(phone = '0912345678'): Promise<Day> {
  const store = await openStore(app, phone);
  const milk = await makeProduct(app, store, 'حليب', 25_000);
  await expire(store);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const payload = sale(store, open.id, {
    lines: [
      cartLine(1, 25_000, { qty: 2000, productId: milk.productId, variantId: milk.variantId, name: 'حليب' }),
      cartLine(2, 10_000, { name: 'خبز' }),
    ],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 60_000 }],
  });
  const sold = doc('sale', payload);
  const res = await push(app, store.device, [open, sold]);
  expect(res.results.map((r) => [r.status, r.code])).toEqual([
    ['quarantined', 'subscription_read_only'],
    ['quarantined', 'subscription_read_only'],
  ]);
  return { store, doc, open, sold, payload, variantId: milk.variantId };
}

const rows = (tenantId: string) =>
  ownerDb()<{ doc_id: string; status: string; result_code: string | null; processed_at: Date | null }[]>`
    select doc_id, status, result_code, processed_at from sync_inbox where tenant_id = ${tenantId}
    order by device_seq`;
const stockOf = async (tenantId: string) =>
  (await ownerDb()<{ qty: string }[]>`select qty from stock_levels where tenant_id = ${tenantId}`).map((r) =>
    Number(r.qty),
  );
const evidence = async (store: Store, deviceId = store.device.deviceId) =>
  (
    await app.inject({ method: 'GET', url: `/v1/sync/evidence?deviceId=${deviceId}`, headers: as(store) })
  ).json<SyncEvidence>();
const releaseNow = (tenantId: string) =>
  releaseReadOnlyQuarantine(appDb().db, tenantId, {
    processors: DOCUMENT_PROCESSORS,
    now: clock.now(),
    meta: { ip: '127.0.0.1', userAgent: null },
  });
const auditCount = async (tenantId: string) =>
  (
    await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where tenant_id = ${tenantId} and action = 'sync.quarantine_released'`
  )[0]!.n;

async function platformAdmin() {
  await ownerDb()`
    insert into platform_users (full_name, email, password_hash, role)
    values ('مدير المنصة', 'boss@serva.test', ${await hashSecret('platform-pass-1')}, 'super_admin')`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/platform/login',
    payload: { email: 'boss@serva.test', password: 'platform-pass-1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { authorization: `Bearer ${res.json<PlatformLoginResponse>().token}` };
}

async function reportPayment(store: Store) {
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
      transactionRef: 'SC-1',
      amountMinor: invoice.sypMinor,
      currency: 'SYP',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>();
}

/** The golden figures of the one sale: 60,000 in, 35,000 sales (25,000 x 2 + 10,000 = 60,000). */
async function expectPostedOnce(day: Day) {
  const sales = (await postedEntries(day.store.tenantId)).filter((e) => e.sourceType === 'sale');
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({ sourceId: day.sold.id, total: 60_000 });
  expect(compact(sales[0])).toEqual([
    ['111001', 60_000, 0],
    ['4100', 0, 60_000],
  ]);
  const b = await balances(day.store.tenantId);
  expect(b.get('111001')?.base).toBe(60_000);
  expect(b.get('4100')?.base).toBe(-60_000);
  expect(await stockOf(day.store.tenantId)).toEqual([-2000]);
  const [moves] = await ownerDb()<{ n: number }[]>`
    select count(*)::int as n from stock_movements where tenant_id = ${day.store.tenantId} and doc_id = ${day.sold.id}`;
  expect(moves!.n).toBe(1);
}

describe('while the store is read-only', () => {
  it('keeps the documents whole and posts nothing; the release finds the store still read-only', async () => {
    const day = await readOnlyDay();
    expect(await postedEntries(day.store.tenantId)).toEqual([]);
    expect(await stockOf(day.store.tenantId)).toEqual([]);
    expect((await evidence(day.store)).quarantined).toBe(2);
    expect(await releaseNow(day.store.tenantId)).toMatchObject({ released: 0 });
    expect((await rows(day.store.tenantId)).every((r) => r.status === 'quarantined')).toBe(true);
  });
});

describe('a reported payment (72-hour activation) releases at once', () => {
  it('posts the sale like a normal one, once, and moves the evidence page to accepted', async () => {
    const day = await readOnlyDay();
    await reportPayment(day.store);

    expect(await rows(day.store.tenantId)).toEqual([
      expect.objectContaining({ doc_id: day.open.id, status: 'accepted', result_code: null }),
      expect.objectContaining({ doc_id: day.sold.id, status: 'accepted', result_code: null }),
    ]);
    expect((await rows(day.store.tenantId)).every((r) => r.processed_at !== null)).toBe(true);
    await expectPostedOnce(day);
    expect(await evidence(day.store)).toMatchObject({
      sent: 2,
      accepted: 2,
      quarantined: 0,
      heldForProcessing: 0,
    });
    expect(await auditCount(day.store.tenantId)).toBe(1);

    // The till asks again: it gets the new outcome
    const again = await push(app, day.store.device, [day.open, day.sold]);
    expect(again.results.map((r) => [r.status, r.outcome])).toEqual([
      ['duplicate', 'accepted'],
      ['duplicate', 'accepted'],
    ]);

    // A second release, and one racing another, do nothing more
    expect(await releaseNow(day.store.tenantId)).toMatchObject({ released: 0 });
    await Promise.all([releaseNow(day.store.tenantId), releaseNow(day.store.tenantId)]);
    await expectPostedOnce(day);
    expect(await auditCount(day.store.tenantId)).toBe(1);
  });
});

describe('the platform', () => {
  it('confirming a payment after the 72 hours ran out releases what was held meanwhile', async () => {
    const day = await readOnlyDay();
    const payment = await reportPayment(day.store);
    // Released by the report; six days later the activation is over and the store is read-only again
    clock.set(new Date(clock.now().getTime() + 6 * DAY).toISOString());
    const { hash: _h, ...body } = day.doc(
      'cash_movement',
      movement(day.store.userId, day.open.id, 'pay_in', 50_000),
    );
    const fresh = { ...body, deviceTime: '2026-11-05T08:59:00.000Z', businessDate: '2026-11-05' };
    const held: SyncDocument = { ...fresh, hash: payloadHash(fresh) };
    const res = await push(app, day.store.device, [held]);
    expect(res.results[0]).toMatchObject({ status: 'quarantined', code: 'subscription_read_only' });

    const admin = await platformAdmin();
    const confirm = await app.inject({
      method: 'POST',
      url: `/v1/platform/payments/${payment.id}/confirm`,
      headers: admin,
    });
    expect(confirm.statusCode, confirm.body).toBe(204);
    const [row] = await rows(day.store.tenantId).then((r) => r.filter((x) => x.doc_id === held.id));
    expect(row).toMatchObject({ status: 'accepted', result_code: null });
    expect(row!.processed_at).not.toBeNull();
  });

  it('setting the subscription active releases it, and only that store’s documents', async () => {
    const day = await readOnlyDay();
    const other = await readOnlyDay('0933333333');
    const admin = await platformAdmin();
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/platform/stores/${day.store.tenantId}/subscription`,
      headers: admin,
      payload: {
        planCode: 'basic',
        status: 'active',
        currentPeriodEnd: new Date(clock.now().getTime() + 30 * DAY).toISOString(),
      },
    });
    expect(res.statusCode, res.body).toBe(204);
    await expectPostedOnce(day);
    // Tenant isolation: the other store is still read-only and untouched
    expect((await rows(other.store.tenantId)).every((r) => r.status === 'quarantined')).toBe(true);
    expect(await postedEntries(other.store.tenantId)).toEqual([]);
    expect(await auditCount(other.store.tenantId)).toBe(0);
  });
});

describe('the next push of any till of the store (lazy release)', () => {
  it('does nothing while read-only, and releases once the store can write', async () => {
    const day = await readOnlyDay();
    const second = await createDevice(day.store.tenantId);
    const idle = documents(second);
    await push(app, second, [idle('shift_open', shiftOpen(day.store.userId))]);
    expect((await rows(day.store.tenantId)).every((r) => r.status === 'quarantined')).toBe(true);

    await renew(day.store);
    // Another device pushes: the first device's documents go through
    await push(app, second, [idle('shift_open', shiftOpen(day.store.userId, []))]);
    await expectPostedOnce(day);
  });

  it('keeps the order of the till and what depends on a released sale: a return', async () => {
    const day = await readOnlyDay();
    const payload = buildReturnPayload({
      sale: day.payload,
      saleId: day.sold.id,
      saleNumber: day.sold.number!,
      shiftId: day.open.id,
      cashierId: day.store.userId,
      reason: 'تالف',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      returned: [],
      reference: 'R-1',
    });
    const { hash: _h, ...body } = day.doc('return', payload);
    const withDeps = { ...body, deps: [day.sold.id] };
    const ret: SyncDocument = { ...withDeps, hash: payloadHash(withDeps) };
    // Pushed while read-only: held with the rest, not rejected for depending on a held sale
    expect((await push(app, day.store.device, [ret])).results[0]).toMatchObject({ status: 'quarantined' });

    await renew(day.store);
    await releaseNow(day.store.tenantId);
    expect((await rows(day.store.tenantId)).map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    const entries = await postedEntries(day.store.tenantId);
    expect(entries.map((e) => e.sourceType)).toEqual(['sale', 'return']);
    expect(compact(entries[1])).toEqual([
      ['4100', 25_000, 0],
      ['111001', 0, 25_000],
    ]);
    expect(await stockOf(day.store.tenantId)).toEqual([-1000]);
  });

  it('a return of another till waits for the sale it depends on, whatever the order of the devices', async () => {
    const day = await readOnlyDay();
    const second = await createDevice(day.store.tenantId);
    const payload = buildReturnPayload({
      sale: day.payload,
      saleId: day.sold.id,
      saleNumber: day.sold.number!,
      shiftId: day.open.id,
      cashierId: day.store.userId,
      reason: 'تالف',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      returned: [],
      reference: 'R-2',
    });
    const { hash: _h, ...body } = documents(second)('return', payload);
    const withDeps = { ...body, deps: [day.sold.id] };
    const ret: SyncDocument = { ...withDeps, hash: payloadHash(withDeps) };
    expect((await push(app, second, [ret])).results[0]).toMatchObject({ status: 'quarantined' });

    await renew(day.store);
    expect(await releaseNow(day.store.tenantId)).toMatchObject({ released: 3 });
    expect((await rows(day.store.tenantId)).map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    expect((await postedEntries(day.store.tenantId)).map((e) => e.sourceType).sort()).toEqual([
      'return',
      'sale',
    ]);
  });
});

describe('what is not the read-only quarantine', () => {
  it('leaves a revoked device’s after_revocation documents for the owner', async () => {
    const day = await readOnlyDay();
    const revoked = await createDevice(day.store.tenantId, { revoked: true });
    const make = documents(revoked);
    const doc = make('shift_open', shiftOpen(day.store.userId));
    const res = await push(app, revoked, [doc]);
    expect(res.results[0]).toMatchObject({ status: 'quarantined', code: 'after_revocation' });

    await renew(day.store);
    await releaseNow(day.store.tenantId);
    const [kept] = (await rows(day.store.tenantId)).filter((r) => r.doc_id === doc.id);
    expect(kept).toMatchObject({
      status: 'quarantined',
      result_code: 'after_revocation',
      processed_at: null,
    });
    // while the sale of the working device went through
    await expectPostedOnce(day);
  });

  it('a document of a device revoked meanwhile, past its cut-off, goes to the owner’s review instead', async () => {
    const day = await readOnlyDay();
    await ownerDb()`
      update devices set status = 'revoked', revoked_at = ${clock.now()} where id = ${day.store.device.deviceId}`;
    await renew(day.store);
    const report = await releaseNow(day.store.tenantId);
    expect(report).toMatchObject({ released: 0, revoked: 2 });
    expect((await rows(day.store.tenantId)).map((r) => r.result_code)).toEqual([
      'after_revocation',
      'after_revocation',
    ]);
    expect(await postedEntries(day.store.tenantId)).toEqual([]);
  });
});

describe('a return pushed normally while its sale is still held', () => {
  it('waits with the same reason instead of being rejected, and is released with its sale', async () => {
    const day = await readOnlyDay();
    const payload = buildReturnPayload({
      sale: day.payload,
      saleId: day.sold.id,
      saleNumber: day.sold.number!,
      shiftId: day.open.id,
      cashierId: day.store.userId,
      reason: 'تالف',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      returned: [],
      reference: 'R-1',
    });
    const { hash: _h, ...body } = day.doc('return', payload);
    const withDeps = { ...body, deps: [day.sold.id] };
    const ret: SyncDocument = { ...withDeps, hash: payloadHash(withDeps) };

    // The store can write, but the release has not run yet: the sale is still held when this arrives
    await renew(day.store);
    const device = { ...day.store.device, revokedAt: null };
    const res = await pushDocuments(
      appDb().db,
      device,
      { contractVersion: 1, appVersion: '1.0.0', sentAt: NOW, lastIssued: {}, documents: [ret] },
      { meta: { ip: '127.0.0.1', userAgent: null }, now: clock.now(), processors: DOCUMENT_PROCESSORS },
    );
    expect(res.results[0]).toMatchObject({ status: 'quarantined', code: 'subscription_read_only' });

    await releaseNow(day.store.tenantId);
    expect((await rows(day.store.tenantId)).map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    expect((await postedEntries(day.store.tenantId)).map((e) => e.sourceType)).toEqual(['sale', 'return']);
  });
});

describe('a sale made while a reported payment kept a suspended store on', () => {
  // The row-version trigger would move updated_at (the suspension cut-off) to the real now on every
  // update, report and rejection; these tests keep it at the moment the platform suspended the store.
  beforeEach(async () => {
    await ownerDb()`alter table subscriptions disable trigger bump_row_version`;
  });
  afterEach(async () => {
    await ownerDb()`alter table subscriptions enable trigger bump_row_version`;
  });

  /** Suspended 10 days ago; a payment is reported now (P = NOW), giving 72 hours. */
  async function suspendedAndReported() {
    const store = await openStore(app);
    await ownerDb()`
      update subscriptions set status = 'suspended', current_period_end = ${new Date(clock.now().getTime() + 20 * DAY)},
        grace_ends_at = null, updated_at = ${ago(10 * DAY)}
      where tenant_id = ${store.tenantId}`;
    const payment = await reportPayment(store);
    return { store, payment };
  }
  /** A shift opening the till made at the given instant (the till's own clock). */
  function madeAt(doc: ReturnType<typeof documents>, store: Store, iso: string) {
    const { hash: _h, ...body } = doc('shift_open', shiftOpen(store.userId));
    const made = { ...body, deviceTime: iso, businessDate: iso.slice(0, 10) };
    return { ...made, hash: payloadHash(made) } as SyncDocument;
  }

  it('is taken when pushed after the 72 hours closed; one made before the report is held', async () => {
    const { store } = await suspendedAndReported();
    const doc = documents(store.device);
    const before = madeAt(doc, store, '2026-10-28T10:00:00.000Z');
    const inside = madeAt(doc, store, '2026-10-31T15:00:00.000Z');
    clock.set(new Date(clock.now().getTime() + 6 * DAY).toISOString());
    const res = await push(app, store.device, [before, inside]);
    expect(res.results.map((r) => [r.status, r.code ?? null])).toEqual([
      ['quarantined', 'subscription_read_only'],
      ['accepted', null],
    ]);
  });

  it('is taken when pushed after the payment was rejected', async () => {
    const { store, payment } = await suspendedAndReported();
    const doc = documents(store.device);
    const inside = madeAt(doc, store, '2026-10-30T10:00:00.000Z');
    clock.set(new Date(clock.now().getTime() + 2 * 3_600_000).toISOString());
    const admin = await platformAdmin();
    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/platform/payments/${payment.id}/reject`,
      headers: admin,
      payload: { reason: 'الرقم غير صحيح' },
    });
    expect(rejected.statusCode, rejected.body).toBe(204);
    clock.set(new Date(clock.now().getTime() + 3 * DAY).toISOString());
    const after = madeAt(doc, store, '2026-11-02T10:00:00.000Z');
    const res = await push(app, store.device, [inside, after]);
    expect(res.results.map((r) => [r.status, r.code ?? null])).toEqual([
      ['accepted', null],
      ['quarantined', 'subscription_read_only'],
    ]);
  });
});

describe('the lazy release on every push', () => {
  it('a failing release is not retried on every push, only after the pause; a payment always tries', async () => {
    const day = await readOnlyDay();
    await renew(day.store);
    let calls = 0;
    const broken = {
      ...DOCUMENT_PROCESSORS,
      sale: async () => {
        calls += 1;
        throw new Error('boom');
      },
    };
    const failures: unknown[] = [];
    const lazy = (backoff: boolean) =>
      releaseQuietly(
        appDb().db,
        day.store.tenantId,
        { processors: broken, now: clock.now(), meta: { ip: '127.0.0.1', userAgent: null }, backoff },
        (error) => failures.push(error),
      );
    await lazy(true);
    const first = calls;
    expect(first).toBeGreaterThan(0);
    await lazy(true);
    await lazy(true);
    expect(calls).toBe(first);
    // A payment or an owner's action is never held back by the pause
    await lazy(false);
    const forced = calls;
    expect(forced).toBeGreaterThan(first);
    clock.set(new Date(clock.now().getTime() + RELEASE_RETRY_AFTER_MS + 1).toISOString());
    await lazy(true);
    expect(calls).toBeGreaterThan(forced);
  });

  it('a store with nothing held releases nothing and has nothing to retry', async () => {
    const store = await openStore(app);
    const failures: unknown[] = [];
    await releaseQuietly(
      appDb().db,
      store.tenantId,
      {
        processors: DOCUMENT_PROCESSORS,
        now: clock.now(),
        meta: { ip: '127.0.0.1', userAgent: null },
        backoff: true,
      },
      (error) => failures.push(error),
    );
    expect(failures).toEqual([]);
  });
});
