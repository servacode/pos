import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InventoryResponse,
  PartyStatement,
  PurchaseCorrection,
  PurchaseDetail,
  PurchaseListResponse,
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierRow,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import {
  balances,
  cartLine,
  compact,
  documents,
  makeProduct,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Round 36, decisions 11, 12 and 13 (owner-approved on 2026-11-18): purchasing in dollars, correcting a
 * posted purchase, and a supplier return at the invoice's cost. Every test ends with the trial balance
 * (Σ debit = Σ credit over the whole ledger) and the integrity check, so none of it can unbalance the books.
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
const PIECE = 1000;

async function usdStore(rate = '120') {
  const store = await openStore(app);
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/store/currency',
    headers: as(store),
    payload: { usdEnabled: true, usdRate: rate },
  });
  expect(res.statusCode, res.body).toBe(200);
  return store;
}

async function supplier(store: Store, name = 'مؤسسة الفرات للتوزيع') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: as(store),
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

const post = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: as(store), payload });

async function buy(store: Store, body: Record<string, unknown>) {
  const res = await post(store, '/v1/purchases', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

async function pay(store: Store, body: Record<string, unknown>) {
  const res = await post(store, '/v1/supplier-payments', { date: '2026-10-31', method: 'cash', ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ number: string; amountMinor: number; baseMinor?: number; fxMinor?: number }>();
}

async function suppliersList(store: Store) {
  return (
    await app.inject({ method: 'GET', url: '/v1/suppliers', headers: as(store) })
  ).json<SupplierListResponse>();
}

async function sell(
  store: Store,
  product: { productId: string; variantId: string; name: string },
  pieces: number,
  price: number,
) {
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, price, { ...product, qty: pieces * PIECE })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: price * pieces }],
    }),
  );
  await push(app, store.device, [open, sold]);
}

/** The whole ledger balances: the debits of every line equal the credits, and every entry is balanced */
async function expectBalancedBooks(store: Store) {
  const [row] = await ownerDb()<{ debit: string; credit: string }[]>`
    select sum(debit_minor)::text as debit, sum(credit_minor)::text as credit
    from journal_lines where tenant_id = ${store.tenantId}`;
  expect(row!.debit).toBe(row!.credit);
  const [bad] = await ownerDb()<{ n: string }[]>`
    select count(*)::text as n from journal_entries e
    where e.tenant_id = ${store.tenantId}
      and (select coalesce(sum(debit_minor), 0) from journal_lines l where l.entry_id = e.id and l.tenant_id = e.tenant_id)
        <> (select coalesce(sum(credit_minor), 0) from journal_lines l where l.entry_id = e.id and l.tenant_id = e.tenant_id)`;
  expect(bad!.n).toBe('0');
  const problems = await withTenant(appDb().db, store.tenantId, (tx) =>
    checkIntegrity(tx, store.tenantId),
  ).then((r) => r.checks.flatMap((c) => c.problems));
  expect(problems).toEqual([]);
}

describe('purchasing in dollars (decision 11)', () => {
  it('an invoice in dollars: stock and cost in the base currency, the supplier debt in dollars', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    // 10 pieces for 100.00 dollars, at 120 pounds the dollar: 12,000.00 pounds
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 10_000 }],
    });
    expect(p).toMatchObject({
      totalMinor: 1_200_000,
      currency: 'USD',
      foreignTotalMinor: 10_000,
      rate: '120',
      correctedBy: null,
      lines: [expect.objectContaining({ costMinor: 1_200_000, foreignCostMinor: 10_000 })],
    });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'purchase');
    expect(entry?.lines).toEqual([
      { code: '1300', debit: 1_200_000, credit: 0, currency: 'SYP', amount: 1_200_000 },
      { code: '2100', debit: 0, credit: 1_200_000, currency: 'USD', amount: -10_000 },
    ]);
    const list = await suppliersList(store);
    expect(list.items[0]).toMatchObject({
      balanceMinor: 1_200_000,
      usdBalanceMinor: 10_000,
      usdBookMinor: 1_200_000,
    });
    expect(list.totalOwedMinor).toBe(1_200_000);
    // the stock is valued in the base currency, as always
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items[0]).toMatchObject({ qty: 10 * PIECE, valueMinor: 1_200_000 });
    await expectBalancedBooks(store);
  });

  it('with no rate typed the store rate is used; the dollar must be enabled in the store', async () => {
    const store = await usdStore('125');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 1_000 }],
    });
    expect(p).toMatchObject({ rate: '125', totalMinor: 125_000 });

    // The dollar switched off in the settings: a dollar invoice is refused, in Arabic
    const off = await app.inject({
      method: 'PUT',
      url: '/v1/store/currency',
      headers: as(store),
      payload: { usdEnabled: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    const refused = await post(store, '/v1/purchases', {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 1_000 }],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.fields.currency).toContain('الدولار');
  });

  it('pays in dollars at the same rate: no exchange difference', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 10_000 }],
    });
    const paid = await pay(store, { supplierId: s.id, amountMinor: 10_000, currency: 'USD', rate: '120' });
    expect(paid).toMatchObject({ amountMinor: 10_000, baseMinor: 1_200_000, fxMinor: 0 });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'supplier_payment');
    expect(entry?.lines).toEqual([
      { code: '2100', debit: 1_200_000, credit: 0, currency: 'USD', amount: 10_000 },
      { code: '112002', debit: 0, credit: 1_200_000, currency: 'USD', amount: -10_000 },
    ]);
    const b = await balances(store.tenantId);
    expect(b.get('2100')).toEqual({ base: 0, amount: 0 });
    expect(b.get('6510')).toBeUndefined();
    expect((await suppliersList(store)).items[0]).toMatchObject({
      balanceMinor: 0,
      usdBalanceMinor: 0,
      usdBookMinor: 0,
    });
    await expectBalancedBooks(store);
  });

  it('paid at another rate: the difference goes to 6510, a loss then a gain, and the books balance', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 10_000 }],
    });
    // 40 dollars at 130: costs 5,200.00 pounds for a debt the books hold at 4,800.00: a loss of 400.00
    const first = await pay(store, { supplierId: s.id, amountMinor: 4_000, currency: 'USD', rate: '130' });
    expect(first).toMatchObject({ baseMinor: 520_000, fxMinor: 40_000 });
    const loss = (await postedEntries(store.tenantId))
      .filter((e) => e.sourceType === 'supplier_payment')
      .at(-1);
    expect(compact(loss)).toEqual([
      ['2100', 480_000, 0],
      ['6510', 40_000, 0],
      ['112002', 0, 520_000],
    ]);
    // the rest is still held at the rate it came at
    expect((await suppliersList(store)).items[0]).toMatchObject({
      balanceMinor: 720_000,
      usdBalanceMinor: 6_000,
      usdBookMinor: 720_000,
    });
    // the last 60 dollars at 110: costs 6,600.00 for a debt held at 7,200.00: a gain of 600.00
    const second = await pay(store, { supplierId: s.id, amountMinor: 6_000, currency: 'USD', rate: '110' });
    expect(second).toMatchObject({ baseMinor: 660_000, fxMinor: -60_000 });
    const gain = (await postedEntries(store.tenantId))
      .filter((e) => e.sourceType === 'supplier_payment')
      .at(-1);
    expect(compact(gain)).toEqual([
      ['2100', 720_000, 0],
      ['112002', 0, 660_000],
      ['6510', 0, 60_000],
    ]);
    const b = await balances(store.tenantId);
    expect(b.get('2100')).toEqual({ base: 0, amount: 0 });
    // the account reads: 400 lost, 600 gained: a net gain of 200.00 (a credit balance on the expense account)
    expect(b.get('6510')?.base).toBe(-20_000);
    await expectBalancedBooks(store);
  });

  it('a payment above the dollars owed needs the advance confirmation; a pound payment cannot settle dollars', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 5_000 }],
    });
    const over = await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-10-31',
      method: 'cash',
      currency: 'USD',
      amountMinor: 9_000,
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.fields.amountMinor).toContain('بالدولار');
    const inPounds = await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-10-31',
      method: 'cash',
      amountMinor: 100_000,
    });
    expect(inPounds.statusCode).toBe(409);
    expect(inPounds.json().error.fields.amountMinor).toContain('ادفع بالدولار');
    // the advance confirmed: the extra dollars stay as the supplier's debt to the store
    await pay(store, { supplierId: s.id, amountMinor: 9_000, currency: 'USD', rate: '120', advance: true });
    expect((await suppliersList(store)).items[0]).toMatchObject({
      usdBalanceMinor: -4_000,
      balanceMinor: -480_000,
    });
    await expectBalancedBooks(store);
  });

  it('a cheque is written in pounds: not with a dollar payment', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 5_000 }],
    });
    const res = await post(store, '/v1/supplier-payments', {
      supplierId: s.id,
      date: '2026-10-31',
      method: 'bank',
      currency: 'USD',
      amountMinor: 1_000,
      cheque: { bank: 'بنك سوريا', number: '123', dueDate: '2026-12-01' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('mixed suppliers: one in pounds, one in dollars, each paid in its own currency', async () => {
    const store = await usdStore('120');
    const pounds = await supplier(store, 'مورد بالليرة');
    const dollars = await supplier(store, 'مورد بالدولار');
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: pounds.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 5 * PIECE, costMinor: 200_000 }],
    });
    await buy(store, {
      supplierId: dollars.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 5 * PIECE, costMinor: 5_000 }],
    });
    const list = await suppliersList(store);
    const by = (id: string) => list.items.find((x) => x.id === id)!;
    expect(by(pounds.id)).toMatchObject({ balanceMinor: 200_000, usdBalanceMinor: 0 });
    expect(by(dollars.id)).toMatchObject({ balanceMinor: 600_000, usdBalanceMinor: 5_000 });
    expect(list.totalOwedMinor).toBe(800_000);
    // dollars to the pound supplier: nothing owed in dollars
    const wrong = await post(store, '/v1/supplier-payments', {
      supplierId: pounds.id,
      date: '2026-10-31',
      method: 'cash',
      currency: 'USD',
      amountMinor: 1_000,
    });
    expect(wrong.statusCode).toBe(409);
    await pay(store, { supplierId: pounds.id, amountMinor: 200_000 });
    await pay(store, { supplierId: dollars.id, amountMinor: 5_000, currency: 'USD', rate: '120' });
    const after = await suppliersList(store);
    expect(after.totalOwedMinor).toBe(0);
    const b = await balances(store.tenantId);
    expect(b.get('112001')?.base).toBe(-200_000);
    expect(b.get('112002')).toEqual({ base: -600_000, amount: -5_000 });
    await expectBalancedBooks(store);
  });

  it('a dollar invoice paid from the dollar safe at once, and the supplier statement in dollars', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'cash',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 2 * PIECE, costMinor: 2_000 }],
    });
    const b = await balances(store.tenantId);
    expect(b.get('112002')).toEqual({ base: -240_000, amount: -2_000 });
    expect(b.get('2100')).toBeUndefined();
    // a credit invoice and a part-payment, then the statement
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      lines: [{ variantId: milk.variantId, qty: 3 * PIECE, costMinor: 3_000 }],
    });
    await pay(store, { supplierId: s.id, amountMinor: 1_000, currency: 'USD', rate: '120' });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/suppliers/${s.id}/statement?from=2026-10-01&to=2026-10-31`,
      headers: as(store),
    });
    expect(res.statusCode, res.body).toBe(200);
    const st = res.json<PartyStatement>();
    expect(st.usd).toEqual({
      openingMinor: 0,
      totalDebitMinor: 1_000,
      totalCreditMinor: 3_000,
      closingMinor: 2_000,
    });
    expect(st.lines.map((l) => l.usdBalanceMinor)).toEqual([3_000, 2_000]);
    expect(st.closingMinor).toBe(240_000);
    await expectBalancedBooks(store);
  });

  it('old pound purchases, payments and statements are exactly what they were', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    expect(p.currency).toBeUndefined();
    expect(p.lines[0]!.foreignCostMinor).toBeUndefined();
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'purchase');
    expect(compact(entry)).toEqual([
      ['1300', 200_000, 0],
      ['2100', 0, 200_000],
    ]);
    await pay(store, { supplierId: s.id, amountMinor: 50_000 });
    const st = (
      await app.inject({
        method: 'GET',
        url: `/v1/suppliers/${s.id}/statement?from=2026-10-01&to=2026-10-31`,
        headers: as(store),
      })
    ).json<PartyStatement>();
    expect(st.usd).toBeUndefined();
    expect(st.lines[0]!.usdBalanceMinor).toBeUndefined();
    expect(st.closingMinor).toBe(150_000);
    const row = (await suppliersList(store)).items[0]!;
    expect(row).toMatchObject({ balanceMinor: 150_000, usdBalanceMinor: 0, usdBookMinor: 0 });
    const listed = (
      await app.inject({ method: 'GET', url: '/v1/purchases', headers: as(store) })
    ).json<PurchaseListResponse>();
    expect(listed.items[0]!.currency).toBeUndefined();
    await expectBalancedBooks(store);
  });
});

describe('correcting a posted purchase (decision 12)', () => {
  async function bought(store: Store, extra: Record<string, unknown> = {}) {
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      reference: 'F-77',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
      ...extra,
    });
    return { s, milk, p };
  }

  it('posts a full reversal, takes the stock out at its cost, clears the debt and answers a draft', async () => {
    const store = await openStore(app);
    const { s, milk, p } = await bought(store);
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {
      date: '2026-11-01',
      reason: 'الكلفة خطأ',
    });
    expect(res.statusCode, res.body).toBe(201);
    const done = res.json<PurchaseCorrection>();
    expect(done.reversal).toMatchObject({
      number: 'PRV-2026-000001',
      date: '2026-11-01',
      valueOutMinor: 200_000,
    });
    expect(done.draft).toMatchObject({
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      reference: 'F-77',
      currency: 'SYP',
      lines: [
        expect.objectContaining({
          variantId: milk.variantId,
          qty: 10 * PIECE,
          costMinor: 200_000,
          name: 'حليب',
        }),
      ],
    });
    const entries = await postedEntries(store.tenantId);
    const reversal = entries.find((e) => e.sourceType === 'reversal');
    expect(compact(reversal)).toEqual([
      ['2100', 200_000, 0],
      ['1300', 0, 200_000],
    ]);
    const b = await balances(store.tenantId);
    expect(b.get('2100')?.base).toBe(0);
    expect(b.get('1300')?.base).toBe(0);
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items.find((i) => i.variantId === milk.variantId)).toMatchObject({ qty: 0, valueMinor: 0 });
    expect((await suppliersList(store)).items[0]).toMatchObject({ balanceMinor: 0 });
    // the invoice shows it was corrected, and cannot be corrected twice
    const read = (
      await app.inject({ method: 'GET', url: `/v1/purchases/${p.id}`, headers: as(store) })
    ).json<PurchaseDetail>();
    expect(read.correctedBy).toMatchObject({ number: 'PRV-2026-000001' });
    const again = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain('صُحّحت');
    await expectBalancedBooks(store);
  });

  it('the corrected invoice is written again from the draft and the books show only the new one', async () => {
    const store = await openStore(app);
    const { milk, p } = await bought(store);
    const done = (await post(store, `/v1/purchases/${p.id}/correct`, {})).json<PurchaseCorrection>();
    const again = await buy(store, {
      supplierId: done.draft.supplierId,
      date: done.draft.date,
      payment: done.draft.payment,
      reference: done.draft.reference,
      lines: done.draft.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, costMinor: 180_000 })),
    });
    expect(again.totalMinor).toBe(180_000);
    const b = await balances(store.tenantId);
    expect(b.get('2100')?.base).toBe(-180_000);
    expect(b.get('1300')?.base).toBe(180_000);
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items.find((i) => i.variantId === milk.variantId)).toMatchObject({
      qty: 10 * PIECE,
      valueMinor: 180_000,
    });
    await expectBalancedBooks(store);
  });

  it('refuses when part of the stock was sold beyond what is on hand, in Arabic, and posts nothing', async () => {
    const store = await openStore(app);
    const { milk, p } = await bought(store);
    await sell(store, milk, 6, 25_000);
    const before = (await postedEntries(store.tenantId)).length;
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
    expect(res.json().error.message).toContain('بِيع جزء');
    expect(res.json().error.message).toContain('مرتجعاً إلى المورد');
    expect((await postedEntries(store.tenantId)).length).toBe(before);
    const [n] = await ownerDb()<
      { n: string }[]
    >`select count(*)::text as n from purchase_reversals where tenant_id = ${store.tenantId}`;
    expect(n!.n).toBe('0');
    await expectBalancedBooks(store);
  });

  it('with stock from another purchase still on hand, only this one goes out, at its own cost', async () => {
    const store = await openStore(app);
    const { s, milk, p } = await bought(store);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 400_000 }],
    });
    await sell(store, milk, 6, 25_000);
    // 20 pieces held at 600,000; six sold at the average 30,000 each (180,000): 14 left at 420,000
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(res.statusCode, res.body).toBe(201);
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items.find((i) => i.variantId === milk.variantId)).toMatchObject({
      qty: 4 * PIECE,
      valueMinor: 220_000,
    });
    await expectBalancedBooks(store);
  });

  it('a cash purchase: the cash comes back to the safe', async () => {
    const store = await openStore(app);
    const { p } = await bought(store, { payment: 'cash' });
    expect((await balances(store.tenantId)).get('112001')?.base).toBe(-200_000);
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(res.statusCode, res.body).toBe(201);
    expect((await balances(store.tenantId)).get('112001')?.base).toBe(0);
    await expectBalancedBooks(store);
  });

  it('a dollar invoice: the dollar debt goes back at the rate it was booked at, with no exchange difference', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      rate: '118',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 10_000 }],
    });
    // the store rate has moved since: the correction does not care
    await app.inject({
      method: 'PUT',
      url: '/v1/store/currency',
      headers: as(store),
      payload: { usdEnabled: true, usdRate: '140' },
    });
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(res.statusCode, res.body).toBe(201);
    const done = res.json<PurchaseCorrection>();
    expect(done.draft).toMatchObject({
      currency: 'USD',
      rate: '118',
      lines: [expect.objectContaining({ costMinor: 10_000 })],
    });
    expect((await suppliersList(store)).items[0]).toMatchObject({
      balanceMinor: 0,
      usdBalanceMinor: 0,
      usdBookMinor: 0,
    });
    const b = await balances(store.tenantId);
    expect(b.get('6510')).toBeUndefined();
    expect(b.get('2100')).toEqual({ base: 0, amount: 0 });
    await expectBalancedBooks(store);
  });

  it('a purchase that received an order puts the order back to waiting', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const order = await post(store, '/v1/purchase-orders', {
      supplierId: s.id,
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    expect(order.statusCode, order.body).toBe(201);
    const orderId = order.json<{ id: string }>().id;
    const sent = await post(store, `/v1/purchase-orders/${orderId}/status`, {
      status: 'sent',
      version: order.json<{ version: number }>().version,
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      purchaseOrderId: orderId,
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    expect(p.purchaseOrderId).toBe(orderId);
    const res = await post(store, `/v1/purchases/${p.id}/correct`, {});
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<PurchaseCorrection>().draft.purchaseOrderId).toBe(orderId);
    const after = (
      await app.inject({ method: 'GET', url: `/v1/purchase-orders/${orderId}`, headers: as(store) })
    ).json<{
      status: string;
      receipts: unknown[];
      lines: { receivedQty: number }[];
    }>();
    expect(after).toMatchObject({ status: 'sent', receipts: [], lines: [{ receivedQty: 0 }] });
    await expectBalancedBooks(store);
  });
});

describe('a supplier return at the invoice cost (decision 13)', () => {
  const returnBody = (s: SupplierRow, milkId: string, extra: Record<string, unknown>, qty = 4 * PIECE) => ({
    supplierId: s.id,
    date: '2026-11-02',
    refund: 'credit',
    lines: [{ variantId: milkId, qty }],
    ...extra,
  });

  it('credits the invoice line cost; the stock leaves at the average and the difference goes to 5100', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const first = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-31',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 400_000 }],
    });
    // 20 pieces at 600,000: the average is 30,000 a piece; the first invoice cost 20,000 a piece
    const res = await post(
      store,
      '/v1/supplier-returns',
      returnBody(s, milk.variantId, { purchaseId: first.id }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const ret = res.json<SupplierReturnDetail>();
    expect(ret).toMatchObject({
      purchaseId: first.id,
      purchaseNumber: first.number,
      amountMinor: 80_000,
      costMinor: 120_000,
      lines: [expect.objectContaining({ amountMinor: 80_000, costMinor: 120_000, invoiceCostMinor: 80_000 })],
    });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'supplier_return');
    expect(compact(entry)).toEqual([
      ['2100', 80_000, 0],
      ['5100', 40_000, 0],
      ['1300', 0, 120_000],
    ]);
    const b = await balances(store.tenantId);
    expect(b.get('2100')?.base).toBe(-520_000);
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items[0]).toMatchObject({ qty: 16 * PIECE, valueMinor: 480_000 });
    await expectBalancedBooks(store);
  });

  it('a return with no invoice works as it did: credited at the average cost', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    const res = await post(store, '/v1/supplier-returns', returnBody(s, milk.variantId, {}));
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<SupplierReturnDetail>()).toMatchObject({ amountMinor: 80_000, costMinor: 80_000 });
    expect(res.json<SupplierReturnDetail>().purchaseId).toBeUndefined();
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'supplier_return');
    expect(compact(entry)).toEqual([
      ['2100', 80_000, 0],
      ['1300', 0, 80_000],
    ]);
    await expectBalancedBooks(store);
  });

  it('refuses an item not on the invoice, another supplier invoice, and more than was bought', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const other = await supplier(store, 'مورد آخر');
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const tea = await makeProduct(app, store, 'شاي', 10_000);
    const inv = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: tea.variantId, qty: 10 * PIECE, costMinor: 50_000 }],
    });
    const notOn = await post(
      store,
      '/v1/supplier-returns',
      returnBody(s, tea.variantId, { purchaseId: inv.id }),
    );
    expect(notOn.statusCode).toBe(400);
    expect(notOn.json().error.fields['lines.0.variantId']).toContain('ليس في الفاتورة');
    const wrongSupplier = await post(
      store,
      '/v1/supplier-returns',
      returnBody(other, milk.variantId, { purchaseId: inv.id }),
    );
    expect(wrongSupplier.statusCode).toBe(400);
    expect(wrongSupplier.json().error.fields.purchaseId).toContain('ليست من هذا المورد');
    expect(
      (
        await post(
          store,
          '/v1/supplier-returns',
          returnBody(s, milk.variantId, { purchaseId: inv.id }, 7 * PIECE),
        )
      ).statusCode,
    ).toBe(201);
    const tooMuch = await post(
      store,
      '/v1/supplier-returns',
      returnBody(s, milk.variantId, { purchaseId: inv.id }, 4 * PIECE),
    );
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.fields['lines.0.qty']).toContain('المتبقي');
    await expectBalancedBooks(store);
  });

  it('on a dollar invoice the credit is in dollars at the invoice rate: the dollar debt comes down, no exchange difference', async () => {
    const store = await usdStore('120');
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const inv = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      currency: 'USD',
      rate: '118',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 10_000 }],
    });
    const res = await post(
      store,
      '/v1/supplier-returns',
      returnBody(s, milk.variantId, { purchaseId: inv.id }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const ret = res.json<SupplierReturnDetail>();
    // 4 of 10 pieces: 40.00 dollars at 118: 4,720.00 pounds
    expect(ret).toMatchObject({
      currency: 'USD',
      rate: '118',
      foreignAmountMinor: 4_000,
      amountMinor: 472_000,
    });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'supplier_return');
    expect(entry?.lines).toEqual([
      { code: '2100', debit: 472_000, credit: 0, currency: 'USD', amount: 4_000 },
      { code: '1300', debit: 0, credit: 472_000, currency: 'SYP', amount: -472_000 },
    ]);
    expect((await suppliersList(store)).items[0]).toMatchObject({
      usdBalanceMinor: 6_000,
      usdBookMinor: 708_000,
    });
    expect((await balances(store.tenantId)).get('6510')).toBeUndefined();
    await expectBalancedBooks(store);
  });
});
