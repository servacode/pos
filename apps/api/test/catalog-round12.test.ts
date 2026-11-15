import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductListResponse } from '@serva/core';
import { makeProduct, openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Round 12: the products tiles count the whole store, and the list says how many have no category. */

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
const PIECE = 1000;

const list = async (store: Store, query = '') =>
  (
    await app.inject({ method: 'GET', url: `/v1/products?status=active${query}`, headers: as(store) })
  ).json<ProductListResponse>();

async function setStock(store: Store, variantId: string, qty: number) {
  const [branch] = await ownerDb()<
    { id: string }[]
  >`select id from branches where tenant_id = ${store.tenantId} limit 1`;
  await ownerDb()`
    insert into stock_levels (tenant_id, branch_id, variant_id, qty)
    values (${store.tenantId}, ${branch!.id}, ${variantId}, ${qty})
    on conflict (tenant_id, branch_id, variant_id) do update set qty = excluded.qty`;
}

describe('the products tiles', () => {
  it('count the whole store whatever the search shows: pieces are positive stock, a combination is out at 0 or less', async () => {
    const store = await openStore(app);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const tea = await makeProduct(app, store, 'شاي', 10_000);
    const rice = await makeProduct(app, store, 'أرز', 5_000);
    await setStock(store, milk.variantId, 10 * PIECE);
    await setStock(store, tea.variantId, -2 * PIECE);
    await setStock(store, rice.variantId, 0);

    const all = await list(store);
    expect(all.totals).toEqual({
      products: 3,
      variants: 3,
      pieces: 10 * PIECE,
      negative: 1,
      runOut: 2,
      runOutProducts: 2,
      lowest: { nameAr: 'شاي', qty: -2 * PIECE },
    });
    // A search narrows the rows, never the tiles
    const found = await list(store, `&q=${encodeURIComponent('حليب')}`);
    expect(found.items.map((i) => i.nameAr)).toEqual(['حليب']);
    expect(found.totals).toEqual(all.totals);
    // Only the first page of the active list carries them
    expect((await list(store, `&limit=1`)).totals).toEqual(all.totals);
    const archived = await app.inject({
      method: 'GET',
      url: '/v1/products?status=archived',
      headers: as(store),
    });
    expect(archived.json<ProductListResponse>().totals).toBeUndefined();
  });

  it('says how many active products have no category', async () => {
    const store = await openStore(app);
    await makeProduct(app, store, 'حليب', 25_000);
    await makeProduct(app, store, 'شاي', 10_000);
    expect((await list(store)).attention?.uncategorised).toBe(2);
  });

  it('leaves a service (like the rent line) out of the uncategorised count', async () => {
    const store = await openStore(app);
    await makeProduct(app, store, 'حليب', 25_000);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'إيجار',
        type: 'service',
        variants: [{ price: { currency: 'SYP', priceMinor: 50_000 } }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((await list(store)).attention?.uncategorised).toBe(1);
  });
});

describe('the online store', () => {
  it('tells the shop the store’s business types so a product without a picture gets the right icon', async () => {
    const store = await openStore(app);
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: as(store),
      payload: {
        version: null,
        enabled: true,
        slug: 'nour-fashion',
        whatsapp: '0933123456',
        delivery: true,
        pickup: true,
        note: null,
        showOutOfStock: false,
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ store: { sectors?: string[] } }>().store.sectors).toEqual(expect.any(Array));
  });
});
