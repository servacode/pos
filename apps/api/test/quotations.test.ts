import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Quotation, QuotationListItem, TaxRate } from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** «عروض الأسعار»: numbered, kept as offered, followed to converted; never posts and never moves stock. */

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

const owner = (s: Store) => ({ authorization: `Bearer ${s.accessToken}` });
const till = (s: Store) => ({ authorization: s.device.authorization });

const body = (extra: Record<string, unknown> = {}) => ({
  customerName: 'مشفى الأمل',
  lines: [{ name: 'قفازات طبية', qty: 2000, unitPriceMinor: 10_000 }],
  ...extra,
});

const make = (s: Store, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/v1/quotations', headers: owner(s), payload: body(extra) });

const year = new Date().getFullYear();

describe('quotations in the admin', () => {
  it('numbers each one per store and year, as a draft that stands 15 days', async () => {
    const s = await openStore(app);
    const first = await make(s);
    expect(first.statusCode, first.body).toBe(201);
    const q = first.json<Quotation>();
    expect(q).toMatchObject({
      number: `QUO-${year}-000001`,
      status: 'draft',
      customerName: 'مشفى الأمل',
      currency: 'SYP',
      totalMinor: 20_000,
    });
    const days = (Date.parse(q.validUntil) - Date.parse(q.issueDate)) / 86_400_000;
    expect(days).toBe(15);
    expect((await make(s)).json<Quotation>().number).toBe(`QUO-${year}-000002`);
  });

  it('takes the percentage from the tax rate row and prices like the till', async () => {
    const s = await openStore(app);
    const rate = (
      await app.inject({
        method: 'POST',
        url: '/v1/tax-rates',
        headers: owner(s),
        payload: { name: 'استهلاك 10%', rateBp: 1000, kind: 'consumption' },
      })
    ).json<TaxRate>();
    const res = await make(s, {
      lines: [{ name: 'جهاز', qty: 1000, unitPriceMinor: 11_000, taxRateId: rate.id, taxRateBp: 5 }],
    });
    const q = res.json<Quotation>();
    expect(q.lines[0]).toMatchObject({ taxRateBp: 1000 });
    // Prices include tax by default: 11 000 holds 1 000 of tax
    expect(q.totals).toMatchObject({ taxMinor: 1000, totalMinor: 11_000 });
    expect(q.taxInclusive).toBe(true);
  });

  it('refuses an unknown tax rate, a past date and a discount larger than the line', async () => {
    const s = await openStore(app);
    const unknown = await make(s, {
      lines: [{ name: 'أ', qty: 1000, unitPriceMinor: 5, taxRateId: '0192a000-0000-7000-8000-000000000001' }],
    });
    expect(unknown.statusCode).toBe(400);
    const past = await make(s, { validUntil: '2020-01-01' });
    expect(past.statusCode).toBe(400);
    expect(past.json<{ error: { fields: Record<string, string> } }>().error.fields.validUntil).toBeTruthy();
    const big = await make(s, {
      lines: [{ name: 'أ', qty: 1000, unitPriceMinor: 5, discount: { type: 'amount', minor: 99 } }],
    });
    expect(big.statusCode).toBe(400);
  });

  it('fills the customer’s details from the customer card', async () => {
    const s = await openStore(app);
    const customer = (
      await app.inject({
        method: 'POST',
        url: '/v1/customers',
        headers: owner(s),
        payload: { name: 'وزارة الصحة', taxNumber: '123456789', address: 'دمشق' },
      })
    ).json<{ id: string }>();
    const q = (await make(s, { customerName: null, customerId: customer.id })).json<Quotation>();
    expect(q).toMatchObject({
      customerName: 'وزارة الصحة',
      customerTaxNumber: '123456789',
      customerAddress: 'دمشق',
    });
    const bad = await make(s, { customerId: '0192a000-0000-7000-8000-000000000001' });
    expect(bad.statusCode).toBe(400);
  });

  it('edits with the version, recomputes, and refuses a stale one', async () => {
    const s = await openStore(app);
    const q = (await make(s)).json<Quotation>();
    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/quotations/${q.id}`,
      headers: owner(s),
      payload: body({
        version: q.version,
        lines: [{ name: 'قفازات', qty: 3000, unitPriceMinor: 10_000 }],
        notes: 'توصيل مجاني',
      }),
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json<Quotation>()).toMatchObject({ totalMinor: 30_000, notes: 'توصيل مجاني' });
    const again = await app.inject({
      method: 'PUT',
      url: `/v1/quotations/${q.id}`,
      headers: owner(s),
      payload: body({ version: q.version }),
    });
    expect(again.statusCode).toBe(409);
  });

  it('follows draft to sent to accepted to converted, and a converted one is not edited', async () => {
    const s = await openStore(app);
    let q = (await make(s)).json<Quotation>();
    const move = async (status: string) => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/quotations/${q.id}/status`,
        headers: owner(s),
        payload: { status, version: q.version },
      });
      if (res.statusCode === 200) q = res.json<Quotation>();
      return res;
    };
    expect((await move('sent')).statusCode).toBe(200);
    expect((await move('accepted')).statusCode).toBe(200);
    expect((await move('converted')).statusCode).toBe(200);
    expect(q).toMatchObject({ status: 'converted', convertedAt: expect.any(String) });
    // converted cannot go to accepted again, and cannot be edited, but can be reopened
    expect((await move('accepted')).statusCode).toBe(400);
    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/quotations/${q.id}`,
      headers: owner(s),
      payload: body({ version: q.version }),
    });
    expect(edit.statusCode).toBe(409);
    expect((await move('sent')).statusCode).toBe(200);
    expect(q.convertedAt).toBeNull();
  });

  it('reads a waiting quotation past its day as expired, and will not convert it until it is renewed', async () => {
    const s = await openStore(app);
    const q = (await make(s, { status: 'sent' })).json<Quotation>();
    await ownerDb()`update quotations set issue_date = '2020-01-01', valid_until = '2020-02-01' where id = ${q.id}`;
    const list = await app.inject({ method: 'GET', url: '/v1/quotations?status=expired', headers: owner(s) });
    expect(list.json<{ items: QuotationListItem[] }>().items.map((i) => i.number)).toEqual([q.number]);
    const open = await app.inject({ method: 'GET', url: '/v1/quotations?status=open', headers: owner(s) });
    expect(open.json<{ items: unknown[] }>().items).toEqual([]);
    const read = (
      await app.inject({ method: 'GET', url: `/v1/quotations/${q.id}`, headers: owner(s) })
    ).json<Quotation>();
    expect(read.status).toBe('expired');
    const convert = await app.inject({
      method: 'POST',
      url: `/v1/quotations/${q.id}/status`,
      headers: owner(s),
      payload: { status: 'converted', version: read.version },
    });
    expect(convert.statusCode).toBe(400);
    // A new date opens it again
    const renewed = await app.inject({
      method: 'PUT',
      url: `/v1/quotations/${q.id}`,
      headers: owner(s),
      payload: body({ version: read.version, validUntil: '2999-01-01' }),
    });
    expect(renewed.json<Quotation>().status).toBe('sent');
  });

  it('filters by status and by customer name or number', async () => {
    const s = await openStore(app);
    await make(s);
    await make(s, { customerName: 'مخبر الشام', status: 'sent' });
    const sent = await app.inject({ method: 'GET', url: '/v1/quotations?status=sent', headers: owner(s) });
    expect(sent.json<{ items: QuotationListItem[] }>().items.map((i) => i.customerName)).toEqual([
      'مخبر الشام',
    ]);
    const found = await app.inject({
      method: 'GET',
      url: `/v1/quotations?q=${encodeURIComponent('الأمل')}`,
      headers: owner(s),
    });
    expect(found.json<{ items: unknown[] }>().items).toHaveLength(1);
    const byNumber = await app.inject({ method: 'GET', url: '/v1/quotations?q=000002', headers: owner(s) });
    expect(byNumber.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('posts nothing and moves no stock', async () => {
    const s = await openStore(app);
    const q = (await make(s)).json<Quotation>();
    await app.inject({
      method: 'POST',
      url: `/v1/quotations/${q.id}/status`,
      headers: owner(s),
      payload: { status: 'converted', version: q.version },
    });
    const [n] = await ownerDb()<{ journal: number; stock: number; invoices: number }[]>`
      select (select count(*)::int from journal_entries) as journal,
             (select count(*)::int from stock_movements) as stock,
             (select count(*)::int from invoices) as invoices`;
    expect(n).toEqual({ journal: 0, stock: 0, invoices: 0 });
  });
});

describe('quotations at the till', () => {
  it('saves one as sent in the till’s branch, lists the open ones, and marks it converted once opened', async () => {
    const s = await openStore(app);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/device/quotations',
      headers: till(s),
      payload: body(),
    });
    expect(made.statusCode, made.body).toBe(201);
    const q = made.json<Quotation>();
    expect(q).toMatchObject({ number: `QUO-${year}-000001`, status: 'sent' });
    expect(q.branchName).toBeTruthy();

    const listed = await app.inject({ method: 'GET', url: '/v1/device/quotations', headers: till(s) });
    expect(listed.json<{ items: Quotation[] }>().items.map((i) => i.id)).toEqual([q.id]);

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/device/quotations/${q.id}/convert`,
      headers: till(s),
      payload: { version: q.version + 5 },
    });
    expect(stale.statusCode).toBe(409);
    const done = await app.inject({
      method: 'POST',
      url: `/v1/device/quotations/${q.id}/convert`,
      headers: till(s),
      payload: { version: q.version },
    });
    expect(done.json<Quotation>().status).toBe('converted');
    const after = await app.inject({ method: 'GET', url: '/v1/device/quotations', headers: till(s) });
    expect(after.json<{ items: unknown[] }>().items).toEqual([]);
    const one = await app.inject({ method: 'GET', url: `/v1/device/quotations/${q.id}`, headers: till(s) });
    expect(one.json<Quotation>().status).toBe('converted');
  });

  it('answers 404 for an id that is not a quotation', async () => {
    const s = await openStore(app);
    const res = await app.inject({ method: 'GET', url: '/v1/quotations/not-an-id', headers: owner(s) });
    expect(res.statusCode).toBe(404);
  });
});
