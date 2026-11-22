import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomerDetail, CustomerListResponse, VoucherList } from '@serva/core';
import { ManualClock } from '../src/clock';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/** Round 44: the customers list in pages, the search by Arabic digits, archive checks, payment replay and the date. */

let app: FastifyInstance;
beforeAll(async () => {
  // 22:30 UTC is 01:30 the next day in Damascus
  app = await makeApp({}, { clock: new ManualClock('2026-10-30T22:30:00.000Z') });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
async function add(store: Store, body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/v1/customers', headers: as(store), payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CustomerDetail>();
}
const list = async (store: Store, qs: string) =>
  (
    await app.inject({ method: 'GET', url: `/v1/customers${qs}`, headers: as(store) })
  ).json<CustomerListResponse>();
const debt = (store: Store, id: string, amountMinor: number) =>
  app.inject({
    method: 'POST',
    url: `/v1/customers/${id}/opening-debt`,
    headers: as(store),
    payload: { amountMinor, date: '2026-11-01' },
  });

describe('the customers list', () => {
  it('pages by balance, keeps the debt total while searching, finds a phone typed in Arabic digits and goes light', async () => {
    const store = await openStore(app);
    const a = await add(store, { name: 'أحمد', phone: '0944111222' });
    const b = await add(store, { name: 'باسل', phone: '0944333444' });
    await add(store, { name: 'جميل' });
    await debt(store, a.id, 5_000);
    await debt(store, b.id, 9_000);

    const first = await list(store, '?limit=2');
    expect(first.items.map((c) => c.name)).toEqual(['باسل', 'أحمد']);
    expect(first.nextCursor).toBeTruthy();
    expect(first).toMatchObject({ totalCount: 3, totalOwedMinor: 14_000 });
    const second = await list(store, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((c) => c.name)).toEqual(['جميل']);
    expect(second.nextCursor).toBeNull();

    // The tile is the store's debt, not the debt of the matches
    const found = await list(store, '?q=' + encodeURIComponent('أحم'));
    expect(found.items.map((c) => c.name)).toEqual(['أحمد']);
    expect(found.totalOwedMinor).toBe(14_000);
    const owing = await list(store, '?owing=true');
    expect(owing.items).toHaveLength(2);
    expect(owing.totalOwedMinor).toBe(14_000);

    const arabic = await list(store, '?q=' + encodeURIComponent('٠٩٤٤٣٣٣٤٤٤'));
    expect(arabic.items.map((c) => c.name)).toEqual(['باسل']);

    // Light: a picker (no limit) and ?lite=true cost no query over the invoices; a page carries them
    const lite = await list(store, '?lite=true&limit=5');
    expect(lite.items[0]).not.toHaveProperty('spentMinor');
    expect((await list(store, '')).items[0]).not.toHaveProperty('spentMinor');
    expect((await list(store, '?limit=5')).items[0]).toHaveProperty('spentMinor');
    expect(first).toMatchObject({ allCount: 3, owingCount: 2 });
    const bad = await app.inject({ method: 'GET', url: '/v1/customers?cursor=zzz', headers: as(store) });
    expect(bad.statusCode).toBe(400);
  });
});

describe('balances on a page sorted by name', () => {
  it('reads the balance of the page rows alone and gives the same figures as the balance order', async () => {
    const store = await openStore(app);
    const a = await add(store, { name: 'أحمد' });
    const b = await add(store, { name: 'باسل' });
    await add(store, { name: 'جميل' });
    await debt(store, a.id, 5_000);
    await debt(store, b.id, 9_000);
    await debt(store, b.id, 1_000);
    const byName = await list(store, '?limit=2&sort=name&dir=asc');
    expect(byName.items.map((c) => [c.name, c.balanceMinor])).toEqual([
      ['أحمد', 5_000],
      ['باسل', 10_000],
    ]);
    expect(byName.nextCursor).toBeTruthy();
    const next = await list(store, `?limit=2&sort=name&dir=asc&cursor=${byName.nextCursor}`);
    expect(next.items.map((c) => [c.name, c.balanceMinor])).toEqual([['جميل', 0]]);
    // The strip (all debts) is the same whatever the order
    expect(byName).toMatchObject({ totalOwedMinor: 15_000, owingCount: 2 });
    const byBalance = await list(store, '?limit=3');
    expect(byBalance.items.map((c) => [c.name, c.balanceMinor])).toEqual([
      ['باسل', 10_000],
      ['أحمد', 5_000],
      ['جميل', 0],
    ]);
  });
});

describe('archiving from the customer page', () => {
  it('refuses a customer who owes, allows one at zero, and refuses a new opening debt on an archived one', async () => {
    const store = await openStore(app);
    const c = await add(store, { name: 'أبو سعيد' });
    await debt(store, c.id, 7_000);
    const refused = await app.inject({
      method: 'PUT',
      url: `/v1/customers/${c.id}`,
      headers: as(store),
      payload: { name: 'أبو سعيد', archived: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.message).toContain('دين');
    const paid = await app.inject({
      method: 'POST',
      url: `/v1/customers/${c.id}/payments`,
      headers: as(store),
      payload: { amountMinor: 7_000, method: 'cash' },
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const ok = await app.inject({
      method: 'PUT',
      url: `/v1/customers/${c.id}`,
      headers: as(store),
      payload: { name: 'أبو سعيد', archived: true },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await debt(store, c.id, 1_000)).statusCode).toBe(409);
  });
});

describe('a payment from the customer page', () => {
  it('is dated by the store business day and answers a retry with the same receipt', async () => {
    const store = await openStore(app);
    const c = await add(store, { name: 'أبو علي' });
    await debt(store, c.id, 20_000);
    const id = '0198f1a0-0000-7000-8000-00000000beef';
    const pay = () =>
      app.inject({
        method: 'POST',
        url: `/v1/customers/${c.id}/payments`,
        headers: as(store),
        payload: { amountMinor: 5_000, method: 'cash', id },
      });
    const first = await pay();
    expect(first.statusCode, first.body).toBe(201);
    // 22:30 UTC is already the next day in Damascus
    expect(first.json().date).toBe('2026-10-31');
    const again = await pay();
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({
      number: first.json().number,
      amountMinor: 5_000,
      balanceAfterMinor: 15_000,
    });
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${c.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(15_000);
    // The retry burned no number: the next receipt is the second
    const next = await app.inject({
      method: 'POST',
      url: `/v1/customers/${c.id}/payments`,
      headers: as(store),
      payload: { amountMinor: 1_000, method: 'cash' },
    });
    expect(next.json().number).toMatch(/-000002$/);
  });
});

describe('the vouchers list', () => {
  it('is empty with nothing issued', async () => {
    const store = await openStore(app);
    const res = await app.inject({ method: 'GET', url: '/v1/vouchers', headers: as(store) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<VoucherList>()).toEqual({ items: [], nextCursor: null, outstanding: [] });
  });
});
