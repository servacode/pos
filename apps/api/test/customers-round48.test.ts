import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CustomerDetail,
  CustomerGroup,
  CustomerListResponse,
  CustomerMoneyResult,
  VoucherList,
} from '@serva/core';
import { ManualClock } from '../src/clock';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Round 48: customers in SQL (search, sort, group, birthday), one opening debt per id, no future payment, duplicate phone, vouchers. */

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

describe('money from the desk', () => {
  it('an opening debt sent twice with the same id posts once; a payment dated ahead is refused', async () => {
    const store = await openStore(app);
    const c = await add(store, { name: 'زبون الدين' });
    const id = randomUUID();
    const body = { amountMinor: 10_000, date: '2026-10-01', id };
    const first = await post(store, `/v1/customers/${c.id}/opening-debt`, body);
    const again = await post(store, `/v1/customers/${c.id}/opening-debt`, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<CustomerMoneyResult>().number).toBe(first.json<CustomerMoneyResult>().number);
    expect((await list(store, '')).items[0]!.balanceMinor).toBe(10_000);
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${c.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.statement).toHaveLength(1);

    const future = await post(store, `/v1/customers/${c.id}/payments`, {
      amountMinor: 1_000,
      method: 'cash',
      date: '2026-11-15',
    });
    expect(future.statusCode).toBe(400);
    expect(future.json<{ error: { fields: Record<string, string> } }>().error.fields.date).toContain(
      'بعد اليوم',
    );
    const today = await post(store, `/v1/customers/${c.id}/payments`, {
      amountMinor: 1_000,
      method: 'cash',
      date: '2026-10-30',
    });
    expect(today.statusCode, today.body).toBe(201);
  });

  it('the same payment id twice settles once', async () => {
    const store = await openStore(app);
    const c = await add(store, { name: 'زبون' });
    await post(store, `/v1/customers/${c.id}/opening-debt`, { amountMinor: 5_000, date: '2026-10-01' });
    const id = randomUUID();
    const body = { amountMinor: 2_000, method: 'cash', id };
    const [a, b] = await Promise.all([
      post(store, `/v1/customers/${c.id}/payments`, body),
      post(store, `/v1/customers/${c.id}/payments`, body),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json<CustomerMoneyResult>().number).toBe(b.json<CustomerMoneyResult>().number);
    expect((await list(store, '')).items[0]!.balanceMinor).toBe(3_000);
  });
});

describe('a phone that is already a customer', () => {
  it('is refused when typed in Arabic digits too, and saved when the owner confirms', async () => {
    const store = await openStore(app);
    await add(store, { name: 'الأول', phone: '0933770026' });
    const dup = await post(store, '/v1/customers', { name: 'الثاني', phone: '٠٩٣٣٧٧٠٠٢٦' });
    expect(dup.statusCode, dup.body).toBe(409);
    expect(dup.json<{ error: { fields: Record<string, string> } }>().error.fields.phone).toBeTruthy();
    const ok = await post(store, '/v1/customers', {
      name: 'الثاني',
      phone: '٠٩٣٣٧٧٠٠٢٦',
      confirmDuplicate: true,
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe('the list asked of the database', () => {
  it('sorts by name both ways, searches with hamza and digits folded, filters by group and birthday month', async () => {
    const store = await openStore(app);
    const g = (
      await post(store, '/v1/customer-groups', { name: 'جملة كبار', discountBps: 500 })
    ).json<CustomerGroup>();
    expect(g.discountBps).toBe(500);
    const dupGroup = await post(store, '/v1/customer-groups', { name: 'جملة كبار', discountBps: 100 });
    expect(dupGroup.statusCode).toBe(400);
    await add(store, { name: 'أحمد', groupId: g.id, birthDate: '1990-11-12' });
    await add(store, { name: 'باسل', birthDate: '1985-03-03' });
    await add(store, { name: 'إبراهيم', phone: '0944555666', groupId: g.id, birthDate: '1980-11-02' });

    expect((await list(store, '?limit=10&sort=name&dir=asc')).items.map((c) => c.name)).toEqual([
      'أحمد',
      'إبراهيم',
      'باسل',
    ]);
    expect((await list(store, '?limit=10&sort=name&dir=desc')).items[0]!.name).toBe('باسل');
    // أ and إ are one letter in search
    expect((await list(store, '?q=' + encodeURIComponent('ابراهيم'))).items.map((c) => c.name)).toEqual([
      'إبراهيم',
    ]);
    expect((await list(store, '?q=' + encodeURIComponent('٠٩٤٤٥٥٥'))).items).toHaveLength(1);
    const inGroup = await list(store, `?groupId=${g.id}&limit=10`);
    expect(inGroup.items.map((c) => [c.name, c.groupDiscountBps])).toEqual([
      ['أحمد', 500],
      ['إبراهيم', 500],
    ]);
    const november = await list(store, '?birthMonth=11&limit=10');
    expect(november.items.map((c) => c.name)).toEqual(['إبراهيم', 'أحمد']);
    expect(november.totalCount).toBe(2);
    const sorted = await list(store, '?limit=10&sort=last&dir=asc');
    expect(sorted.items).toHaveLength(3);
    const spent = await list(store, '?limit=10&sort=spent');
    expect(spent.items).toHaveLength(3);
    const bad = await post(store, '/v1/customers', { name: 'ظ', groupId: randomUUID() });
    expect(bad.statusCode).toBe(400);
  });
});

describe('vouchers: expiry and void', () => {
  it('an expired voucher is not open, a voided one moves 2310 to 4920 once', async () => {
    const store = await openStore(app);
    const sqlOwner = ownerDb();
    for (const [code, amount] of [
      ['GFT-1', 30_000],
      ['GFT-2', 20_000],
    ] as const) {
      await sqlOwner`insert into vouchers (tenant_id, id, code, return_id, kind, currency, amount_minor)
        values (${store.tenantId}, ${randomUUID()}, ${code}, ${randomUUID()}, 'gift', 'SYP', ${amount})`;
    }
    const put = (code: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: `/v1/vouchers/${code}`, headers: as(store), payload });
    const open = async (qs = '') =>
      (await app.inject({ method: 'GET', url: `/v1/vouchers${qs}`, headers: as(store) })).json<VoucherList>();
    expect((await open()).items).toHaveLength(2);

    expect((await put('GFT-1', { expiresOn: '2026-10-01' })).statusCode).toBe(200);
    const afterExpiry = await open();
    expect(afterExpiry.items.map((v) => v.code)).toEqual(['GFT-2']);
    expect(afterExpiry.outstanding[0]!.amountMinor).toBe(20_000);
    const all = await open('?status=all');
    expect(all.items.find((v) => v.code === 'GFT-1')!.state).toBe('expired');
    expect((await open('?status=all&q=gft-2')).items).toHaveLength(1);

    const voided = await put('GFT-2', { void: true, reason: 'ضاعت' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await put('GFT-2', { void: true })).statusCode).toBe(409);
    expect((await open()).items).toHaveLength(0);
    const lines = await sqlOwner<{ code: string; debit: string; credit: string }[]>`
      select a.code, l.debit_minor::text as debit, l.credit_minor::text as credit
      from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.code in ('2310', '4920') order by a.code`;
    expect(lines).toEqual([
      { code: '2310', debit: '20000', credit: '0' },
      { code: '4920', debit: '0', credit: '20000' },
    ]);
    expect((await put('NOPE', { void: true })).statusCode).toBe(404);
  });
});
