import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PullSetRows } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { seedCatalog } from './catalog-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase, settled } from './helpers';

/**
 * Every pull row carries exactly the fields of its contract interface (packages/core ›
 * contracts/catalog.ts PullSetRows): nothing more (no cost, no PIN hash), nothing less.
 */
const FIELDS: { [K in keyof PullSetRows]: readonly (keyof PullSetRows[K])[] } = {
  products: [
    'id',
    'nameAr',
    'nameEn',
    'categoryId',
    'brand',
    'genericName',
    'tracksSerial',
    'warrantyMonths',
    'type',
    'status',
    'unitId',
    'taxRateId',
    'sellOnPos',
    'modifiers',
    'archived',
    'version',
  ],
  variants: [
    'id',
    'productId',
    'sku',
    'label',
    'attributes',
    'sortOrder',
    'nearestExpiry',
    'imageUrl',
    'archived',
    'version',
  ],
  prices: [
    'id',
    'variantId',
    'currency',
    'priceMinor',
    'minPriceMinor',
    'wholesalePriceMinor',
    'priceChangedAt',
    'version',
  ],
  barcodes: ['id', 'variantId', 'code', 'kind', 'packQty', 'packName', 'packPriceMinor', 'version'],
  categories: ['id', 'name', 'parentId', 'sortOrder', 'archived', 'version'],
  units: ['id', 'name', 'symbol', 'allowsFraction', 'version'],
  tax_rates: ['id', 'name', 'rateBp', 'kind', 'showOnReceipt', 'archived', 'version'],
  stock_levels: ['id', 'branchId', 'variantId', 'qty', 'reservedQty', 'version'],
  exchange_rates: [
    'id',
    'unit',
    'quote',
    'rate',
    'collectRate',
    'minRate',
    'maxRate',
    'effectiveAt',
    'version',
  ],
  settings: [
    'id',
    'baseCurrency',
    'enabledCurrencies',
    'taxInclusive',
    'defaultTaxRateBp',
    'cashRoundingSteps',
    'numberFormat',
    'receiptFooter',
    'storeName',
    'taxNumber',
    'timezone',
    'businessDayCutoff',
    'shiftMode',
    'idleMinutes',
    'scaleBarcode',
    'service',
    'loyalty',
    'version',
  ],
  users: ['id', 'fullName', 'status', 'pinLength', 'pinVersion', 'version'],
  roles: ['id', 'key', 'name', 'permissions', 'maxDiscountBp', 'version'],
  user_roles: ['id', 'userId', 'roleId', 'branchId', 'version'],
  branches: ['id', 'code', 'name', 'address', 'phone', 'isActive', 'version'],
  customers: ['id', 'name', 'phone', 'creditLimitMinor', 'priceTier', 'loyaltyPoints', 'archived', 'version'],
  vouchers: ['id', 'code', 'currency', 'amountMinor', 'redeemedMinor', 'version'],
  online_orders: [
    'id',
    'number',
    'status',
    'customerName',
    'phone',
    'fulfilment',
    'address',
    'note',
    'currency',
    'totalMinor',
    'lines',
    'version',
  ],
  promotions: [
    'id',
    'name',
    'kind',
    'percentBp',
    'buyQty',
    'getQty',
    'scope',
    'categoryIds',
    'productIds',
    'startsAt',
    'endsAt',
    'daysOfWeek',
    'fromTime',
    'toTime',
    'archived',
    'version',
  ],
};

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

async function pullAll(authorization: string): Promise<PullResponse> {
  await settled();
  const res = await app.inject({ method: 'GET', url: '/v1/sync/pull', headers: { authorization } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe('catalog pull sets', () => {
  it('every row of every set has exactly its contract fields', async () => {
    const { body } = await registerStore(app);
    await seedCatalog(app, body.tenant.id, body.accessToken);
    const added = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { name: 'أبو خالد', phone: '0933111222', creditLimitMinor: 50_000 },
    });
    expect(added.statusCode, added.body).toBe(201);
    const promo = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { name: 'خصم الأسبوع', kind: 'percent', percentBp: 1000, scope: 'all' },
    });
    expect(promo.statusCode, promo.body).toBe(201);
    // An exchange voucher, as a return on «قسيمة استبدال» leaves it
    await ownerDb()`
      insert into vouchers (id, tenant_id, code, return_id, currency, amount_minor)
      values (gen_random_uuid(), ${body.tenant.id}, 'SRT-001-001-0000001', gen_random_uuid(), 'SYP', 45000)`;
    // An online shop order the owner accepted, waiting for the till
    await ownerDb()`
      insert into online_orders (tenant_id, seq, number, status, source, customer_name, phone, fulfilment,
                                 currency, total_minor, lines, decided_at)
      values (${body.tenant.id}, 1, 'ONL-000001', 'accepted', 'shop', 'ريم', '+963944555666', 'pickup',
              'SYP', 900000, '[]'::jsonb, now())`;
    const page = await pullAll((await createDevice(body.tenant.id)).authorization);
    expect(Object.keys(page.sets).sort()).toEqual(Object.keys(FIELDS).sort());
    for (const [set, fields] of Object.entries(FIELDS)) {
      const rows = page.sets[set]!.upserts;
      expect(rows.length, set).toBeGreaterThan(0);
      for (const row of rows) expect(Object.keys(row).sort(), set).toEqual([...fields].sort());
    }
    expect(JSON.stringify(page)).not.toMatch(/"\w*(cost|purchase|margin|pinhash|pin_hash)\w*":|\$argon2/i);
  });

  it('carries the values the cashier needs: prices in their currency, packs, rates and settings', async () => {
    const { body } = await registerStore(app);
    const { products } = await seedCatalog(app, body.tenant.id, body.accessToken);
    const [tea, shirt] = products;
    const page = await pullAll((await createDevice(body.tenant.id)).authorization);
    const sets = page.sets as unknown as { [K in keyof PullSetRows]: { upserts: PullSetRows[K][] } };
    expect(sets.products.upserts.find((p) => p.id === tea!.id)).toMatchObject({
      nameAr: 'شاي الربيع',
      archived: false,
      sellOnPos: true,
    });
    expect(sets.prices.upserts.find((p) => p.id === tea!.variants[0]!.id)).toEqual({
      id: tea!.variants[0]!.id,
      variantId: tea!.variants[0]!.id,
      currency: 'SYP',
      priceMinor: 4_500_000,
      minPriceMinor: 4_000_000,
      wholesalePriceMinor: null,
      priceChangedAt: tea!.variants[0]!.priceChangedAt,
      version: 1,
    });
    expect(sets.barcodes.upserts.find((b) => b.code === '16281234500019')).toMatchObject({
      packQty: 12000,
      packName: 'كرتونة',
    });
    expect(sets.variants.upserts.filter((v) => v.productId === shirt!.id).map((v) => v.label)).toEqual(
      expect.arrayContaining(['M', 'L']),
    );
    expect(sets.exchange_rates.upserts).toEqual([
      expect.objectContaining({ unit: 'USD', quote: 'SYP', rate: '130', collectRate: '128' }),
    ]);
    expect(sets.settings.upserts[0]).toMatchObject({
      storeName: 'متجر أحمد الخطيب',
      taxNumber: null,
      timezone: 'Asia/Damascus',
      businessDayCutoff: '00:00',
      shiftMode: 'per_cashier',
      idleMinutes: 5,
    });
  });

  it('stock_levels go to a device of their branch only', async () => {
    const { body } = await registerStore(app);
    const { otherBranchId } = await seedCatalog(app, body.tenant.id, body.accessToken);
    const main = await createDevice(body.tenant.id);
    const [other] = await ownerDb()<{ id: string }[]>`
      insert into devices (tenant_id, branch_id, code, name, status, token_hash)
      values (${body.tenant.id}, ${otherBranchId}, '009', 'كاشير الرشيد', 'active', ${'a'.repeat(64)})
      returning id`;
    expect(other).toBeDefined();
    const page = await pullAll(main.authorization);
    expect(page.sets.stock_levels!.upserts.map((s) => s.branchId)).toEqual([main.branchId]);
  });

  it('a price edit moves only the price row, and a store rename moves the settings row', async () => {
    const { body } = await registerStore(app);
    const { products } = await seedCatalog(app, body.tenant.id, body.accessToken);
    const device = await createDevice(body.tenant.id);
    const first = await pullAll(device.authorization);
    const cursors = Object.fromEntries(Object.entries(first.sets).map(([k, v]) => [k, v.cursor]));
    const tea = products[0]!;
    await app.inject({
      method: 'PATCH',
      url: `/v1/products/${tea.id}`,
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: {
        version: tea.version,
        variants: [{ id: tea.variants[0]!.id, price: { currency: 'SYP', priceMinor: 1 } }],
      },
    });
    await ownerDb()`update tenants set name = 'سوبرماركت الفرات' where id = ${body.tenant.id}`;
    await settled();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?cursors=${encodeURIComponent(JSON.stringify(cursors))}`,
      headers: { authorization: device.authorization },
    });
    const next = res.json<PullResponse>();
    expect(next.sets.prices!.upserts.map((p) => p.priceMinor)).toEqual([1]);
    expect(next.sets.variants!.upserts).toEqual([]);
    expect(next.sets.barcodes!.upserts).toEqual([]);
    expect(next.sets.settings!.upserts.map((s) => s.storeName)).toEqual(['سوبرماركت الفرات']);
  });
});
