import type { FastifyInstance } from 'fastify';
import type { ProductDetail } from '@serva/core';
import { ownerDb } from './helpers';

export interface CatalogFixture {
  products: ProductDetail[];
  /** A branch other than the device's, with stock of its own */
  otherBranchId: string;
}

/**
 * A small real catalog made through the admin routes (a category, a tax rate, a simple product,
 * a product with two variants and a pack barcode, a dollar price), plus stock in two branches and
 * a dollar rate written directly (they have no admin route yet).
 */
export async function seedCatalog(
  app: FastifyInstance,
  tenantId: string,
  accessToken: string,
): Promise<CatalogFixture> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url, headers, payload });
    if (res.statusCode !== 201) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
    return res.json<{ id: string }>();
  };
  const category = await post('/v1/categories', { name: 'مشروبات' });
  const tax = await post('/v1/tax-rates', { name: 'رسم الإنفاق', rateBp: 500, kind: 'consumption' });
  const tea = (await post('/v1/products', {
    nameAr: 'شاي الربيع',
    categoryId: category.id,
    taxRateId: tax.id,
    variants: [
      {
        price: { currency: 'SYP', priceMinor: 4_500_000 },
        minPriceMinor: 4_000_000,
        barcodes: [
          { kind: 'standard', code: '6281234500012' },
          { kind: 'standard', code: '16281234500019', packQty: 12000, packName: 'كرتونة' },
        ],
      },
    ],
  })) as ProductDetail;
  const shirt = (await post('/v1/products', {
    nameAr: 'قميص',
    variants: [
      { attributes: [{ name: 'المقاس', value: 'M' }], price: { currency: 'USD', priceMinor: 1200 } },
      {
        attributes: [{ name: 'المقاس', value: 'L' }],
        price: { currency: 'USD', priceMinor: 1300 },
        barcodes: [{ kind: 'internal' }],
      },
    ],
  })) as ProductDetail;
  const [main] = await ownerDb()<{ id: string }[]>`
    select id from branches where tenant_id = ${tenantId} order by created_at limit 1`;
  const [other] = await ownerDb()<{ id: string }[]>`
    insert into branches (tenant_id, code, name) values (${tenantId}, '002', 'فرع الرشيد') returning id`;
  await ownerDb()`
    insert into stock_levels (tenant_id, branch_id, variant_id, qty)
    values (${tenantId}, ${main!.id}, ${tea.variants[0]!.id}, 24000),
           (${tenantId}, ${other!.id}, ${tea.variants[0]!.id}, 5000)`;
  await ownerDb()`
    insert into exchange_rates (tenant_id, unit, quote, rate, collect_rate)
    values (${tenantId}, 'USD', 'SYP', '130', '128')`;
  return { products: [tea, shirt], otherBranchId: other!.id };
}
