import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomerDetail, CustomerListResponse, DayReport, ShiftReport } from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
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
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Customers, credit sales and payments (packages/core › contracts/customers.ts; 08 › سند قبض):
 * the owner keeps the customers, a till sells on credit and takes payments, and what each owes
 * is read from the ledger.
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

async function addCustomer(store: Store, body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/v1/customers', headers: as(store), payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CustomerDetail>();
}

/** A shift, and a sale of 300.00 on credit to the customer */
async function creditDay(store: Store, customerId: string, customerName = 'أبو خالد') {
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 30_000)],
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 30_000 }],
      customerId,
      customerName,
    }),
  );
  const res = await push(app, store.device, [open, sold]);
  return { doc, open, sold, res };
}

const receipt = (
  store: Store,
  shiftId: string,
  customerId: string,
  amountMinor: number,
  method = 'cash',
) => ({
  customerId,
  customerName: 'أبو خالد',
  shiftId,
  cashierId: store.userId,
  currency: 'SYP',
  amountMinor,
  method,
  reference: method === 'cash' ? null : 'W-1',
  note: null,
});

describe('the owner’s customers', () => {
  it('adds, finds by name or phone, edits and archives a customer, each change in the audit log', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'أبو خالد', phone: '0933111222', creditLimitMinor: 50_000 });
    expect(c).toMatchObject({
      name: 'أبو خالد',
      phone: '+963933111222',
      creditLimitMinor: 50_000,
      balanceMinor: 0,
    });
    await addCustomer(store, { name: 'مطعم الياسمين' });

    const find = async (q: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/customers?q=${encodeURIComponent(q)}`,
          headers: as(store),
        })
      )
        .json<CustomerListResponse>()
        .items.map((i) => i.name);
    expect(await find('خالد')).toEqual(['أبو خالد']);
    expect(await find('0933111')).toEqual(['أبو خالد']);
    expect(await find('ياسمين')).toEqual(['مطعم الياسمين']);

    const edited = await app.inject({
      method: 'PUT',
      url: `/v1/customers/${c.id}`,
      headers: as(store),
      payload: { name: 'أبو خالد الحلبي', creditLimitMinor: null, archived: true },
    });
    expect(edited.json<CustomerDetail>()).toMatchObject({
      name: 'أبو خالد الحلبي',
      creditLimitMinor: null,
      archived: true,
    });
    const logs = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${store.tenantId} and entity = 'customer' order by created_at`;
    expect(logs.map((l) => l.action)).toEqual(['customer.create', 'customer.create', 'customer.update']);
  });

  it('says what is wrong in Arabic, and keeps customers to those allowed', async () => {
    const store = await openStore(app);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: as(store),
      payload: { name: 'ا', phone: '12' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.name).toBe('اكتب اسم الزبون');
    const cashier = await staffUser(
      app,
      { ...store, branchId: store.device.branchId },
      'cashier',
      '0944000002',
    );
    expect((await app.inject({ method: 'GET', url: '/v1/customers', headers: as(cashier) })).statusCode).toBe(
      403,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/customers',
          headers: as(cashier),
          payload: { name: 'زبون' },
        })
      ).statusCode,
    ).toBe(403);
    const other = await openStore(app, '0955000000');
    const c = await addCustomer(store, { name: 'أبو خالد' });
    expect(
      (await app.inject({ method: 'GET', url: `/v1/customers/${c.id}`, headers: as(other) })).statusCode,
    ).toBe(404);
  });
});

describe('selling on credit and taking payments', () => {
  it('a credit sale puts the debt on the customer, a payment takes it off, and the statement shows both', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'أبو خالد' });
    const { doc, open, sold } = await creditDay(store, c.id);
    const paid = doc('receipt', receipt(store, open.id, c.id, 12_000));
    const res = await push(app, store.device, [paid]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: [] });
    expect(paid.number).toBe('RCV-001-002-0000001');

    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'receipt');
    expect(compact(entry)).toEqual([
      ['111001', 12_000, 0],
      ['1200', 0, 12_000],
    ]);
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${c.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(18_000);
    expect(
      detail.statement.map((l) => [l.sourceType, l.sourceId, l.debitMinor, l.creditMinor, l.balanceMinor]),
    ).toEqual([
      ['sale', sold.id, 30_000, 0, 30_000],
      ['receipt', paid.id, 0, 12_000, 18_000],
    ]);
    const list = (
      await app.inject({ method: 'GET', url: '/v1/customers?owing=true', headers: as(store) })
    ).json<CustomerListResponse>();
    expect(list).toMatchObject({ totalOwedMinor: 18_000, items: [{ id: c.id, balanceMinor: 18_000 }] });

    // The payment is in the drawer of the shift, the day report and the integrity check
    const shift = (
      await app.inject({ method: 'GET', url: `/v1/shifts/${open.id}`, headers: as(store) })
    ).json<ShiftReport>();
    expect(shift.byCurrency[0]).toMatchObject({ receiptsMinor: 12_000, expectedMinor: 112_000 });
    const day = (
      await app.inject({ method: 'GET', url: '/v1/reports/day?date=2026-10-30', headers: as(store) })
    ).json<DayReport>();
    expect(day.collections).toEqual({
      count: 1,
      totalMinor: 12_000,
      byMethod: [{ method: 'cash', currency: 'SYP', amountMinor: 12_000, count: 1 }],
    });
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
  });

  it('a payment by wallet goes to 1150 with its reference, not to the drawer', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'أبو خالد' });
    const { doc, open } = await creditDay(store, c.id);
    await push(app, store.device, [doc('receipt', receipt(store, open.id, c.id, 30_000, 'wallet'))]);
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'receipt');
    expect(compact(entry)).toEqual([
      ['1150', 30_000, 0],
      ['1200', 0, 30_000],
    ]);
  });

  it('a credit sale over the customer’s limit is accepted and flagged', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'أبو خالد', creditLimitMinor: 20_000 });
    const { res } = await creditDay(store, c.id);
    expect(res.results[1]).toMatchObject({ status: 'accepted' });
    expect(res.results[1]!.flags).toContain('credit_limit_exceeded');
  });
});

describe('a customer added on the till', () => {
  it('is stored under its document’s id, reaches the other tills, and a known phone is flagged', async () => {
    const store = await openStore(app);
    await addCustomer(store, { name: 'أبو خالد', phone: '0933111222' });
    const doc = documents(store.device);
    const fresh = doc('customer', { name: 'أم سامر', phone: null, createdBy: store.userId });
    const twin = doc('customer', { name: 'أبو خالد', phone: '+963933111222', createdBy: store.userId });
    const res = await push(app, store.device, [fresh, twin]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', []],
      ['accepted', ['duplicate_customer']],
    ]);
    const rows = await ownerDb()<{ id: string; name: string }[]>`
      select id, name from customers where tenant_id = ${store.tenantId} and created_by_doc is not null order by name`;
    expect(rows).toEqual([
      { id: twin.id, name: 'أبو خالد' },
      { id: fresh.id, name: 'أم سامر' },
    ]);
    const pulled = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    expect(pulled.statusCode, pulled.body).toBe(200);
    expect(JSON.stringify(pulled.json())).toContain('أم سامر');
  });
});

describe('money taken from the admin: a payment and an opening debt', () => {
  const pay = (store: Pick<Store, 'accessToken'>, id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/v1/customers/${id}/payments`, headers: as(store), payload: body });

  it('an opening debt and a payment move the balance, post balanced entries and show in the statement', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'أبو خالد' });

    const debt = await app.inject({
      method: 'POST',
      url: `/v1/customers/${c.id}/opening-debt`,
      headers: as(store),
      payload: { amountMinor: 80_000, date: '2026-11-01' },
    });
    expect(debt.statusCode, debt.body).toBe(201);
    expect(debt.json()).toMatchObject({
      kind: 'opening_debt',
      balanceBeforeMinor: 0,
      balanceAfterMinor: 80_000,
    });

    const paid = await pay(store, c.id, {
      amountMinor: 30_000,
      method: 'cash',
      note: 'دفعة أولى',
      date: '2026-11-02',
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const voucher = paid.json<{ number: string; balanceBeforeMinor: number; balanceAfterMinor: number }>();
    expect(voucher.number).toMatch(/^RCA-\d{4}-000001$/);
    expect(voucher).toMatchObject({ balanceBeforeMinor: 80_000, balanceAfterMinor: 50_000 });

    const bank = await pay(store, c.id, {
      amountMinor: 10_000,
      method: 'transfer',
      reference: 'TR-77',
      date: '2026-11-03',
    });
    expect(bank.statusCode, bank.body).toBe(201);

    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${c.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(40_000);
    expect(detail.statement.map((l) => [l.debitMinor, l.creditMinor])).toEqual([
      [80_000, 0],
      [0, 30_000],
      [0, 10_000],
    ]);

    // The money went to the safe and the bank, against 1200; the entries balance
    const rows = await ownerDb()<{ code: string; debit: string; credit: string }[]>`
      select a.code, sum(l.debit_minor)::text as debit, sum(l.credit_minor)::text as credit
      from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} group by a.code order by a.code`;
    const by = Object.fromEntries(rows.map((r) => [r.code, [Number(r.debit), Number(r.credit)]]));
    const safe = Object.entries(by).find(([code]) => code.startsWith('1120'));
    expect(safe?.[1]).toEqual([30_000, 0]);
    expect(by['1130']).toEqual([10_000, 0]);
    expect(by['1200']).toEqual([80_000, 40_000]);
    expect(by['3900']).toEqual([0, 80_000]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
  });

  it('a payment sent twice with the same id posts once; wrong input and wrong people are refused in Arabic', async () => {
    const store = await openStore(app);
    const c = await addCustomer(store, { name: 'زبون' });
    const id = '0190e2b0-0000-7000-8000-000000000001';
    const first = await pay(store, c.id, { id, amountMinor: 5_000, method: 'cash' });
    const again = await pay(store, c.id, { id, amountMinor: 5_000, method: 'cash' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    const [count] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from journal_entries where tenant_id = ${store.tenantId} and source_id = ${id}`;
    expect(count?.n).toBe('1');

    const noRef = await pay(store, c.id, { amountMinor: 5_000, method: 'transfer' });
    expect(noRef.statusCode).toBe(400);
    expect(noRef.json().error.fields.reference).toBe('اكتب رقم الحوالة أو العملية');
    const zero = await pay(store, c.id, { amountMinor: 0, method: 'cash' });
    expect(zero.statusCode).toBe(400);
    expect(JSON.stringify(zero.json())).not.toContain('Invalid');
    const missing = await pay(store, '0190e2b0-0000-7000-8000-0000000000ff', {
      amountMinor: 5,
      method: 'cash',
    });
    expect(missing.statusCode).toBe(404);

    const cashier = await staffUser(
      app,
      { ...store, branchId: store.device.branchId },
      'cashier',
      '0944000003',
    );
    // A cashier may take a payment (receipt.create) but not post an opening balance (accounting.post)
    expect((await pay(cashier, c.id, { amountMinor: 1_000, method: 'cash' })).statusCode).toBe(201);
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/customers/${c.id}/opening-debt`,
      headers: as(cashier),
      payload: { amountMinor: 1_000 },
    });
    expect(denied.statusCode).toBe(403);
  });
});
