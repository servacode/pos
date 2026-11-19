import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  buildSchedule,
  INSTALMENT_FEE_NAME,
  INSTALMENT_FEE_PRODUCT_ID,
  INSTALMENT_FEE_VARIANT_ID,
  type CustomerDetail,
  type CustomerInstalments,
  type InstalmentPlanInput,
  type InstalmentSummary,
  type PlanDetail,
  type PlanListItem,
  type SalePayload,
  type WorklistRow,
  withInstalmentFee,
} from '@serva/core';
import { createUuidV7, payloadHash } from '@serva/sync';
import {
  cartLine,
  compact,
  documents,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser } from './staff';

/**
 * Instalments (packages/core › installments.ts, contracts/installments.ts). The plan a sale carries
 * and what a receipt settles are a projection: the entries posted must be exactly those of the same
 * sale and receipt without a plan.
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

const newId = createUuidV7();
const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function addCustomer(store: Store, name = 'أبو خالد') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: as(store),
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CustomerDetail>();
}

/** Goods 100,000, down payment 20,000 cash, three months at 5% on the 80,000 left: 4,000 markup, 84,000 financed */
function terms(overrides: Partial<InstalmentPlanInput> = {}) {
  const built = buildSchedule({
    totalMinor: 100_000,
    downPaymentMinor: 20_000,
    count: 3,
    frequency: 'monthly',
    firstDueDate: '2026-11-30',
    markupMinor: 4_000,
  });
  const plan: InstalmentPlanInput = {
    id: newId(),
    count: 3,
    frequency: 'monthly',
    firstDueDate: '2026-11-30',
    downPaymentMinor: 20_000,
    principalMinor: built.principalMinor,
    markupMinor: 4_000,
    financedMinor: built.financedMinor,
    markupBp: 500,
    guarantor: { name: 'أبو سامر', phone: '0933000111' },
    borrower: { nationalId: '01010101010' },
    notesMode: 'each',
    schedule: built.instalments,
    ...overrides,
  };
  return plan;
}

function planSale(
  store: Store,
  shiftId: string,
  customerId: string,
  plan: InstalmentPlanInput | null,
): SalePayload {
  const lines = [cartLine(1, 100_000)];
  if (plan) {
    lines.push(
      cartLine(2, plan.markupMinor, {
        productId: INSTALMENT_FEE_PRODUCT_ID,
        variantId: INSTALMENT_FEE_VARIANT_ID,
        name: INSTALMENT_FEE_NAME,
        noInvoiceDiscount: true,
      }),
    );
  }
  const built = sale(store, shiftId, {
    lines,
    payments: [
      { method: 'cash', currency: 'SYP', amountMinor: 20_000 },
      { method: 'credit', currency: 'SYP', amountMinor: plan ? plan.financedMinor : 80_000 },
    ],
    customerId,
    customerName: 'أبو خالد',
  });
  return plan ? { ...built, installmentPlan: plan } : built;
}

const receiptOf = (store: Store, shiftId: string, customerId: string, amountMinor: number, extra = {}) => ({
  customerId,
  customerName: 'أبو خالد',
  shiftId,
  cashierId: store.userId,
  currency: 'SYP',
  amountMinor,
  method: 'cash',
  reference: null,
  note: null,
  ...extra,
});

async function day(store: Store, plan: InstalmentPlanInput | null = terms()) {
  const customer = await addCustomer(store);
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc('sale', planSale(store, open.id, customer.id, plan));
  const res = await push(app, store.device, [open, sold]);
  return { customer, doc, open, sold, res };
}

/** The one plan in the database */
const onlyPlanId = async () => (await ownerDb()<{ id: string }[]>`select id from installment_plans`)[0]!.id;

const plans = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/installment-plans', headers: as(store) })).json<{
    items: PlanListItem[];
  }>().items;

describe('selling on instalments', () => {
  it('keeps the plan beside the sale and posts the sale exactly as it posts without a plan', async () => {
    const store = await openStore(app);
    const { customer, doc, open, sold, res } = await day(store);
    expect(res.results[1]).toMatchObject({ status: 'accepted', flags: [] });

    const rows = await ownerDb()<{ no: number; due_date: string; amount: string }[]>`
      select no, due_date::text, amount_minor::text as amount from installments order by no`;
    expect(rows.map((r) => [r.no, r.due_date, Number(r.amount)])).toEqual([
      [1, '2026-11-30', 28_000],
      [2, '2026-12-30', 28_000],
      [3, '2027-01-30', 28_000],
    ]);
    const [plan] = await ownerDb()<
      { number: string; customer_id: string; financed_minor: string; status: string }[]
    >`
      select number, customer_id, financed_minor::text, status from installment_plans`;
    expect(plan).toMatchObject({
      number: sold.number,
      customer_id: customer.id,
      financed_minor: '84000',
      status: 'active',
    });
    const notes = await ownerDb()<{ number: string; amount_minor: string }[]>`
      select number, amount_minor::text from promissory_notes order by number`;
    expect(notes.map((n) => n.number)).toEqual([
      `${sold.number}-01`,
      `${sold.number}-02`,
      `${sold.number}-03`,
    ]);

    // The same sale without a plan posts the same lines (the markup is only another service line)
    const plain = doc('sale', planSale(store, open.id, customer.id, null));
    await push(app, store.device, [plain]);
    const entries = (await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'sale');
    const withPlan = entries.find((e) => e.sourceId === sold.id)!;
    const without = entries.find((e) => e.sourceId === plain.id)!;
    expect(compact(withPlan)!.map(([code]) => code)).toEqual(compact(without)!.map(([code]) => code));
    expect(compact(withPlan)).toEqual([
      ['111001', 20_000, 0],
      ['1200', 84_000, 0],
      ['4100', 0, 104_000],
    ]);
  });

  it('a re-sent sale makes no second plan', async () => {
    const store = await openStore(app);
    const { sold } = await day(store);
    await push(app, store.device, [sold]);
    expect(await plans(store)).toHaveLength(1);
    const [n] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from installments`;
    expect(n!.n).toBe(3);
  });

  it('a plan that does not add up is left out and flagged, the sale still posts', async () => {
    const store = await openStore(app);
    const bad = terms();
    bad.schedule = bad.schedule.map((s, i) => (i === 0 ? { ...s, amountMinor: s.amountMinor + 1 } : s));
    const { res } = await day(store, bad);
    expect(res.results[1]!.status).toBe('accepted');
    expect(res.results[1]!.flags).toContain('installment_plan_invalid');
    expect(await plans(store)).toHaveLength(0);
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'sale')).toHaveLength(1);
  });

  it('flags a schedule that differs from the server’s own rounding but keeps the printed one', async () => {
    const store = await openStore(app);
    const odd = terms();
    odd.schedule = [
      { no: 1, dueDate: '2026-11-30', amountMinor: 30_000 },
      { no: 2, dueDate: '2026-12-30', amountMinor: 27_000 },
      { no: 3, dueDate: '2027-01-30', amountMinor: 27_000 },
    ];
    const { res } = await day(store, odd);
    expect(res.results[1]!.flags).toContain('schedule_mismatch');
    const rows = await ownerDb()<
      { amount: string }[]
    >`select amount_minor::text as amount from installments order by no`;
    expect(rows.map((r) => Number(r.amount))).toEqual([30_000, 27_000, 27_000]);
  });
});

describe('collecting instalments', () => {
  it('a receipt with allocations settles them in order and posts as a plain receipt does', async () => {
    const store = await openStore(app);
    const { customer, doc, open } = await day(store);
    const planId = await onlyPlanId();
    const paid = doc(
      'receipt',
      receiptOf(store, open.id, customer.id, 28_000, {
        allocations: [{ planId, no: 1, amountMinor: 28_000 }],
      }),
    );
    const part = doc(
      'receipt',
      receiptOf(store, open.id, customer.id, 10_000, {
        allocations: [{ planId, no: 2, amountMinor: 10_000 }],
      }),
    );
    const res = await push(app, store.device, [paid, part]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', []],
      ['accepted', []],
    ]);
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/installment-plans/${planId}`, headers: as(store) })
    ).json<PlanDetail>();
    expect(detail.instalments.map((i) => [i.no, i.paidMinor, i.state])).toEqual([
      [1, 28_000, 'paid'],
      [2, 10_000, 'partial'],
      [3, 0, 'upcoming'],
    ]);
    expect(detail.paidMinor).toBe(38_000);
    expect(detail.remainingMinor).toBe(46_000);
    expect(detail.payments.map((p) => [p.no, p.amountMinor])).toEqual([
      [1, 28_000],
      [2, 10_000],
    ]);

    const receipts = (await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'receipt');
    expect(receipts.map(compact)).toEqual([
      [
        ['111001', 28_000, 0],
        ['1200', 0, 28_000],
      ],
      [
        ['111001', 10_000, 0],
        ['1200', 0, 10_000],
      ],
    ]);
    // Note 1 is paid with its instalment
    const [note] = await ownerDb()<{ status: string }[]>`select status from promissory_notes where no = 1`;
    expect(note!.status).toBe('paid');
  });

  it('two tills paying the same instalment: both receipts stand, the excess is flagged, the instalment is not over-paid', async () => {
    const store = await openStore(app);
    const { customer, doc, open } = await day(store);
    const planId = await onlyPlanId();
    const a = doc(
      'receipt',
      receiptOf(store, open.id, customer.id, 28_000, {
        allocations: [{ planId, no: 1, amountMinor: 28_000 }],
      }),
    );
    const b = doc(
      'receipt',
      receiptOf(store, open.id, customer.id, 28_000, {
        allocations: [{ planId, no: 1, amountMinor: 28_000 }],
      }),
    );
    const res = await push(app, store.device, [a, b]);
    expect(res.results[1]!.flags).toContain('installment_overpaid');
    const [i] = await ownerDb()<
      { paid: string }[]
    >`select paid_minor::text as paid from installments where no = 1`;
    expect(i!.paid).toBe('28000');
    expect((await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'receipt')).toHaveLength(2);
  });

  it('paying everything completes the plan; a receipt naming another customer’s instalment is flagged and ignored', async () => {
    const store = await openStore(app);
    const { customer, doc, open } = await day(store);
    const other = await addCustomer(store, 'أم سامر');
    const planId = await onlyPlanId();
    const stray = doc(
      'receipt',
      receiptOf(store, open.id, other.id, 5_000, { allocations: [{ planId, no: 1, amountMinor: 5_000 }] }),
    );
    const all = doc(
      'receipt',
      receiptOf(store, open.id, customer.id, 84_000, {
        allocations: [1, 2, 3].map((no) => ({ planId, no, amountMinor: 28_000 })),
      }),
    );
    const res = await push(app, store.device, [stray, all]);
    expect(res.results[0]!.flags).toContain('installment_plan_invalid');
    expect(res.results[1]!.flags).toEqual([]);
    const [p] = await ownerDb()<{ status: string }[]>`select status from installment_plans`;
    expect(p!.status).toBe('completed');
    const notes = await ownerDb()<{ status: string }[]>`select status from promissory_notes`;
    expect(notes.every((n) => n.status === 'paid')).toBe(true);
  });

  it('the admin collects on a plan: the payment posts like any customer payment and fills the oldest instalment first', async () => {
    const store = await openStore(app);
    await day(store);
    const planId = await onlyPlanId();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${planId}/collect`,
      headers: as(store),
      payload: { amountMinor: 30_000, method: 'cash' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json<PlanDetail>();
    expect(detail.instalments.map((i) => i.paidMinor)).toEqual([28_000, 2_000, 0]);
    expect(detail.remainingMinor).toBe(54_000);
    const customer = (await ownerDb()<{ id: string }[]>`select id from customers`)[0]!;
    const balance = (
      await app.inject({ method: 'GET', url: `/v1/customers/${customer.id}`, headers: as(store) })
    ).json<CustomerDetail>();
    expect(balance.balanceMinor).toBe(54_000);
    // The plan never holds money: what the customer owes is what the ledger says
    expect(detail.remainingMinor).toBe(balance.balanceMinor);
  });
});

describe('a customer’s plans', () => {
  it('lists only that customer’s plans, for the customer page', async () => {
    const store = await openStore(app);
    const { customer } = await day(store);
    const other = await addCustomer(store, 'أم سامر');
    const mine = await app.inject({
      method: 'GET',
      url: `/v1/installment-plans?customerId=${customer.id}`,
      headers: as(store),
    });
    expect(mine.json<{ items: PlanListItem[] }>().items.map((p) => p.customerId)).toEqual([customer.id]);
    const theirs = await app.inject({
      method: 'GET',
      url: `/v1/installment-plans?customerId=${other.id}`,
      headers: as(store),
    });
    expect(theirs.json<{ items: PlanListItem[] }>().items).toEqual([]);
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/installment-plans?customerId=nope',
      headers: as(store),
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('the due list', () => {
  it('lists what is due today, this week and late, and counts them for the home page', async () => {
    const store = await openStore(app);
    await day(store);
    const planId = await onlyPlanId();
    // Today is 2026-10-30 (the app's clock): move the third instalment to a late day, the second to next week
    await ownerDb()`update installments set due_date = '2026-10-30' where plan_id = ${planId} and no = 1`;
    await ownerDb()`update installments set due_date = '2026-10-25' where plan_id = ${planId} and no = 3`;
    await ownerDb()`update installments set due_date = '2026-11-03' where plan_id = ${planId} and no = 2`;
    const bucket = async (b: string) =>
      (
        await app.inject({ method: 'GET', url: `/v1/installments/worklist?bucket=${b}`, headers: as(store) })
      ).json<{ items: WorklistRow[] }>().items;
    expect((await bucket('today')).map((r) => r.no)).toEqual([1]);
    // The reminder days (a day before, the day itself, three days after) pick what to remind today
    await ownerDb()`update installments set due_date = '2026-10-31' where plan_id = ${planId} and no = 2`;
    await ownerDb()`update installments set due_date = '2026-10-27' where plan_id = ${planId} and no = 3`;
    expect((await bucket('remind')).map((r) => [r.no, r.daysLate])).toEqual([
      [3, 3],
      [1, 0],
      [2, 0],
    ]);
    await ownerDb()`update installments set due_date = '2026-11-03' where plan_id = ${planId} and no = 2`;
    await ownerDb()`update installments set due_date = '2026-10-25' where plan_id = ${planId} and no = 3`;
    expect((await bucket('remind')).map((r) => r.no)).toEqual([1]);
    expect((await bucket('week')).map((r) => r.no)).toEqual([1, 2]);
    const late = await bucket('late');
    expect(late.map((r) => [r.no, r.daysLate, r.remainingMinor])).toEqual([[3, 5, 28_000]]);
    const s = (
      await app.inject({ method: 'GET', url: '/v1/installments/summary', headers: as(store) })
    ).json<InstalmentSummary>();
    expect(s).toMatchObject({
      dueTodayCount: 1,
      dueTodayMinor: 28_000,
      lateCount: 1,
      lateMinor: 28_000,
      activePlans: 1,
      outstandingMinor: 84_000,
    });
    expect((await plans(store))[0]).toMatchObject({
      lateCount: 1,
      lateMinor: 28_000,
      nextDueDate: '2026-10-25',
    });

    const mark = await app.inject({
      method: 'POST',
      url: `/v1/installments/${planId}/3/reminders`,
      headers: as(store),
      payload: { kind: 'late' },
    });
    expect(mark.statusCode).toBe(200);
    expect((await bucket('late'))[0]!.lastReminderAt).not.toBeNull();
  });

  it('the till reads one customer’s plans', async () => {
    const store = await openStore(app);
    const { customer } = await day(store);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/installments/customer/${customer.id}`,
      headers: { authorization: store.device.authorization },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CustomerInstalments>();
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0]).toMatchObject({ financedMinor: 84_000, remainingMinor: 84_000 });
    expect(body.plans[0]!.instalments).toHaveLength(3);
  });
});

describe('returning and cancelling', () => {
  it('a return refunded to the account cancels the last instalments first, and all of it cancels the plan', async () => {
    const store = await openStore(app);
    const { customer, doc, open, sold } = await day(store);
    const payload = planSale(store, open.id, customer.id, terms());
    const back = (qty: number, lineNo: number) => {
      const ret = buildReturnPayload({
        sale: { ...payload, lines: payload.lines },
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'ما أعجبه',
        picks: [{ saleLineNo: lineNo, qty }],
        returned: [],
        refundMethod: 'account',
      });
      const { hash: _hash, ...body } = doc('return', ret);
      const withDeps = { ...body, deps: [sold.id] };
      return { ...withDeps, hash: payloadHash(withDeps) };
    };
    // The markup line goes back (4,000) on the account: the last instalment shrinks
    await push(app, store.device, [back(1000, 2)]);
    const rows = await ownerDb()<
      { amount: string }[]
    >`select amount_minor::text as amount from installments order by no`;
    expect(rows.map((r) => Number(r.amount))).toEqual([28_000, 28_000, 24_000]);
    // The goods go back (100,000 > what is open): nothing is left to pay
    await push(app, store.device, [back(1000, 1)]);
    const [p] = await ownerDb()<{ status: string }[]>`select status from installment_plans`;
    expect(p!.status).toBe('cancelled');
    const notes = await ownerDb()<{ status: string }[]>`select status from promissory_notes`;
    expect(notes.every((n) => n.status === 'cancelled')).toBe(true);
  });

  // Round 37, decision 18: the till adds the instalment fee to a return of the goods (withInstalmentFee); what
  // goes back on the account comes off the plan and the customer's balance together
  describe('the instalment fee goes back with the goods', () => {
    async function returnAsTill(
      store: Store,
      parts: {
        doc: ReturnType<typeof documents>;
        sold: { id: string; number: string | null };
        open: { id: string };
        payload: SalePayload;
      },
      goodsQty: number,
      returned: Parameters<typeof withInstalmentFee>[2] = [],
    ) {
      const picks = withInstalmentFee(parts.payload, [{ saleLineNo: 1, qty: goodsQty }], returned);
      const ret = buildReturnPayload({
        sale: parts.payload,
        saleId: parts.sold.id,
        saleNumber: parts.sold.number!,
        shiftId: parts.open.id,
        cashierId: store.userId,
        reason: 'ما أعجبه',
        picks,
        returned,
        refundMethod: 'account',
      });
      const { hash: _hash, ...body } = parts.doc('return', ret);
      const withDeps = { ...body, deps: [parts.sold.id] };
      await push(app, store.device, [{ ...withDeps, hash: payloadHash(withDeps) }]);
      return ret;
    }

    const owed = async (store: Store) => {
      const customer = (await ownerDb()<{ id: string }[]>`select id from customers`)[0]!;
      const balance = (
        await app.inject({ method: 'GET', url: `/v1/customers/${customer.id}`, headers: as(store) })
      ).json<CustomerDetail>().balanceMinor;
      const detail = (
        await app.inject({
          method: 'GET',
          url: `/v1/installment-plans/${await onlyPlanId()}`,
          headers: as(store),
        })
      ).json<PlanDetail>();
      return { balance, remaining: detail.remainingMinor, status: detail.status };
    };

    it('a part of the goods takes the fee back in proportion, and the plan equals the balance', async () => {
      const store = await openStore(app);
      const parts = await day(store);
      const payload = parts.sold.payload as unknown as SalePayload;
      const ret = await returnAsTill(store, { ...parts, payload }, 500);
      // Half the goods (50,000) and half the fee (2,000) go back on the account
      expect(ret.totals.totalMinor).toBe(52_000);
      expect(ret.lines.map((l) => [l.saleLineNo, l.qty])).toEqual([
        [1, 500],
        [2, 500],
      ]);
      const after = await owed(store);
      expect(after.balance).toBe(84_000 - 52_000);
      expect(after.remaining).toBe(after.balance);
      expect(after.status).toBe('active');
    });

    it('the whole sale returned takes the whole fee, and the plan closes with nothing left to pay on it', async () => {
      const store = await openStore(app);
      const parts = await day(store);
      const payload = parts.sold.payload as unknown as SalePayload;
      const ret = await returnAsTill(store, { ...parts, payload }, 1000);
      // The goods and the full fee (4,000): 104,000 on the account, more than the 84,000 still owed
      expect(ret.totals.totalMinor).toBe(104_000);
      const after = await owed(store);
      expect(after.status).toBe('cancelled');
      expect(after.remaining).toBe(0);
      // The 20,000 paid down is what the customer is owed back: -(104,000 - 84,000)
      expect(after.balance).toBe(-20_000);
    });

    it('a second return that finishes the sale takes the rest of the fee, never more', async () => {
      const store = await openStore(app);
      const parts = await day(store);
      const payload = parts.sold.payload as unknown as SalePayload;
      const first = await returnAsTill(store, { ...parts, payload }, 250);
      expect(first.totals.totalMinor).toBe(25_000 + 1_000);
      const earlier = first.lines.map((l) => ({ saleLineNo: l.saleLineNo, qty: l.qty, ...l.refund }));
      const second = await returnAsTill(store, { ...parts, payload }, 750, earlier);
      // 75,000 of goods and the 3,000 of fee left: the two returns together are the whole sale
      expect(second.totals.totalMinor).toBe(75_000 + 3_000);
      const feeBack = [...first.lines, ...second.lines]
        .filter((l) => l.saleLineNo === 2)
        .reduce((n, l) => n + l.refund.totalMinor, 0);
      expect(feeBack).toBe(4_000);
    });
  });

  it('the owner cancels a plan with a reason; a closed plan cannot be collected on', async () => {
    const store = await openStore(app);
    await day(store);
    const planId = await onlyPlanId();
    const bad = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${planId}/cancel`,
      headers: as(store),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${planId}/cancel`,
      headers: as(store),
      payload: { reason: 'الزبون ألغى' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PlanDetail>()).toMatchObject({
      status: 'cancelled',
      closeReason: 'الزبون ألغى',
      remainingMinor: 0,
    });
    const again = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${planId}/cancel`,
      headers: as(store),
      payload: { reason: 'x' },
    });
    expect(again.statusCode).toBe(409);
    const collect = await app.inject({
      method: 'POST',
      url: `/v1/installment-plans/${planId}/collect`,
      headers: as(store),
      payload: { amountMinor: 1_000 },
    });
    expect(collect.statusCode).toBe(409);
  });
});

describe('who may do what, and whose it is', () => {
  it('a cashier sees no plans; settings need the owner’s settings permission; another store sees nothing', async () => {
    const store = await openStore(app);
    await day(store);
    const planId = await onlyPlanId();
    const [branch] = await ownerDb()<
      { id: string }[]
    >`select id from branches where tenant_id = ${store.tenantId} limit 1`;
    const cashier = await staffUser(app, { ...store, branchId: branch!.id }, 'cashier', '0955333444');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/installment-plans',
          headers: bearer(cashier.accessToken),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/installments/summary',
          headers: bearer(cashier.accessToken),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/installment-plans/${planId}/cancel`,
          headers: bearer(cashier.accessToken),
          payload: { reason: 'x' },
        })
      ).statusCode,
    ).toBe(403);

    const other = await openStore(app, '0955000000');
    expect(await plans(other)).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/installment-plans/${planId}`, headers: as(other) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/installments/${planId}/1/reminders`,
          headers: as(other),
          payload: { kind: 'due' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/installment-plans/${planId}/collect`,
          headers: as(other),
          payload: { amountMinor: 1_000 },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('settings: off and the owner’s defaults at first, saved by the owner and read by the till', async () => {
    const store = await openStore(app);
    const first = await app.inject({
      method: 'GET',
      url: '/v1/store/installments-settings',
      headers: as(store),
    });
    expect(first.json()).toMatchObject({
      enabled: false,
      minDownBp: 2000,
      maxCount: 12,
      reminderBeforeDays: 1,
      reminderAfterDays: 3,
    });
    const input = {
      enabled: true,
      minDownBp: 3000,
      maxCount: 6,
      markupBands: [
        { upToCount: 3, bp: 400 },
        { upToCount: 6, bp: 900 },
      ],
      roundingStepMinor: 1000,
      guarantorOverMinor: null,
      reminderBeforeDays: 2,
      reminderAfterDays: 5,
      notesMode: 'each',
      noteText: null,
      notePlace: 'دمشق',
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/store/installments-settings',
      headers: as(store),
      payload: input,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, minDownBp: 3000 });
    const dup = await app.inject({
      method: 'PUT',
      url: '/v1/store/installments-settings',
      headers: as(store),
      payload: {
        ...input,
        markupBands: [
          { upToCount: 3, bp: 1 },
          { upToCount: 3, bp: 2 },
        ],
      },
    });
    expect(dup.statusCode).toBe(400);
    const pulled = await ownerDb()<
      { installments: { enabled: boolean } }[]
    >`select installments from tenant_settings where tenant_id = ${store.tenantId}`;
    expect(pulled[0]!.installments.enabled).toBe(true);
  });
});
