import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InventoryResponse,
  StocktakeListResponse,
  ProductDetail,
  SupplierRow,
  TransferDetail,
  TransferFull,
  TransferListResponse,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { openStore, type Store } from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Round 44, inventory: a transfer on the way can be cancelled by its sender, a typing slip is refused, a branch
 * role sends only from its own branch, the list always shows what is on the way, a count never takes the same
 * item twice, the stock list names its branch and carries the clock a write-off counts from.
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

async function setUp() {
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
      payload: { nameAr: 'قميص', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const variantId = product.variants[0]!.id;
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      branchId: main!.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId, qty: 10_000, costMinor: 400_000 }],
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

async function stockAt(f: Fixture) {
  const stock = (
    await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(f.store) })
  ).json<InventoryResponse>();
  const at = (branch: string) =>
    stock.items.find((r) => r.branchId === branch && r.variantId === f.variantId);
  return { main: [at(f.main)?.qty ?? 0, at(f.main)?.valueMinor ?? 0], mall: at(f.mall)?.qty ?? 0, stock };
}

async function books(f: Fixture) {
  const report = await withTenant(appDb().db, f.store.tenantId, (tx) => checkIntegrity(tx, f.store.tenantId));
  const [transit] = await ownerDb()<{ net: string }[]>`
    select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as net
    from journal_lines l join accounts a on a.id = l.account_id
    where l.tenant_id = ${f.store.tenantId} and a.code = '1900'`;
  return {
    problems: report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`)),
    transitMinor: Number(transit!.net),
  };
}

describe('cancelling a transfer on the way', () => {
  it('brings the goods and their value back to the sender and closes account 1900', async () => {
    const f = await setUp();
    const sent = (await send(f, 4000)).json<TransferDetail>();
    expect(sent.status).toBe('in_transit');
    expect((await stockAt(f)).main).toEqual([6000, 240_000]);
    expect((await books(f)).transitMinor).toBe(160_000);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/cancel`,
      headers: as(f.store),
      payload: { date: '2026-10-31', reason: 'كمية خاطئة' },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json<TransferFull>()).toMatchObject({ status: 'cancelled' });
    expect((await stockAt(f)).main).toEqual([10_000, 400_000]);
    expect((await stockAt(f)).mall).toBe(0);
    const after = await books(f);
    expect(after.transitMinor).toBe(0);
    expect(after.problems).toEqual([]);

    // The list says cancelled, and neither a second cancel nor a receipt is possible
    const list = (
      await app.inject({ method: 'GET', url: '/v1/transfers', headers: as(f.store) })
    ).json<TransferListResponse>();
    expect(list.items.find((t) => t.id === sent.id)).toMatchObject({ status: 'cancelled', canCancel: false });
    expect(list.inTransit).toBe(0);
    const again = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/cancel`,
      headers: as(f.store),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    const late = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/receive`,
      headers: as(f.store),
      payload: { date: '2026-11-02' },
    });
    expect(late.statusCode).toBe(409);
  });

  it('is refused after the goods were received, and a date before the sending is refused', async () => {
    const f = await setUp();
    const sent = (await send(f, 2000)).json<TransferDetail>();
    const early = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/cancel`,
      headers: as(f.store),
      payload: { date: '2026-10-01' },
    });
    expect(early.statusCode).toBe(400);
    const early2 = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/receive`,
      headers: as(f.store),
      payload: { date: '2026-10-01' },
    });
    expect(early2.statusCode).toBe(400);
    const got = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/receive`,
      headers: as(f.store),
      payload: { date: '2026-11-02' },
    });
    expect(got.statusCode, got.body).toBe(200);
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/cancel`,
      headers: as(f.store),
      payload: {},
    });
    expect(cancel.statusCode).toBe(409);
  });
});

describe('sending a transfer', () => {
  it('refuses more than the sender holds when the screen asks for it, and allows it when it does not', async () => {
    const f = await setUp();
    const slip = await send(f, 999_000, { strictStock: true });
    expect(slip.statusCode, slip.body).toBe(400);
    expect(JSON.stringify(slip.json())).toContain('lines.0.qty');
    expect((await stockAt(f)).main).toEqual([10_000, 400_000]);
    // Without the flag the till's rule holds: stock may go below nothing
    expect((await send(f, 11_000)).statusCode).toBe(201);
  });

  it('refuses the same item twice on a transfer that goes on the way', async () => {
    const f = await setUp();
    const twice = await send(f, 1000, {
      mode: 'transit',
      lines: [
        { variantId: f.variantId, qty: 1000 },
        { variantId: f.variantId, qty: 2000 },
      ],
    });
    expect(twice.statusCode).toBe(400);
  });

  it('is refused for a role that holds the right in the receiving branch only', async () => {
    const f = await setUp();
    const keeper = await staffUser(
      app,
      {
        tenantId: f.store.tenantId,
        userId: f.store.userId,
        accessToken: f.store.accessToken,
        branchId: f.mall,
      },
      'storekeeper',
      '0922222222',
      { branchId: f.mall },
    );
    const h = { authorization: `Bearer ${keeper.accessToken}` };
    const out = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: h,
      payload: {
        fromBranchId: f.main,
        toBranchId: f.mall,
        date: '2026-10-30',
        lines: [{ variantId: f.variantId, qty: 1000 }],
      },
    });
    expect(out.statusCode).toBe(403);
    expect((await stockAt(f)).main).toEqual([10_000, 400_000]);
  });
});

describe('the transfers list', () => {
  it('always shows what is still on the way, however old, and pages the rest', async () => {
    const f = await setUp();
    const old = (await send(f, 1000, { mode: 'transit', date: '2026-09-01' })).json<TransferDetail>();
    for (let i = 0; i < 3; i++) {
      const t = (await send(f, 100, { mode: 'instant', date: `2026-10-0${i + 1}` })).json<TransferDetail>();
      expect(t.status).toBe('received');
    }
    const first = (
      await app.inject({ method: 'GET', url: '/v1/transfers?limit=2', headers: as(f.store) })
    ).json<TransferListResponse>();
    expect(first.inTransit).toBe(1);
    expect(first.items.map((t) => t.id)).toContain(old.id);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items.find((t) => t.id === old.id)).toMatchObject({ canReceive: true, canCancel: true });
    const second = (
      await app.inject({
        method: 'GET',
        url: `/v1/transfers?limit=2&cursor=${first.nextCursor}`,
        headers: as(f.store),
      })
    ).json<TransferListResponse>();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((t) => t.id)).not.toContain(old.id);
  });
});

describe('counts and the stock list', () => {
  it('a count that names an item twice is refused, not applied twice', async () => {
    const f = await setUp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(f.store),
      payload: {
        date: '2026-10-30',
        branchId: f.main,
        lines: [
          { variantId: f.variantId, countedQty: 7000 },
          { variantId: f.variantId, countedQty: 5000 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await stockAt(f)).main).toEqual([10_000, 400_000]);
  });

  it('the stock list names each branch and carries the clock a write-off counts from', async () => {
    const f = await setUp();
    const { stock } = await stockAt(f);
    expect(stock.items[0]).toMatchObject({ branchName: expect.any(String), branchKind: 'store' });
    expect(Date.parse(stock.asOf!)).not.toBeNaN();
  });

  it('a write-off made from an older list takes only what it says, not what sold meanwhile', async () => {
    const f = await setUp();
    const { stock } = await stockAt(f);
    await new Promise((r) => setTimeout(r, 50));
    // 2 go off the shelf after the list was read
    const moved = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(f.store),
      payload: {
        date: '2026-10-30',
        branchId: f.main,
        lines: [{ variantId: f.variantId, countedQty: 8000 }],
      },
    });
    expect(moved.statusCode, moved.body).toBe(201);
    // The owner records a waste of 3 from the list that said 10
    const waste = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(f.store),
      payload: {
        date: '2026-10-30',
        branchId: f.main,
        countedAt: stock.asOf,
        note: 'هدر',
        lines: [{ variantId: f.variantId, countedQty: 7000, wasteReason: 'انكسر' }],
      },
    });
    expect(waste.statusCode, waste.body).toBe(201);
    expect((await stockAt(f)).main[0]).toBe(5000);
  });
});

describe('the counts already made', () => {
  it('lists a count with its branch, who made it and what kind it was', async () => {
    const f = await setUp();
    const counted = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(f.store),
      payload: {
        date: '2026-10-30',
        branchId: f.main,
        lines: [{ variantId: f.variantId, countedQty: 9000 }],
      },
    });
    expect(counted.statusCode, counted.body).toBe(201);
    const waste = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(f.store),
      payload: {
        date: '2026-10-31',
        branchId: f.main,
        note: 'هدر',
        lines: [{ variantId: f.variantId, countedQty: 8000, wasteReason: 'انكسر' }],
      },
    });
    expect(waste.statusCode, waste.body).toBe(201);
    const list = (
      await app.inject({ method: 'GET', url: '/v1/stocktakes?limit=1', headers: as(f.store) })
    ).json<StocktakeListResponse>();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'waste', branchId: f.main, items: 1 });
    expect(list.items[0]!.by).not.toBe('');
    expect(list.nextCursor).toBeTruthy();
    const next = (
      await app.inject({
        method: 'GET',
        url: `/v1/stocktakes?limit=1&cursor=${list.nextCursor}`,
        headers: as(f.store),
      })
    ).json<StocktakeListResponse>();
    expect(next.items[0]).toMatchObject({ kind: 'count', diffValueMinor: -40_000 });
  });
});

describe('a role given for one branch', () => {
  it('reads the stock, the transfers and the expiry of its own branch only, and cannot recall or block', async () => {
    const f = await setUp();
    const manager = await staffUser(
      app,
      {
        tenantId: f.store.tenantId,
        userId: f.store.userId,
        accessToken: f.store.accessToken,
        branchId: f.mall,
      },
      'manager',
      '0933333333',
      { branchId: f.mall },
    );
    const h = { authorization: `Bearer ${manager.accessToken}` };
    // The owner moves 3 shirts to the mall and keeps 2 on the way to nobody-else's branch: the list of the mall's manager
    const sent = (await send(f, 3000)).json<TransferDetail>();
    // The manager's stock list has no row of the main branch
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: h })
    ).json<InventoryResponse>();
    expect(stock.items.every((r) => r.branchId === f.mall)).toBe(true);
    const asked = await app.inject({ method: 'GET', url: `/v1/inventory?branchId=${f.main}`, headers: h });
    expect(asked.statusCode).toBe(403);
    // He sees the transfer that comes to his branch, and can receive but not cancel it
    const list = (
      await app.inject({ method: 'GET', url: '/v1/transfers', headers: h })
    ).json<TransferListResponse>();
    expect(list.items.find((t) => t.id === sent.id)).toMatchObject({ canReceive: true, canCancel: false });
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/transfers/${sent.id}/cancel`,
      headers: h,
      payload: {},
    });
    expect(cancel.statusCode).toBe(403);
    // A recall and a block are store-wide
    expect(
      (await app.inject({ method: 'GET', url: '/v1/batches/recall?batchNo=X1', headers: h })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/batches/block', headers: h, payload: { batchNo: 'X1' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/inventory/expiry?days=3650', headers: h })).statusCode,
    ).toBe(200);
  });
});
