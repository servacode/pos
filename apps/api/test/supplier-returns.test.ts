import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InventoryResponse,
  ProductDetail,
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierReturnRow,
  SupplierRow,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import { openStore, type Store } from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Returns to the supplier (09 › purchase returns): stock out at cost, the supplier owes it back. */

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

/** 10 dresses at 40.00 each, on credit from «معمل الأمل» */
async function setUp() {
  const store = await openStore(app);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: { nameAr: 'فستان', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const supplier = (
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: as(store),
      payload: { name: 'معمل الأمل' },
    })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId: product.variants[0]!.id, qty: 10_000, costMinor: 400_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, supplierId: supplier.id, variantId: product.variants[0]!.id };
}

const sendBack = (store: Store, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/supplier-returns', headers: as(store), payload });

async function entryOf(store: Store) {
  const rows = await ownerDb()<{ code: string; debit: string; credit: string }[]>`
    select a.code, l.debit_minor::text as debit, l.credit_minor::text as credit
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.tenant_id = ${store.tenantId} and e.source_type = 'supplier_return' order by a.code`;
  return rows.map((r) => [r.code, Number(r.debit), Number(r.credit)]);
}

describe('returns to the supplier', () => {
  it('sends 3 faulty dresses back off the supplier’s balance, at their cost', async () => {
    const { store, supplierId, variantId } = await setUp();
    const res = await sendBack(store, {
      supplierId,
      date: '2026-10-30',
      refund: 'credit',
      reference: 'CN-17',
      note: 'خياطة معيوبة',
      lines: [{ variantId, qty: 3000 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const back = res.json<SupplierReturnDetail>();
    expect(back).toMatchObject({
      number: expect.stringMatching(/^PRT-/),
      amountMinor: 120_000,
      costMinor: 120_000,
      lines: [{ qty: 3000, amountMinor: 120_000, costMinor: 120_000 }],
    });
    expect(await entryOf(store)).toEqual([
      ['1300', 0, 120_000],
      ['2100', 120_000, 0],
    ]);
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items.find((r) => r.variantId === variantId)).toMatchObject({
      qty: 7000,
      valueMinor: 280_000,
    });
    const suppliers = (
      await app.inject({ method: 'GET', url: '/v1/suppliers', headers: as(store) })
    ).json<SupplierListResponse>();
    expect(suppliers.items.find((s) => s.id === supplierId)?.balanceMinor).toBe(280_000);

    const list = (await app.inject({ method: 'GET', url: '/v1/supplier-returns', headers: as(store) })).json<{
      items: SupplierReturnRow[];
    }>();
    expect(list.items).toEqual([
      {
        id: back.id,
        number: back.number,
        date: '2026-10-30',
        supplierName: 'معمل الأمل',
        refund: 'credit',
        pieces: 3000,
        amountMinor: 120_000,
      },
    ]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`))).toEqual([]);
  });

  it('takes cash back for less than cost, the rest to cost of sales', async () => {
    const { store, supplierId, variantId } = await setUp();
    const res = await sendBack(store, {
      supplierId,
      date: '2026-10-30',
      refund: 'cash',
      lines: [{ variantId, qty: 2000, amountMinor: 60_000 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const entry = await entryOf(store);
    expect(entry).toContainEqual(['1300', 0, 80_000]);
    expect(entry).toContainEqual(['5100', 20_000, 0]);
    expect(entry.find((l) => String(l[0]).startsWith('112'))).toEqual([expect.any(String), 60_000, 0]);
    const report = await withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId));
    expect(report.checks.flatMap((x) => x.problems.map((p) => `${x.name}: ${p}`))).toEqual([]);
  });

  it('refuses more pieces than the branch holds, and another store’s supplier', async () => {
    const { store, supplierId, variantId } = await setUp();
    const over = await sendBack(store, {
      supplierId,
      date: '2026-10-30',
      refund: 'credit',
      lines: [{ variantId, qty: 11_000 }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({
      error: { fields: { 'lines.0.qty': expect.stringContaining('10') } },
    });
    const other = await openStore(app, '0944000002');
    const theirs = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(other),
        payload: { name: 'غيره' },
      })
    ).json<SupplierRow>();
    const res = await sendBack(store, {
      supplierId: theirs.id,
      date: '2026-10-30',
      refund: 'credit',
      lines: [{ variantId, qty: 1000 }],
    });
    expect(res.statusCode).toBe(400);
    expect(await entryOf(store)).toEqual([]);
  });
});
