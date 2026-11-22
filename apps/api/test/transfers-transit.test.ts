import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InventoryResponse,
  ProductDetail,
  SupplierRow,
  TransferDetail,
  TransferFull,
  TransferRow,
  TransferSettings,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { openStore, type Store } from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Transfers «بالطريق» (round 37, decision 16): sending takes the goods out of the sender and waits; the receiving
 * branch confirms what arrived; a shortage is written off through the stocktake with its reason. At every step
 * the stock equals its movements, each branch's stock value equals account 1300 and the books balance.
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

async function setUp(tracked = false) {
  const store = await openStore(app);
  const [main] = await ownerDb()<
    { id: string }[]
  >`select id from branches where tenant_id = ${store.tenantId}`;
  const [mall] = await ownerDb()<{ id: string }[]>`
    insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع المول') returning id`;
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'قميص',
        ...(tracked ? { tracksSerial: true } : {}),
        variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
      },
    })
  ).json<ProductDetail>();
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const variantId = product.variants[0]!.id;
  // 10 shirts at 40.00 each into the main branch
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      branchId: main!.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [
        tracked
          ? { variantId, qty: 2000, costMinor: 80_000, serials: ['TR-1', 'TR-2'] }
          : { variantId, qty: 10_000, costMinor: 400_000 },
      ],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, main: main!.id, mall: mall!.id, variantId };
}

type Fixture = Awaited<ReturnType<typeof setUp>>;

const send = (f: Fixture, qty: number, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/transfers',
    headers: as(f.store),
    payload: {
      fromBranchId: f.main,
      toBranchId: f.mall,
      date: '2026-10-30',
      lines: [{ variantId: f.variantId, qty }],
      ...extra,
    },
  });

const receive = (f: Fixture, id: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/v1/transfers/${id}/receive`,
    headers: as(f.store),
    payload: { date: '2026-11-02', ...payload },
  });

async function stockAt(f: Fixture) {
  const stock = (
    await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(f.store) })
  ).json<InventoryResponse>();
  const at = (branch: string) =>
    stock.items.find((r) => r.branchId === branch && r.variantId === f.variantId);
  return {
    main: [at(f.main)?.qty ?? 0, at(f.main)?.valueMinor ?? 0],
    mall: [at(f.mall)?.qty ?? 0, at(f.mall)?.valueMinor ?? 0],
  };
}

/** The books of the store: balanced, 1900 net, each branch's stock against 1300, and every integrity check */
async function books(f: Fixture) {
  const report = await withTenant(appDb().db, f.store.tenantId, (tx) => checkIntegrity(tx, f.store.tenantId));
  const [totals] = await ownerDb()<{ debit: string; credit: string }[]>`
    select coalesce(sum(l.debit_minor), 0)::text as debit, coalesce(sum(l.credit_minor), 0)::text as credit
    from journal_lines l where l.tenant_id = ${f.store.tenantId}`;
  const [transit] = await ownerDb()<{ net: string }[]>`
    select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as net
    from journal_lines l join accounts a on a.id = l.account_id
    where l.tenant_id = ${f.store.tenantId} and a.code = '1900'`;
  return {
    problems: report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`)),
    balanced: totals!.debit === totals!.credit,
    transitMinor: Number(transit!.net),
  };
}

describe('a transfer sent «بالطريق»', () => {
  it('is in transit by default for a store with two branches: out of the sender, in no one’s stock', async () => {
    const f = await setUp();
    const res = await send(f, 4000);
    expect(res.statusCode, res.body).toBe(201);
    const t = res.json<TransferDetail>();
    expect(t).toMatchObject({ status: 'in_transit', valueMinor: 160_000 });

    // The sender lost 4, the receiver has not got them yet
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [0, 0] });
    // Only the sender's half is booked: Dr 1900 / Cr 1300, and 1900 holds the value on the way
    const entries = await ownerDb()<{ branch: string; code: string }[]>`
      select e.branch_id as branch, a.code from journal_lines l
      join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      where e.tenant_id = ${f.store.tenantId} and e.source_type = 'transfer' order by a.code`;
    expect(entries.map((e) => [e.branch === f.main ? 'main' : 'mall', e.code])).toEqual([
      ['main', '1300'],
      ['main', '1900'],
    ]);
    const state = await books(f);
    expect(state).toEqual({ problems: [], balanced: true, transitMinor: 160_000 });

    const list = (await app.inject({ method: 'GET', url: '/v1/transfers', headers: as(f.store) })).json<{
      items: TransferRow[];
    }>();
    expect(list.items[0]).toMatchObject({ id: t.id, status: 'in_transit', toBranchId: f.mall });
    const one = (
      await app.inject({ method: 'GET', url: `/v1/transfers/${t.id}`, headers: as(f.store) })
    ).json<TransferFull>();
    expect(one).toMatchObject({
      status: 'in_transit',
      lines: [{ qty: 4000, receivedQty: null, shortQty: 0 }],
      receipt: null,
    });
  });

  it('enters the receiver when it confirms everything, once only, with 1900 back to nothing', async () => {
    const f = await setUp();
    const t = (await send(f, 4000)).json<TransferDetail>();
    const done = await receive(f, t.id);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<TransferFull>()).toMatchObject({
      status: 'received',
      lines: [{ qty: 4000, receivedQty: 4000, shortQty: 0 }],
      receipt: { shortPieces: 0, stocktakeNumber: null },
    });
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [4000, 160_000] });
    expect(await books(f)).toEqual({ problems: [], balanced: true, transitMinor: 0 });
    // The movements say the same: the sender -4, the receiver +4
    const moves = await ownerDb()<{ branch: string; qty: string }[]>`
      select branch_id as branch, sum(qty)::text as qty from stock_movements
      where tenant_id = ${f.store.tenantId} and kind = 'transfer' group by branch_id`;
    expect(
      Object.fromEntries(moves.map((m) => [m.branch === f.main ? 'main' : 'mall', Number(m.qty)])),
    ).toEqual({
      main: -4000,
      mall: 4000,
    });

    const again = await receive(f, t.id);
    expect(again.statusCode).toBe(409);
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [4000, 160_000] });
  });

  it('shows a shortage and writes it off through the stocktake, and asks for a reason', async () => {
    const f = await setUp();
    const t = (await send(f, 4000)).json<TransferDetail>();

    // Short, with no reason: refused, and nothing moved
    const bare = await receive(f, t.id, { lines: [{ variantId: f.variantId, receivedQty: 3000 }] });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.fields.reason).toBeTruthy();
    // More than was sent: refused
    const more = await receive(f, t.id, { lines: [{ variantId: f.variantId, receivedQty: 5000 }] });
    expect(more.statusCode).toBe(400);
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [0, 0] });

    const done = await receive(f, t.id, {
      lines: [{ variantId: f.variantId, receivedQty: 3000 }],
      reason: 'قطعة ضاعت في الطريق',
    });
    expect(done.statusCode, done.body).toBe(200);
    const full = done.json<TransferFull>();
    expect(full).toMatchObject({
      status: 'received',
      lines: [{ qty: 4000, receivedQty: 3000, shortQty: 1000 }],
      receipt: { shortPieces: 1000, shortValueMinor: 40_000, reason: 'قطعة ضاعت في الطريق' },
    });
    expect(full.receipt?.stocktakeNumber).toMatch(/^STK-/);
    // 3 arrived; the lost one is a loss at 40.00 on 6300
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [3000, 120_000] });
    const [loss] = await ownerDb()<{ debit: string }[]>`
      select coalesce(sum(l.debit_minor), 0)::text as debit from journal_lines l
      join accounts a on a.id = l.account_id join journal_entries e on e.id = l.entry_id
      where l.tenant_id = ${f.store.tenantId} and a.code = '6300' and e.source_type = 'stocktake'`;
    expect(Number(loss!.debit)).toBe(40_000);
    expect(await books(f)).toEqual({ problems: [], balanced: true, transitMinor: 0 });

    const list = (await app.inject({ method: 'GET', url: '/v1/transfers', headers: as(f.store) })).json<{
      items: TransferRow[];
    }>();
    expect(list.items[0]).toMatchObject({ status: 'received', shortPieces: 1000 });
  });

  it('keeps the old one-step behaviour when the store chooses instant, and by request', async () => {
    const f = await setUp();
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/transfers/settings',
      headers: as(f.store),
      payload: { mode: 'instant' },
    });
    expect(put.json<TransferSettings>()).toEqual({ mode: 'instant', effective: 'instant' });
    const t = (await send(f, 4000)).json<TransferDetail>();
    expect(t.status).toBe('received');
    expect(await stockAt(f)).toEqual({ main: [6000, 240_000], mall: [4000, 160_000] });
    // An instant transfer has nothing to confirm
    expect((await receive(f, t.id)).statusCode).toBe(409);
    expect(await books(f)).toEqual({ problems: [], balanced: true, transitMinor: 0 });

    // Back to automatic: two branches means in transit again; a request can still ask for the one step
    const auto = await app.inject({
      method: 'PUT',
      url: '/v1/transfers/settings',
      headers: as(f.store),
      payload: { mode: 'auto' },
    });
    expect(auto.json<TransferSettings>()).toEqual({ mode: 'auto', effective: 'transit' });
    const asked = (await send(f, 1000, { mode: 'instant' })).json<TransferDetail>();
    expect(asked.status).toBe('received');
    const way = (await send(f, 1000)).json<TransferDetail>();
    expect(way.status).toBe('in_transit');
    expect(await books(f)).toEqual({ problems: [], balanced: true, transitMinor: 40_000 });
  });

  it('a van’s loading stays instant whatever the setting says', async () => {
    const f = await setUp();
    const [van] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name, kind, parent_branch_id)
      values (${f.store.tenantId}, '003', 'سيارة', 'van', ${f.main}) returning id`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: as(f.store),
      payload: {
        fromBranchId: f.main,
        toBranchId: van!.id,
        date: '2026-10-30',
        lines: [{ variantId: f.variantId, qty: 2000 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<TransferDetail>().status).toBe('received');
    expect(await books(f)).toEqual({ problems: [], balanced: true, transitMinor: 0 });
  });

  it('refuses a user with no permission and an unknown transfer', async () => {
    const f = await setUp();
    const t = (await send(f, 1000)).json<TransferDetail>();
    const ghost = await app.inject({
      method: 'POST',
      url: '/v1/transfers/00000000-0000-7000-8000-000000000000/receive',
      headers: as(f.store),
      payload: {},
    });
    expect(ghost.statusCode).toBe(404);
    const anon = await app.inject({ method: 'POST', url: `/v1/transfers/${t.id}/receive`, payload: {} });
    expect(anon.statusCode).toBe(401);
  });
});

describe('serial numbers on the way', () => {
  it('wait in transit, arrive with what the receiver confirms, and the rest are lost', async () => {
    const f = await setUp(true);
    const sent = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: as(f.store),
      payload: {
        fromBranchId: f.main,
        toBranchId: f.mall,
        date: '2026-10-30',
        lines: [{ variantId: f.variantId, qty: 2000, serials: ['TR-1', 'TR-2'] }],
      },
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const t = sent.json<TransferDetail>();
    const status = async () =>
      Object.fromEntries(
        (
          await ownerDb()<{ serial: string; status: string; branch_id: string }[]>`
            select serial, status, branch_id from serials where tenant_id = ${f.store.tenantId} order by serial`
        ).map((r) => [r.serial, [r.status, r.branch_id === f.mall ? 'mall' : 'main']]),
      );
    expect(await status()).toEqual({ 'TR-1': ['in_transit', 'main'], 'TR-2': ['in_transit', 'main'] });

    // One piece arrived: its number is named, the other is lost
    const noNumbers = await receive(f, t.id, {
      lines: [{ variantId: f.variantId, receivedQty: 1000 }],
      reason: 'ضاعت',
    });
    expect(noNumbers.statusCode).toBe(400);
    const done = await receive(f, t.id, {
      lines: [{ variantId: f.variantId, receivedQty: 1000, serials: ['TR-2'] }],
      reason: 'ضاعت',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(await status()).toEqual({ 'TR-1': ['lost', 'main'], 'TR-2': ['in_stock', 'mall'] });
    expect((await books(f)).problems).toEqual([]);
  });
});
