import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb, type DbHandle } from '@serva/db';
import type { ProductListResponse } from '@serva/core';
import { DEMO_ITEMS, demoStore, seedDemoCatalog } from '../src/scripts/demo-catalog';
import { ean13CheckDigit } from '../src/services/catalog/products';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

let app: FastifyInstance;
let owner: DbHandle;

beforeAll(async () => {
  app = await makeApp();
  owner = createDb(TEST_OWNER_URL, { max: 1 });
});
afterAll(async () => {
  await app.close();
  await owner.client.end();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

describe('seed --demo-catalog', () => {
  it('adds about 40 Raqqa supermarket products once, with valid barcodes, SYP and USD prices and stock', async () => {
    await expect(demoStore(owner.db)).rejects.toThrow(/No store yet/);
    const { body } = await registerStore(app);
    const tenantId = await demoStore(owner.db);
    expect(tenantId).toBe(body.tenant.id);

    expect(await seedDemoCatalog(owner.db, tenantId)).toEqual({
      tenantId,
      created: DEMO_ITEMS.length,
      skipped: 0,
    });
    expect(DEMO_ITEMS.length).toBeGreaterThanOrEqual(40);
    expect(await seedDemoCatalog(owner.db, tenantId)).toEqual({
      tenantId,
      created: 0,
      skipped: DEMO_ITEMS.length,
    });

    const codes = await ownerDb()<
      { code: string }[]
    >`select code from barcodes where tenant_id = ${tenantId}`;
    expect(codes.length).toBe(DEMO_ITEMS.length + 2);
    for (const { code } of codes) {
      expect(code).toMatch(/^\d{13}$/);
      expect(Number(code.at(-1))).toBe(ean13CheckDigit(code.slice(0, 12)));
    }
    const [currencies] = await ownerDb()<{ usd: number; syp: number }[]>`
      select count(*) filter (where currency = 'USD')::int as usd, count(*) filter (where currency = 'SYP')::int as syp
      from prices where tenant_id = ${tenantId}`;
    expect(currencies!.usd).toBeGreaterThan(0);
    expect(currencies!.syp).toBeGreaterThan(30);

    // It is a real catalog: the admin list finds it by normalized name.
    const res = await app.inject({
      method: 'GET',
      url: `/v1/products?q=${encodeURIComponent('جبنه')}`,
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    const list = res.json<ProductListResponse>();
    expect(list.items.map((p) => p.nameAr).sort()).toEqual(['جبنة بيضاء مشللة', 'جبنة مثلثات 8 قطع']);
    expect(list.items.every((p) => p.stockQty > 0)).toBe(true);
  });

  it('asks for a store code when there are several stores', async () => {
    await registerStore(app, { phone: '0911111111' });
    await registerStore(app, { phone: '0922222222' });
    await expect(demoStore(owner.db)).rejects.toThrow(/--store=/);
    const [first] = await ownerDb()<
      { store_code: string; id: string }[]
    >`select store_code, id from tenants limit 1`;
    expect(await demoStore(owner.db, first!.store_code)).toBe(first!.id);
  });
});
