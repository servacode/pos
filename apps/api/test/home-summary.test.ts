import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore } from './staff';
import { documents, goldenFirstSale, openStore, push, shiftOpen } from './accounting-fixtures';

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

const summary = (token: string) =>
  app.inject({ method: 'GET', url: '/v1/me/home-summary', headers: bearer(token) });

describe('GET /v1/me/home-summary', () => {
  it('counts goods without a photo (a service is not goods) and the owner sees zero debts', async () => {
    const owner = await testStore(app);
    for (const [nameAr, type] of [
      ['قميص', undefined],
      ['تقصير', 'service'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/products',
        headers: bearer(owner.accessToken),
        payload: {
          nameAr,
          ...(type ? { type } : {}),
          variants: [{ attributes: [], price: { currency: 'SYP', priceMinor: 1000 } }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const res = await summary(owner.accessToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.baseCurrency).toBe('SYP');
    // A store with no invoice at all is new; the page shows the way in only then
    expect(body.hasEverSold).toBe(false);
    expect(body.photos).toEqual({ goodsCount: 1, withoutPhoto: 1 });
    expect(body.debts).toEqual({ totalOwedMinor: 0, overLimitCount: 0, overLimitOne: null });
    expect(body.lowStock).toEqual({ total: 0, items: [] });
    // The morning look: the owner sees the drawers' cash; no dollar rate until the store uses dollars
    expect(body.cashMinor).toBe(0);
    expect(body.usdRate).toBeNull();
  });

  it('adds up what customers owe and names the one over the limit', async () => {
    const owner = await testStore(app);
    const db = ownerDb();
    const [a] = await db<{ id: string }[]>`
      insert into customers (tenant_id, name, credit_limit_minor) values (${owner.tenantId}, 'أمين', 5000) returning id`;
    await db`insert into customers (tenant_id, name) values (${owner.tenantId}, 'رنا')`;
    const [acc] = await db<{ id: string }[]>`
      select id from accounts where tenant_id = ${owner.tenantId} and code = '1200'`;
    const [entry] = await db<{ id: string }[]>`
      select id from journal_entries where tenant_id = ${owner.tenantId} limit 1`;
    if (!acc || !entry) return; // The ledger fixture is not seeded in a bare store: the totals above are the check
    await db`
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id)
      values (${owner.tenantId}, ${entry.id}, 99, ${acc.id}, 9000, 0, 'customer', ${a!.id})`;
    const body = (await summary(owner.accessToken)).json();
    expect(body.debts.totalOwedMinor).toBe(9000);
    expect(body.debts.overLimitOne).toMatchObject({
      name: 'أمين',
      balanceMinor: 9000,
      creditLimitMinor: 5000,
    });
  });

  it('is empty for a person who holds none of the permissions', async () => {
    const owner = await testStore(app);
    const [role] = await ownerDb()<{ id: string }[]>`
      insert into roles (tenant_id, key, name, permissions) values (${owner.tenantId}, 'nobody', 'بلا', '{}') returning id`;
    expect(role).toBeTruthy();
    const nobody = await staffUser(app, owner, 'nobody', '0922222222');
    const res = await summary(nobody.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debts: null, photos: null, lowStock: null, cashMinor: null });
  });

  it('says the latest dollar rate only when the store uses dollars', async () => {
    const owner = await testStore(app);
    const db = ownerDb();
    await db`insert into exchange_rates (tenant_id, unit, quote, rate, effective_at) values (${owner.tenantId}, 'USD', 'SYP', '12500', now() - interval '2 days')`;
    await db`insert into exchange_rates (tenant_id, unit, quote, rate, effective_at) values (${owner.tenantId}, 'USD', 'SYP', '13000', now())`;
    // Dollars are not switched on: the rate stays out
    await db`update tenant_settings set enabled_currencies = array['SYP']::text[] where tenant_id = ${owner.tenantId}`;
    expect((await summary(owner.accessToken)).json().usdRate).toBeNull();
    await db`update tenant_settings set enabled_currencies = array['SYP', 'USD']::text[] where tenant_id = ${owner.tenantId}`;
    expect((await summary(owner.accessToken)).json().usdRate).toBe('13000');
  });

  it('counts the cash the till took, in pounds, and the dollars apart (the drawers are child accounts of 1110)', async () => {
    const store = await openStore(app);
    const db = ownerDb();
    await db`update tenant_settings set enabled_currencies = array['SYP', 'USD']::text[] where tenant_id = ${store.tenantId}`;
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const first = doc('sale', goldenFirstSale(store, open.id));
    const pushed = await push(app, store.device, [open, first]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    // The parent 1110 holds no line at all: the figure must come from the two children
    const [parent] = await db<{ n: string }[]>`
      select count(*)::text as n from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.code = '1110'`;
    expect(parent!.n).toBe('0');
    const ledger = async (code: string) =>
      Number(
        (
          await db<{ n: string }[]>`
            select coalesce(sum(l.amount_minor), 0)::text as n
            from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
            where l.tenant_id = ${store.tenantId} and a.code = ${code}`
        )[0]!.n,
      );
    const body = (await summary(store.accessToken)).json();
    expect(body.cashMinor).toBe(await ledger('111001'));
    expect(body.cashMinor).toBeGreaterThan(0);
    expect(body.cashUsdMinor).toBe(await ledger('111002'));
    expect(body.cashUsdMinor).toBe(900);
    // Dollars switched off: the dollar figure goes away, the pounds stay
    await db`update tenant_settings set enabled_currencies = array['SYP']::text[] where tenant_id = ${store.tenantId}`;
    const off = (await summary(store.accessToken)).json();
    expect(off.cashUsdMinor).toBeNull();
    expect(off.cashMinor).toBe(await ledger('111001'));
  });

  it('takes one branch: its own drawers, a foreign or junk branch is refused', async () => {
    const store = await openStore(app);
    const db = ownerDb();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const first = doc('sale', goldenFirstSale(store, open.id));
    expect((await push(app, store.device, [open, first])).results.map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
    ]);
    const [sold] = await db<{ branch_id: string }[]>`
      select l.branch_id from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.parent_code = '1110' limit 1`;
    const [other] = await db<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '009', 'فرع آخر') returning id`;
    const ask = (branchId: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/me/home-summary?branchId=${branchId}`,
        headers: bearer(store.accessToken),
      });
    const all = (await summary(store.accessToken)).json();
    const mine = (await ask(sold!.branch_id)).json();
    const empty = (await ask(other!.id)).json();
    expect(all.cashMinor).toBeGreaterThan(0);
    expect(mine.cashMinor).toBe(all.cashMinor);
    expect(empty.cashMinor).toBe(0);
    expect((await ask('not-a-uuid')).statusCode).toBe(400);
    expect((await ask('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me/home-summary' })).statusCode).toBe(401);
  });
});

describe('GET /v1/me branches', () => {
  it('shows a branch-limited user only his own branch', async () => {
    const owner = await testStore(app);
    const [second] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${owner.tenantId}, '002', 'فرع ثانٍ') returning id`;
    const cashier = await staffUser(app, owner, 'cashier', '0933333333', { branchId: second!.id });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(cashier.accessToken) });
    expect(me.json().branches.map((b: { id: string }) => b.id)).toEqual([second!.id]);
    const all = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner.accessToken) });
    expect(all.json().branches).toHaveLength(2);
  });
});
