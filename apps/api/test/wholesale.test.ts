import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Cheque, CustomerDetail, DayReport, ProductDetail, PullSetRows } from '@serva/core';
import { createDb, withTenant } from '@serva/db';
import type { PullResponse } from '@serva/sync';
import { checkIntegrity } from '../src/services/integrity';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
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
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { staffUser } from './staff';
import { TEST_OWNER_URL } from './urls';

/**
 * The wholesale mode on the server (03 › الجملة): a wholesale price per item and a tier per
 * customer, pulled by the tills; cheques that wait in 1160 until the owner marks them.
 */

let app: FastifyInstance;
const owner = createDb(TEST_OWNER_URL, { max: 1 });
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await owner.client.end();
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

async function pull(store: Store) {
  await settled();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  return res.json<PullResponse>().sets as unknown as {
    [K in keyof PullSetRows]: { upserts: PullSetRows[K][] };
  };
}

describe('wholesale prices and customers', () => {
  it('keeps a wholesale price per item and a tier per customer, and the till pulls both', async () => {
    const store = await openStore(app);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'رز 1 كغ',
        variants: [{ price: { currency: 'SYP', priceMinor: 20_000 }, wholesalePriceMinor: 17_500 }],
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const product = made.json<ProductDetail>();
    expect(product.variants[0]!.wholesalePriceMinor).toBe(17_500);
    const customer = await addCustomer(store, { name: 'بقالية النور', priceTier: 'wholesale' });
    expect(customer.priceTier).toBe('wholesale');

    const sets = await pull(store);
    expect(sets.prices.upserts.find((p) => p.variantId === product.variants[0]!.id)).toMatchObject({
      priceMinor: 20_000,
      wholesalePriceMinor: 17_500,
    });
    expect(sets.customers.upserts).toEqual([
      expect.objectContaining({ id: customer.id, priceTier: 'wholesale' }),
    ]);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${product.id}`,
      headers: as(store),
      payload: {
        version: product.version,
        variants: [{ id: product.variants[0]!.id, wholesalePriceMinor: null }],
      },
    });
    expect(edited.json<ProductDetail>().variants[0]!.wholesalePriceMinor).toBeNull();
    const back = await app.inject({
      method: 'PUT',
      url: `/v1/customers/${customer.id}`,
      headers: as(store),
      payload: { name: 'بقالية النور', priceTier: 'retail' },
    });
    expect(back.json<CustomerDetail>().priceTier).toBe('retail');
    const [log] = await ownerDb()<{ changes: Record<string, unknown> }[]>`
      select changes from audit_logs where action = 'customer.update'`;
    expect(log!.changes).toEqual({ priceTier: ['wholesale', 'retail'] });
  });

  it('gives the owner and the manager the wholesale price, not the cashier', async () => {
    const [ownerRole] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from roles where key in ('owner', 'manager') and 'sale.wholesale' = any(permissions)`;
    expect(ownerRole!.n).toBe(0);
    await openStore(app);
    const rows = await ownerDb()<{ key: string; has: boolean }[]>`
      select key, 'sale.wholesale' = any(permissions) as has from roles order by key`;
    expect(Object.fromEntries(rows.map((r) => [r.key, r.has]))).toEqual({
      cashier: false,
      manager: true,
      owner: true,
    });
  });
});

describe('cheques', () => {
  /** A sale of 500.00 paid 200 cash and 300 by cheque, and a payment of 100 by cheque */
  async function chequeDay(store: Store) {
    const customer = await addCustomer(store, { name: 'مؤسسة الفرات' });
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 50_000)],
        payments: [
          { method: 'cash', currency: 'SYP', amountMinor: 20_000 },
          { method: 'cheque', currency: 'SYP', amountMinor: 30_000, reference: 'CHQ-7781 2026-11-30' },
        ],
        customerId: customer.id,
        customerName: customer.name,
      }),
    );
    const paid = doc('receipt', {
      customerId: customer.id,
      customerName: customer.name,
      shiftId: open.id,
      cashierId: store.userId,
      currency: 'SYP',
      amountMinor: 10_000,
      method: 'cheque',
      reference: 'CHQ-9002',
      note: null,
    });
    const res = await push(app, store.device, [open, sold, paid]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    return { customer, sold, paid };
  }

  const list = async (store: Store, status = '') =>
    (
      await app.inject({
        method: 'GET',
        url: `/v1/cheques${status ? `?status=${status}` : ''}`,
        headers: as(store),
      })
    ).json<{ items: Cheque[] }>().items;
  const act = (store: Pick<Store, 'accessToken'>, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/cheques/actions', headers: as(store), payload: body });

  it('posts a cheque to 1160 for its customer, lists it, and the day report counts it', async () => {
    const store = await openStore(app);
    const { customer, sold, paid } = await chequeDay(store);
    const entries = await postedEntries(store.tenantId);
    expect(compact(entries.find((e) => e.sourceId === sold.id))).toEqual([
      ['111001', 20_000, 0],
      ['1160', 30_000, 0],
      ['4100', 0, 50_000],
    ]);
    expect(compact(entries.find((e) => e.sourceId === paid.id))).toEqual([
      ['1160', 10_000, 0],
      ['1200', 0, 10_000],
    ]);
    const items = await list(store);
    // Newest first: the same day, RCV after INV
    expect(items.map((c) => [c.sourceType, c.reference, c.amountMinor, c.status, c.customerName])).toEqual([
      ['receipt', 'CHQ-9002', 10_000, 'pending', 'مؤسسة الفرات'],
      ['sale', 'CHQ-7781 2026-11-30', 30_000, 'pending', 'مؤسسة الفرات'],
    ]);
    const day = (
      await app.inject({ method: 'GET', url: '/v1/reports/day?date=2026-10-30', headers: as(store) })
    ).json<DayReport>();
    expect(day.byMethod.map((m) => m.method)).toEqual(['cash', 'cheque']);
    expect(day.collections.byMethod).toEqual([
      { method: 'cheque', currency: 'SYP', amountMinor: 10_000, count: 1 },
    ]);
    // The customer paid 100 against nothing owed: the store owes them 100 until a cheque bounces.
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${customer.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(-10_000);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
  });

  it('a cashed cheque goes to the bank, a bounced one back onto the customer, each once', async () => {
    const store = await openStore(app);
    const { customer, sold, paid } = await chequeDay(store);
    const cashed = await act(store, {
      sourceType: 'sale',
      sourceId: sold.id,
      paymentNo: 2,
      action: 'cleared',
      date: '2026-11-02',
    });
    expect(cashed.statusCode, cashed.body).toBe(200);
    expect(cashed.json<Cheque>()).toMatchObject({ status: 'cleared', actionDate: '2026-11-02' });
    const bounced = await act(store, {
      sourceType: 'receipt',
      sourceId: paid.id,
      paymentNo: 1,
      action: 'bounced',
      date: '2026-11-03',
      note: 'رصيد غير كافٍ',
    });
    expect(bounced.json<Cheque>()).toMatchObject({ status: 'bounced', note: 'رصيد غير كافٍ' });

    const entries = (await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'cheque');
    expect(entries.map(compact)).toEqual([
      [
        ['1130', 30_000, 0],
        ['1160', 0, 30_000],
      ],
      [
        ['1200', 10_000, 0],
        ['1160', 0, 10_000],
      ],
    ]);
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/customers/${customer.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(detail.balanceMinor).toBe(0);
    expect(await list(store, 'pending')).toEqual([]);
    expect((await list(store, 'bounced')).map((c) => c.reference)).toEqual(['CHQ-9002']);

    const again = await act(store, {
      sourceType: 'sale',
      sourceId: sold.id,
      paymentNo: 2,
      action: 'bounced',
      date: '2026-11-04',
    });
    expect(again.statusCode).toBe(409);
    const early = await act(store, {
      sourceType: 'sale',
      sourceId: sold.id,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-11-04',
    });
    expect(early.statusCode).toBe(404);
    // The rebuild replays the documents and leaves the owner's marks as they are
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-11-05T00:00:00Z'),
    });
    expect(rebuilt.same).toBe(true);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems)).toEqual([]);
  });

  it('refuses a date before the cheque was taken, and the cashier cannot mark one', async () => {
    const store = await openStore(app);
    const { sold } = await chequeDay(store);
    const before = await act(store, {
      sourceType: 'sale',
      sourceId: sold.id,
      paymentNo: 2,
      action: 'cleared',
      date: '2026-10-01',
    });
    expect(before.statusCode).toBe(400);
    const cashier = await staffUser(
      app,
      {
        tenantId: store.tenantId,
        userId: store.userId,
        accessToken: store.accessToken,
        branchId: store.device.branchId,
      },
      'cashier',
      '0944000009',
    );
    const res = await act(cashier, {
      sourceType: 'sale',
      sourceId: sold.id,
      paymentNo: 2,
      action: 'cleared',
      date: '2026-11-02',
    });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/cheques', headers: as(cashier) })).statusCode).toBe(
      403,
    );
  });
});
