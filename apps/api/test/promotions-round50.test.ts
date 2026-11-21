import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PromotionPreview, PromotionReport } from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { seedCatalog } from './catalog-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/** Round 50: the offers report groups by the offer's id, nets returns, caps the period; the preview counts the shop's goods. */

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

describe('promotions, round 50', () => {
  it('keeps a renamed offer in one row, nets what was returned, and refuses a period over a year', async () => {
    const { body } = await registerStore(app, { phone: '0912345678' });
    const tenantId = body.tenant.id as string;
    const headers = { authorization: `Bearer ${body.accessToken as string}` };
    const device = await createDevice(tenantId);
    const db = ownerDb();
    const [user] = await db<{ id: string }[]>`select id from users where tenant_id = ${tenantId}`;
    const offerId = createUuidV7()();
    const line = (lineNo: number, qty: number, gross: number, off: number, reason: string, id?: string) => ({
      lineNo,
      qty,
      discount: { type: 'amount', minor: off, source: 'promotion', reason, approval: null, promotionId: id },
      priced: { grossMinor: gross, lineDiscountMinor: off, netMinor: gross - off },
    });
    const sale = (n: string, date: string, lines: unknown[]) => {
      const id = createUuidV7()();
      return db`insert into invoices (tenant_id, id, branch_id, device_id, number, business_date,
          device_time, shift_id, cashier_id, currency, tax_inclusive, gross_minor, discount_minor, tax_minor,
          total_minor, tip_minor, payload)
        values (${tenantId}, ${id}, ${device.branchId}, ${device.deviceId}, ${n},
          ${date}, now(), ${createUuidV7()()}, ${user!.id}, 'SYP', true, 100, 0, 0, 100, 0,
          ${db.json({ lines } as never)})`.then(() => id);
    };
    // The same offer, renamed between the two sales; one old receipt from a till that sent only the name
    const first = await sale('INV-1', '2026-11-10', [line(1, 2000, 20_000, 2_000, 'خصم الشتاء', offerId)]);
    await sale('INV-2', '2026-11-12', [line(1, 1000, 10_000, 1_000, 'خصم الشتاء الكبير', offerId)]);
    await sale('INV-3', '2026-11-13', [line(1, 1000, 10_000, 1_000, 'عرض قديم')]);
    // One piece of the first sale comes back
    const returnId = createUuidV7()();
    await db`insert into sale_returns (tenant_id, id, branch_id, device_id, number, business_date, device_time,
        sale_id, sale_number, shift_id, cashier_id, currency, reason, gross_ex_tax_minor, discount_ex_tax_minor,
        tax_minor, total_minor, payload)
      values (${tenantId}, ${returnId}, ${device.branchId}, ${device.deviceId}, 'RET-1', '2026-11-14', now(),
        ${first}, 'INV-1', ${createUuidV7()()}, ${user!.id}, 'SYP', 'x', 9000, 0, 0, 9000, ${db.json({} as never)})`;
    await db`insert into sale_return_lines (tenant_id, id, return_id, line_no, sale_line_no, product_id,
        variant_id, name, qty, base_qty, gross_ex_tax_minor, discount_ex_tax_minor, tax_minor, total_minor)
      values (${tenantId}, ${createUuidV7()()}, ${returnId}, 1, 1, ${createUuidV7()()}, ${createUuidV7()()},
        'x', 1000, 1000, 9000, 0, 0, 9000)`;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2026-11-01&to=2026-11-30',
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { items } = res.json<PromotionReport>();
    expect(items).toHaveLength(2);
    // One row for the renamed offer: 3 pieces sold, 1 back; the discount and net follow the piece
    expect(items[0]).toMatchObject({
      name: 'خصم الشتاء الكبير',
      invoices: 2,
      pieces: 2,
      returnedPieces: 1,
      discountMinor: 2_000,
      netMinor: 18_000,
    });
    expect(items[1]).toMatchObject({ name: 'عرض قديم', invoices: 1, pieces: 1, returnedPieces: 0 });
    const long = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2025-01-01&to=2026-11-30',
      headers,
    });
    expect(long.statusCode).toBe(400);
    const backwards = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2026-11-30&to=2026-11-01',
      headers,
    });
    expect(backwards.statusCode).toBe(400);
  });

  it('counts what the shop shows apart from what the tills sell', async () => {
    const { body } = await registerStore(app, { phone: '0912345679' });
    const tenantId = body.tenant.id as string;
    const token = body.accessToken as string;
    const headers = { authorization: `Bearer ${token}` };
    await seedCatalog(app, tenantId, token);
    const ask = async () =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/promotions/preview',
          headers,
          payload: { scope: 'all' },
        })
      ).json<PromotionPreview>();
    // No online store yet: the shop shows nothing
    const before = await ask();
    expect(before.products).toBeGreaterThan(0);
    expect(before.shopProducts).toBe(0);
    const current = await app.inject({ method: 'GET', url: '/v1/online-store', headers });
    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers,
      payload: {
        version: current.json<{ version: number | null }>().version,
        enabled: true,
        slug: 'preview-shop',
        whatsapp: '0933123456',
        delivery: true,
        pickup: true,
        note: null,
        showOutOfStock: true,
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const after = await ask();
    expect(after.shopProducts).toBeGreaterThan(0);
    expect(after.shopProducts).toBeLessThanOrEqual(after.products);
  });
});
