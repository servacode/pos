import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductDetail, ProductImage, ProductImagesResponse } from '@serva/core';
import { sniffImage } from '../src/services/catalog/images';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/**
 * Product pictures (03 › الألبسة: صور القطع): several per product, one per colour where the shop
 * says so, in an order the first of which is the main one; served by their id without sign-in.
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
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const picture = (head: number[], fill: number, size = 600) =>
  Buffer.from([...head, ...Array.from({ length: size }, (_, i) => (fill + i) % 256)]);
const body = (fill: number, extra: Record<string, unknown> = {}) => ({
  contentType: 'image/jpeg',
  data: picture(JPEG, fill).toString('base64'),
  thumb: picture(JPEG, fill, 100).toString('base64'),
  width: 1200,
  height: 1600,
  ...extra,
});

async function shirt(store: Store) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: { nameAr: 'قميص', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

const add = (store: Store, productId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/v1/products/${productId}/images`, headers: as(store), payload });

describe('product pictures', () => {
  it('keeps several in order, one per colour, serves them without sign-in, and keeps a picture once', async () => {
    const store = await openStore(app);
    const p = await shirt(store);
    const first = await add(store, p.id, body(1));
    expect(first.statusCode, first.body).toBe(201);
    const red = (await add(store, p.id, body(2, { optionValue: 'أحمر' }))).json<ProductImage>();
    expect(red).toMatchObject({ optionValue: 'أحمر', sortOrder: 1, width: 1200, height: 1600 });
    // The same picture again is the same picture
    const again = (await add(store, p.id, body(1))).json<ProductImage>();
    expect(again.id).toBe(first.json<ProductImage>().id);

    const served = await app.inject({ method: 'GET', url: red.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.rawPayload.equals(picture(JPEG, 2))).toBe(true);
    const small = await app.inject({ method: 'GET', url: red.thumbUrl });
    expect(small.rawPayload.equals(picture(JPEG, 2, 100))).toBe(true);

    // Red first, then its colour taken off
    const ordered = await app.inject({
      method: 'POST',
      url: `/v1/products/${p.id}/images/order`,
      headers: as(store),
      payload: { ids: [red.id, again.id] },
    });
    expect(ordered.json<ProductImagesResponse>().items.map((i) => i.id)).toEqual([red.id, again.id]);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${p.id}/images/${red.id}`,
      headers: as(store),
      payload: { version: ordered.json<ProductImagesResponse>().items[0]!.version, optionValue: null },
    });
    expect(patched.json<ProductImage>().optionValue, patched.body).toBeNull();
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${p.id}/images/${red.id}`,
      headers: as(store),
      payload: { version: red.version, optionValue: 'أزرق' },
    });
    expect(stale.statusCode).toBe(409);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/products/${p.id}/images/${again.id}`,
      headers: as(store),
    });
    expect(removed.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: `/v1/products/${p.id}/images`, headers: as(store) });
    expect(list.json<ProductImagesResponse>().items.map((i) => i.id)).toEqual([red.id]);
  });

  it('refuses what is not a picture, a format that is not what it says, and a picture too big', async () => {
    const store = await openStore(app);
    const p = await shirt(store);
    const text = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
    const bad = await add(store, p.id, body(1, { data: text }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { fields: { data: expect.stringContaining('ليس صورة') } } });
    const png = await add(store, p.id, body(1, { data: picture(PNG, 1).toString('base64') }));
    expect(png.statusCode).toBe(400);
    const huge = await add(store, p.id, body(1, { data: picture(JPEG, 1, 2_600_000).toString('base64') }));
    expect(huge.statusCode).toBe(400);
    const svg = await add(store, p.id, body(1, { contentType: 'image/svg+xml' }));
    expect(svg.statusCode).toBe(400);
  });

  it('is another store’s picture nowhere, and an unknown one is 404', async () => {
    const a = await openStore(app);
    const b = await openStore(app, '0944000002');
    const p = await shirt(a);
    const img = (await add(a, p.id, body(5))).json<ProductImage>();
    // B can neither list A's product pictures nor add to them
    expect(
      (await app.inject({ method: 'GET', url: `/v1/products/${p.id}/images`, headers: as(b) })).statusCode,
    ).toBe(404);
    expect((await add(b, p.id, body(6))).statusCode).toBe(404);
    // B's store id with A's picture finds nothing
    const crossed = await app.inject({ method: 'GET', url: `/v1/images/${b.tenantId}/${img.uploadId}` });
    expect(crossed.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/v1/images/${a.tenantId}/not-an-id` })).statusCode).toBe(
      404,
    );
  });

  it('knows a picture by its first bytes', () => {
    expect(sniffImage(Uint8Array.from(JPEG))).toBe('image/jpeg');
    expect(sniffImage(Uint8Array.from(PNG))).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(
      'image/webp',
    );
    expect(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
