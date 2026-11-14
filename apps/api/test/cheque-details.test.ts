import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Cheque, CustomerDetail, CustomerPurchases, ProductDetail } from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/**
 * Cheques with structured details (bank, number, due day, drawer), payments to a supplier by cheque,
 * a pack's own wholesale price and the customer's balance for the till.
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
const post = (store: Store, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(store), payload: payload as Record<string, unknown> });
const list = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/cheques', headers: as(store) })).json<{ items: Cheque[] }>()
    .items;

describe('cheque details', () => {
  it('lists a sale cheque with its bank, due day and drawer, and an old free-text cheque without them', async () => {
    const store = await openStore(app);
    const made = await post(store, '/v1/customers', { name: 'مؤسسة الفرات' });
    const customer = made.json<CustomerDetail>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const structured = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 50_000)],
        payments: [
          {
            method: 'cheque',
            currency: 'SYP',
            amountMinor: 50_000,
            reference: 'بنك سورية · 000123 · 2026-12-01',
            cheque: { bank: 'بنك سورية', number: '000123', dueDate: '2026-12-01', drawer: 'أحمد' },
          },
        ],
        customerId: customer.id,
        customerName: customer.name,
      }),
    );
    const old = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 30_000)],
        payments: [
          { method: 'cheque', currency: 'SYP', amountMinor: 30_000, reference: 'CHQ-7781 2026-11-30' },
        ],
        customerId: customer.id,
        customerName: customer.name,
      }),
    );
    const res = await push(app, store.device, [open, structured, old]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    const items = await list(store);
    const by = (ref: string) => items.find((c) => c.reference === ref)!;
    expect(by('بنك سورية · 000123 · 2026-12-01')).toMatchObject({
      direction: 'in',
      bank: 'بنك سورية',
      dueDate: '2026-12-01',
      drawer: 'أحمد',
    });
    expect(by('CHQ-7781 2026-11-30')).toMatchObject({ direction: 'in', bank: null, dueDate: null });
  });

  it('lists a payment to a supplier by cheque as an outgoing cheque paid from the bank', async () => {
    const store = await openStore(app);
    const supplier = (await post(store, '/v1/suppliers', { name: 'مورد المواد' })).json<{ id: string }>();
    const paid = await post(store, '/v1/supplier-payments', {
      supplierId: supplier.id,
      date: '2026-11-02',
      amountMinor: 40_000,
      method: 'cash',
      cheque: { bank: 'بنك بيمو', number: '55102', dueDate: '2026-12-15' },
      advance: true,
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json<{ method: string }>().method).toBe('bank');
    const [row] = await list(store);
    expect(row).toMatchObject({
      sourceType: 'supplier_payment',
      direction: 'out',
      bank: 'بنك بيمو',
      dueDate: '2026-12-15',
      supplierName: 'مورد المواد',
      amountMinor: 40_000,
      status: 'pending',
    });
    // It cannot be cashed or bounced from here
    const act = await post(store, '/v1/cheques/actions', {
      sourceType: 'receipt',
      sourceId: row!.sourceId,
      paymentNo: 1,
      action: 'cleared',
      date: '2026-12-15',
    });
    expect(act.statusCode).toBe(404);
  });
});

describe('a pack wholesale price and the customer balance', () => {
  it('keeps a pack barcode its own wholesale price', async () => {
    const store = await openStore(app);
    const made = await post(store, '/v1/products', {
      nameAr: 'مياه',
      variants: [
        {
          price: { currency: 'SYP', priceMinor: 1_000 },
          wholesalePriceMinor: 800,
          barcodes: [
            { kind: 'internal' },
            {
              kind: 'standard',
              code: '6281234500099',
              packQty: 12_000,
              packName: 'كرتونة',
              packWholesaleMinor: 9_000,
            },
          ],
        },
      ],
    });
    expect(made.statusCode, made.body).toBe(201);
    const pack = made.json<ProductDetail>().variants[0]!.barcodes.find((b) => b.packQty === 12_000)!;
    expect(pack.packWholesaleMinor).toBe(9_000);
    expect(pack.packPriceMinor).toBeNull();
  });

  it('tells the till what the customer owes now', async () => {
    const store = await openStore(app);
    const customer = (await post(store, '/v1/customers', { name: 'بقالية النور' })).json<CustomerDetail>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const credit = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 70_000)],
        payments: [{ method: 'credit', currency: 'SYP', amountMinor: 70_000 }],
        customerId: customer.id,
        customerName: customer.name,
      }),
    );
    await push(app, store.device, [open, credit]);
    const got = await app.inject({
      method: 'GET',
      url: `/v1/customers/${customer.id}/purchases`,
      headers: as(store),
    });
    expect(got.json<CustomerPurchases>().balanceMinor).toBe(70_000);
  });
});
