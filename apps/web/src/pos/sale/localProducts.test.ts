import { describe, expect, it } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { memoryStore, posSets } from '../../test/pos';
import { buildCatalog, barcodeKey } from '../catalog';
import {
  forgetLocalProduct,
  LOCAL_PRODUCTS_KEY,
  readLocalProducts,
  rememberLocalProduct,
  withPendingProducts,
  type LocalProduct,
} from './localProducts';

/** A product made at the till without a connection: in the catalog at once, gone when the server's own rows come or it holds the document back */

const item = (over: Partial<LocalProduct> = {}): LocalProduct => ({
  productId: '0192a000-0000-7000-8000-00000000b001',
  variantId: '0192a000-0000-7000-8000-00000000b002',
  nameAr: 'قميص أزرق',
  priceMinor: 450_000,
  currency: 'SYP',
  categoryId: null,
  barcode: '6291099900011',
  docId: 'doc-1',
  ...over,
});

describe('the products this till made offline', () => {
  it('shows up in the catalog under its own ids, with its barcode and price, awaiting review', async () => {
    const local = memoryLocal();
    await rememberLocalProduct(local, item());
    const sets = posSets();
    const { store } = memoryStore(undefined, sets);
    const merged = await withPendingProducts(local, store, sets);
    const catalog = buildCatalog(merged);
    const hit = catalog.byBarcode.get(barcodeKey('6291099900011'));
    expect(hit?.item).toMatchObject({
      name: 'قميص أزرق',
      productId: '0192a000-0000-7000-8000-00000000b001',
      variantId: '0192a000-0000-7000-8000-00000000b002',
      price: { currency: 'SYP', priceMinor: 450_000 },
    });
    expect(merged.products.find((p) => p.id === item().productId)?.status).toBe('temporary');
    // The pulled sets themselves are not touched
    expect(sets.products.some((p) => p.id === item().productId)).toBe(false);
  });

  it('is forgotten once the server’s own row for that product has been pulled', async () => {
    const local = memoryLocal();
    await rememberLocalProduct(local, item());
    const sets = posSets();
    const arrived = { ...sets.products[0]!, id: item().productId, nameAr: 'قميص أزرق' };
    const { store } = memoryStore(undefined, sets);
    const merged = await withPendingProducts(local, store, {
      ...sets,
      products: [...sets.products, arrived],
    });
    expect(merged.products.filter((p) => p.id === item().productId)).toHaveLength(1);
    expect(merged.variants.some((v) => v.id === item().variantId)).toBe(false);
    expect(await readLocalProducts(local)).toEqual([]);
    expect(await local.get(LOCAL_PRODUCTS_KEY)).toBeNull();
  });

  it('is forgotten when the server holds its document back, and kept while the document waits', async () => {
    const local = memoryLocal();
    await rememberLocalProduct(local, item({ docId: 'doc-held' }));
    await rememberLocalProduct(
      local,
      item({
        productId: '0192a000-0000-7000-8000-00000000b003',
        variantId: '0192a000-0000-7000-8000-00000000b004',
        barcode: '6291099900028',
        docId: 'doc-waiting',
      }),
    );
    const sets = posSets();
    const { store } = memoryStore(undefined, sets);
    store.heldIds = async () => new Set(['doc-held']);
    const merged = await withPendingProducts(local, store, sets);
    expect(merged.products.map((p) => p.id)).toContain('0192a000-0000-7000-8000-00000000b003');
    expect(merged.products.map((p) => p.id)).not.toContain(item().productId);
    expect((await readLocalProducts(local)).map((p) => p.docId)).toEqual(['doc-waiting']);
  });

  it('remembering twice keeps one copy, and forgetting the last removes the key', async () => {
    const local = memoryLocal();
    await rememberLocalProduct(local, item({ docId: '' }));
    await rememberLocalProduct(local, item({ docId: 'doc-1' }));
    expect(await readLocalProducts(local)).toEqual([item()]);
    await forgetLocalProduct(local, item().productId);
    expect(await local.get(LOCAL_PRODUCTS_KEY)).toBeNull();
  });
});
