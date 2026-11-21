import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type CustomerDetail,
  type CustomerListResponse,
  type VoucherList,
} from '@serva/core';
import { ManualClock } from '../src/clock';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Round 50: one export request, a held picker, archived debt apart, a payment id that is not another customer's, vouchers with their customer. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp({}, { clock: new ManualClock('2026-10-30T09:00:00.000Z') });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const post = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: as(store), payload });
async function add(store: Store, body: Record<string, unknown>) {
  const res = await post(store, '/v1/customers', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CustomerDetail>();
}
const list = async (store: Store, qs: string) =>
  (
    await app.inject({ method: 'GET', url: `/v1/customers${qs}`, headers: as(store) })
  ).json<CustomerListResponse>();

describe('the list for Excel and the pickers', () => {
  it('export gives every customer with last purchase and spend in one answer; a lite picker is held at 50', async () => {
    const store = await openStore(app);
    for (let i = 1; i <= 55; i += 1) await add(store, { name: `زبون ${i}` });
    const debtor = await add(store, { name: 'مدين' });
    await post(store, `/v1/customers/${debtor.id}/opening-debt`, { amountMinor: 7_000, date: '2026-10-01' });

    const all = await list(store, '?export=true&sort=name&dir=asc');
    expect(all.items).toHaveLength(56);
    expect(all.nextCursor).toBeNull();
    expect(all.items.find((c) => c.name === 'مدين')!.balanceMinor).toBe(7_000);
    expect(all.items[0]!).toHaveProperty('spentMinor', 0);

    expect((await list(store, '?lite=true')).items).toHaveLength(50);
    const q = await list(store, '?q=' + encodeURIComponent('زبون'));
    expect(q.items).toHaveLength(50);
    expect(q.nextCursor).toBeTruthy();
  });

  it('export never shows another store customers, nor their balances', async () => {
    const a = await openStore(app);
    const b = await openStore(app, '0922222222');
    const mine = await add(a, { name: 'زبون المتجر الأول' });
    await post(a, `/v1/customers/${mine.id}/opening-debt`, { amountMinor: 5_000, date: '2026-10-01' });
    await add(b, { name: 'زبون المتجر الثاني' });
    const seenByB = await list(b, '?export=true');
    expect(seenByB.items.map((c) => c.name)).toEqual(['زبون المتجر الثاني']);
    expect(seenByB.items.some((c) => c.id === mine.id)).toBe(false);
    expect(seenByB.totalOwedMinor).toBe(0);
  });

  it('says how much of the debt sits on archived customers', async () => {
    const store = await openStore(app);
    const live = await add(store, { name: 'حي' });
    const gone = await add(store, { name: 'قديم' });
    await post(store, `/v1/customers/${live.id}/opening-debt`, { amountMinor: 1_000, date: '2026-10-01' });
    await post(store, `/v1/customers/${gone.id}/opening-debt`, { amountMinor: 7_000, date: '2026-10-01' });
    await ownerDb()`update customers set archived_at = now() where id = ${gone.id}`;
    const res = await list(store, '?limit=10');
    expect(res.totalOwedMinor).toBe(8_000);
    expect(res.archivedOwedMinor).toBe(7_000);
  });
});

describe('a payment id belongs to one customer', () => {
  it('the same id on another customer is refused, not answered with the first receipt', async () => {
    const store = await openStore(app);
    const a = await add(store, { name: 'أول' });
    const b = await add(store, { name: 'ثان' });
    for (const c of [a, b]) {
      await post(store, `/v1/customers/${c.id}/opening-debt`, { amountMinor: 5_000, date: '2026-10-01' });
    }
    const id = randomUUID();
    const first = await post(store, `/v1/customers/${a.id}/payments`, {
      amountMinor: 1_000,
      method: 'cash',
      id,
    });
    expect(first.statusCode, first.body).toBe(201);
    const other = await post(store, `/v1/customers/${b.id}/payments`, {
      amountMinor: 1_000,
      method: 'cash',
      id,
    });
    expect(other.statusCode, other.body).toBe(409);
    expect((await list(store, '?limit=10')).items.find((c) => c.id === b.id)!.balanceMinor).toBe(5_000);
  });
});

describe('vouchers', () => {
  it('names the customer of an exchange voucher, finds it by name, and refuses an update that changes nothing', async () => {
    const store = await openStore(app);
    const c = await add(store, { name: 'سلمى' });
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const soldPayload = sale(store, open.id, {
      customerId: c.id,
      lines: [cartLine(1, 45_000, { name: 'قميص M' })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 45_000 }],
    });
    const sold = doc('sale', soldPayload);
    const ret = doc(
      'return',
      buildReturnPayload({
        sale: soldPayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'المقاس',
        picks: [{ saleLineNo: 1, qty: 1000 }],
        refundMethod: 'voucher',
      }),
    );
    const res = await push(app, store.device, [open, sold, ret]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);

    const get = async (qs: string) =>
      (await app.inject({ method: 'GET', url: `/v1/vouchers${qs}`, headers: as(store) })).json<VoucherList>();
    const all = await get('?status=all');
    expect(all.items).toHaveLength(1);
    expect(all.items[0]).toMatchObject({ customerId: c.id, customerName: 'سلمى' });
    expect((await get('?status=all&q=' + encodeURIComponent('سلم'))).items).toHaveLength(1);
    expect((await get('?status=all&q=zzz')).items).toHaveLength(0);

    const code = all.items[0]!.code;
    const noop = await app.inject({
      method: 'PUT',
      url: `/v1/vouchers/${code}`,
      headers: as(store),
      payload: {},
    });
    expect(noop.statusCode, noop.body).toBe(400);
  });
});
