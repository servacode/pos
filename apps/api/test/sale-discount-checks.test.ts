import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { type CustomerRow, type Promotion } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import {
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase, settled } from './helpers';

/**
 * Round A5: the customer group's discount and a code typed at the till. A sale that carries either is posted
 * as an ordinary invoice or line discount; the server only checks the claim against its own data and flags
 * what it does not back (the sale stands: 08 › قاعدة 8).
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
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const post = (store: Store, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(store), payload: payload as Record<string, unknown> });

async function pulled(store: Store) {
  await settled();
  const page = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  return page.json<PullResponse>().sets as unknown as {
    customers: { upserts: CustomerRow[] };
    promotions: { upserts: (Promotion & { couponCode: string | null })[] };
  };
}

async function groupCustomer(store: Store, bps = 1000) {
  const group = (await post(store, '/v1/customer-groups', { name: 'جملة كبار', discountBps: bps })).json<{
    id: string;
  }>();
  const customer = (await post(store, '/v1/customers', { name: 'ريم', groupId: group.id })).json<{
    id: string;
  }>();
  return { group, customer };
}

describe('customer group discount', () => {
  it('reaches the till with the customer, and a change of the percent reaches it again', async () => {
    const store = await openStore(app);
    const { group, customer } = await groupCustomer(store);
    const row = (await pulled(store)).customers.upserts.find((c) => c.id === customer.id)!;
    expect(row).toMatchObject({ groupId: group.id, groupName: 'جملة كبار', groupDiscountBps: 1000 });
    const before = row.version;

    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/customer-groups/${group.id}`,
      headers: as(store),
      payload: { name: 'جملة كبار', discountBps: 700 },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const after = (await pulled(store)).customers.upserts.find((c) => c.id === customer.id)!;
    expect(after.groupDiscountBps).toBe(700);
    expect(after.version).toBeGreaterThan(before);

    // An archived group stops reaching the till
    await app.inject({
      method: 'PUT',
      url: `/v1/customer-groups/${group.id}`,
      headers: as(store),
      payload: { name: 'جملة كبار', discountBps: 700, archived: true },
    });
    const gone = (await pulled(store)).customers.upserts.find((c) => c.id === customer.id)!;
    expect(gone.groupId).toBeNull();
    expect(gone.groupDiscountBps).toBeNull();
  });

  it('posts like a manual invoice discount, and the server flags a group it does not back', async () => {
    const store = await openStore(app);
    const { group, customer } = await groupCustomer(store, 1000);
    const other = (await post(store, '/v1/customer-groups', { name: 'أخرى', discountBps: 2000 })).json<{
      id: string;
    }>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const mine = { source: 'promotion' as const, reason: 'خصم المجموعة جملة كبار', approval: null };
    const make = (discount: Record<string, unknown>, customerId: string | null, payMinor: number) =>
      doc(
        'sale',
        sale(store, open.id, {
          customerId,
          customerName: customerId ? 'ريم' : null,
          lines: [cartLine(1, 100_000)],
          invoiceDiscount: discount as never,
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: payMinor }],
        }),
      );
    const honest = make({ type: 'percent', bp: 1000, ...mine, groupId: group.id }, customer.id, 90_000);
    const manual = make(
      { type: 'percent', bp: 1000, source: 'manual', reason: null, approval: null },
      customer.id,
      90_000,
    );
    const inflated = make({ type: 'percent', bp: 2500, ...mine, groupId: group.id }, customer.id, 75_000);
    const wrongGroup = make({ type: 'percent', bp: 1000, ...mine, groupId: other.id }, customer.id, 90_000);
    const noCustomer = make({ type: 'percent', bp: 1000, ...mine, groupId: group.id }, null, 90_000);
    const asAmount = make({ type: 'amount', minor: 10_000, ...mine, groupId: group.id }, customer.id, 90_000);
    const res = await push(app, store.device, [
      open,
      honest,
      manual,
      inflated,
      wrongGroup,
      noCustomer,
      asAmount,
    ]);
    const flags = res.results.slice(1).map((r) => r.flags);
    expect(flags[0]).toEqual([]);
    expect(flags[1]).toEqual([]);
    for (const f of flags.slice(2)) expect(f).toEqual(['group_discount_mismatch']);
    for (const r of res.results) expect(r.status).toBe('accepted');
    // Nothing new is posted: the group's percent is an ordinary invoice discount, same lines as the typed one
    const entries = await postedEntries(store.tenantId);
    const lines = (id: string) => compact(entries.find((e) => e.sourceId === id));
    expect(lines(honest.id)).toEqual(lines(manual.id));
    expect(lines(honest.id)).toContainEqual(['4100', 0, 100_000]);
  });
});

describe('coupon typed at the till', () => {
  async function coupon(store: Store, extra: Record<string, unknown> = {}) {
    const made = await post(store, '/v1/promotions', {
      name: 'خصم الصيف',
      kind: 'percent',
      percentBp: 1000,
      scope: 'all',
      couponCode: 'SUMMER10',
      ...extra,
    });
    expect(made.statusCode, made.body).toBe(201);
    return made.json<Promotion>();
  }

  it('reaches the till as its code while the offer stays out of the running ones', async () => {
    const store = await openStore(app);
    const live = await coupon(store);
    const stopped = await coupon(store, { name: 'قديم', couponCode: 'OLD10', archived: true });
    const rows = (await pulled(store)).promotions.upserts;
    const liveRow = rows.find((p) => p.id === live.id)!;
    expect(liveRow.couponCode).toBe('SUMMER10');
    expect(liveRow.archived).toBe(true);
    expect(rows.find((p) => p.id === stopped.id)?.couponCode ?? null).toBeNull();
  });

  it('flags a sale that used a code outside its dates or an unknown offer, and keeps the sale', async () => {
    const store = await openStore(app);
    const live = await coupon(store);
    // The sale documents are made on 2026-10-30 at 08:59
    const ended = await coupon(store, {
      name: 'انتهى',
      couponCode: 'ENDED',
      startsAt: '2026-09-01T00:00:00Z',
      endsAt: '2026-10-01T00:00:00Z',
    });
    const future = await coupon(store, {
      name: 'لاحقاً',
      couponCode: 'LATER',
      startsAt: '2026-12-01T00:00:00Z',
    });
    const plain = (
      await post(store, '/v1/promotions', { name: 'عام', kind: 'percent', percentBp: 500, scope: 'all' })
    ).json<Promotion>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const used = (p: Promotion) =>
      doc(
        'sale',
        sale(store, open.id, {
          lines: [
            cartLine(1, 100_000, {
              discount: {
                type: 'amount',
                minor: 10_000,
                source: 'promotion',
                reason: p.name,
                approval: null,
                promotionId: p.id,
              },
            }),
          ],
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: 90_000 }],
        }),
      );
    const res = await push(app, store.device, [open, used(live), used(plain), used(ended), used(future)]);
    expect(res.results.slice(1).map((r) => r.flags)).toEqual([
      [],
      [],
      ['coupon_invalid'],
      ['coupon_invalid'],
    ]);
    for (const r of res.results) expect(r.status).toBe('accepted');
  });
});
