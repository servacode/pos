import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductListResponse, PurchaseDetail, SupplierListResponse, SupplierRow } from '@serva/core';
import { makeProduct, openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Round 9: the products list's picture and expiry, and what the suppliers list adds up. */

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
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const bytes = (fill: number, size: number) =>
  Buffer.from([...JPEG, ...Array.from({ length: size }, (_, i) => (fill + i) % 256)]);

const list = async (store: Store, query = '') =>
  (
    await app.inject({ method: 'GET', url: `/v1/products?status=active${query}`, headers: as(store) })
  ).json<ProductListResponse>();

describe('the products list', () => {
  it('carries the first picture’s thumbnail and the nearest expiry, and filters by expiry', async () => {
    const store = await openStore(app);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await makeProduct(app, store, 'شاي', 10_000);

    const bare = await list(store);
    expect(bare.items.map((i) => [i.thumbUrl, i.nearestExpiry])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(bare.attention).toMatchObject({ expiringSoon: 0 });

    const added = await app.inject({
      method: 'POST',
      url: `/v1/products/${milk.productId}/images`,
      headers: as(store),
      payload: {
        contentType: 'image/jpeg',
        data: bytes(3, 600).toString('base64'),
        thumb: bytes(3, 100).toString('base64'),
        width: 800,
        height: 800,
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const withPhoto = (await list(store)).items.find((i) => i.nameAr === 'حليب')!;
    expect(withPhoto.hasImage).toBe(true);
    expect(withPhoto.thumbUrl).toMatch(
      new RegExp(`^/v1/images/${store.tenantId}/[0-9a-f-]{36}[?]size=thumb$`),
    );

    // A piece with a batch ending in ten days, one already past its date
    await ownerDb()`update variants set nearest_expiry = current_date + 10 where id = ${milk.variantId}`;
    const soon = await list(store, '&expiry=soon');
    expect(soon.items.map((i) => i.nameAr)).toEqual(['حليب']);
    expect(soon.items[0]!.nearestExpiry).toBe(
      (await ownerDb()<{ d: string }[]>`select (current_date + 10)::text as d`)[0]!.d,
    );
    expect((await list(store)).attention).toMatchObject({ expiringSoon: 1 });
    expect((await list(store, '&expiry=expired')).items).toEqual([]);

    await ownerDb()`update variants set nearest_expiry = current_date - 3 where id = ${milk.variantId}`;
    expect((await list(store, '&expiry=soon')).items).toEqual([]);
    expect((await list(store, '&expiry=expired')).items.map((i) => i.nameAr)).toEqual(['حليب']);
  });
});

describe('the suppliers list', () => {
  it('adds the last purchase date and the purchases total', async () => {
    const store = await openStore(app);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: as(store),
      payload: { name: 'مؤسسة الفرات' },
    });
    const s = made.json<SupplierRow>();
    const before = (
      await app.inject({ method: 'GET', url: '/v1/suppliers', headers: as(store) })
    ).json<SupplierListResponse>();
    expect(before.items[0]).toMatchObject({ lastPurchaseOn: null, purchasesTotalMinor: 0 });

    for (const [date, cost] of [
      ['2026-10-01', 200_000],
      ['2026-10-20', 300_000],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/purchases',
        headers: as(store),
        payload: {
          supplierId: s.id,
          date,
          payment: 'credit',
          lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: cost }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json<PurchaseDetail>().totalMinor).toBe(cost);
    }
    const after = (
      await app.inject({ method: 'GET', url: '/v1/suppliers', headers: as(store) })
    ).json<SupplierListResponse>();
    expect(after.items[0]).toMatchObject({ lastPurchaseOn: '2026-10-20', purchasesTotalMinor: 500_000 });
  });
});
