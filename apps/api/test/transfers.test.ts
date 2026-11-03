import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InventoryResponse, ProductDetail, SupplierRow, TransferDetail, TransferRow } from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { openStore, type Store } from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Transfers between branches (09 › transfers): stock and its value move together, each branch balanced. */

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
      lines: [{ variantId: product.variants[0]!.id, qty: 10_000, costMinor: 400_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, main: main!.id, mall: mall!.id, variantId: product.variants[0]!.id };
}

describe('transfers between branches', () => {
  it('moves 4 shirts and their cost to the mall, each branch’s books with its stock', async () => {
    const { store, main, mall, variantId } = await setUp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/transfers',
      headers: as(store),
      payload: {
        fromBranchId: main,
        toBranchId: mall,
        date: '2026-10-30',
        note: 'للواجهة',
        lines: [{ variantId, qty: 4000 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const t = res.json<TransferDetail>();
    expect(t).toMatchObject({
      number: expect.stringMatching(/^TRF-/),
      valueMinor: 160_000,
      lines: [{ qty: 4000, valueMinor: 160_000 }],
    });

    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    const at = (branch: string) =>
      stock.items.find((r) => r.branchId === branch && r.variantId === variantId);
    expect([at(main)?.qty, at(main)?.valueMinor]).toEqual([6000, 240_000]);
    expect([at(mall)?.qty, at(mall)?.valueMinor]).toEqual([4000, 160_000]);

    const entries = await ownerDb()<{ branch: string; code: string; debit: string; credit: string }[]>`
      select e.branch_id as branch, a.code, l.debit_minor::text as debit, l.credit_minor::text as credit
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      where e.tenant_id = ${store.tenantId} and e.source_type = 'transfer' order by e.branch_id = ${main} desc, a.code`;
    expect(
      entries.map((e) => [e.branch === main ? 'main' : 'mall', e.code, Number(e.debit), Number(e.credit)]),
    ).toEqual([
      ['main', '1300', 0, 160_000],
      ['main', '1900', 160_000, 0],
      ['mall', '1300', 160_000, 0],
      ['mall', '1900', 0, 160_000],
    ]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`))).toEqual([]);

    const list = (await app.inject({ method: 'GET', url: '/v1/transfers', headers: as(store) })).json<{
      items: TransferRow[];
    }>();
    expect(list.items).toEqual([
      {
        id: t.id,
        number: t.number,
        date: '2026-10-30',
        fromBranch: expect.any(String),
        toBranch: 'فرع المول',
        pieces: 4000,
        valueMinor: 160_000,
      },
    ]);
  });

  it('refuses the same branch twice, nothing to send, and a branch of another store', async () => {
    const { store, main, variantId } = await setUp();
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/transfers', headers: as(store), payload });
    expect(
      (
        await post({
          fromBranchId: main,
          toBranchId: main,
          date: '2026-10-30',
          lines: [{ variantId, qty: 1000 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post({ fromBranchId: main, toBranchId: main, date: '2026-10-30', lines: [] })).statusCode,
    ).toBe(400);
    const other = await openStore(app, '0944000002');
    const [theirs] = await ownerDb()<
      { id: string }[]
    >`select id from branches where tenant_id = ${other.tenantId}`;
    const res = await post({
      fromBranchId: main,
      toBranchId: theirs!.id,
      date: '2026-10-30',
      lines: [{ variantId, qty: 1000 }],
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
