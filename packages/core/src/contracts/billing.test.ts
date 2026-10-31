import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerStoreInput } from './auth';
import {
  DEFAULT_GRACE_DAYS,
  READ_ONLY_ALLOWED_WRITES,
  SUBSCRIPTION_STATE_KEYS,
  addMonthsUtc,
  allowedWhenReadOnly,
  billingNumber,
  createInvoiceInput,
  extendEnd,
  normalizeTransactionNumber,
  paidPeriodOnConfirm,
  paymentListQuery,
  planLimitsSchema,
  provisionalUntilFrom,
  submitPaymentInput,
  subscriptionState,
  subscriptionSypAmount,
  transactionNumberSchema,
  type SubscriptionDates,
} from './billing';

const PLAN_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b01';
const ACCOUNT_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b02';
const RECEIPT_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b03';

const DAY = 86_400_000;
const NOW = new Date('2026-10-31T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

const sub = (over: Partial<SubscriptionDates>): SubscriptionDates => ({
  status: 'trialing',
  trialEndsAt: null,
  currentPeriodEnd: null,
  graceEndsAt: null,
  provisionalUntil: null,
  storeSuspended: false,
  ...over,
});

describe('subscriptionState', () => {
  it('runs the trial to its end with every feature, then reads only (no grace after a trial)', () => {
    expect(subscriptionState(sub({ trialEndsAt: days(12) }), NOW)).toEqual({
      state: 'trialing',
      access: 'full',
      endsAt: days(12),
      daysLeft: 12,
    });
    expect(subscriptionState(sub({ trialEndsAt: days(-1) }), NOW)).toEqual({
      state: 'read_only',
      access: 'read_only',
      endsAt: null,
      daysLeft: null,
    });
    expect(subscriptionState(sub({ trialEndsAt: NOW }), NOW).state).toBe('read_only');
    expect(subscriptionState(sub({ trialEndsAt: null }), NOW)).toMatchObject({
      state: 'trialing',
      daysLeft: null,
    });
  });

  it('counts part of a day as a day', () => {
    expect(subscriptionState(sub({ trialEndsAt: new Date(NOW.getTime() + 1000) }), NOW).daysLeft).toBe(1);
  });

  it('keeps a store with a sent payment active for 72 hours, even after its trial (12)', () => {
    const until = provisionalUntilFrom(NOW);
    expect(until).toEqual(new Date(NOW.getTime() + 72 * 3_600_000));
    expect(subscriptionState(sub({ trialEndsAt: days(-3), provisionalUntil: until }), NOW)).toMatchObject({
      state: 'provisional',
      access: 'full',
      daysLeft: 3,
    });
    expect(subscriptionState(sub({ trialEndsAt: days(-3), provisionalUntil: days(-0.1) }), NOW).state).toBe(
      'read_only',
    );
  });

  it('sells through a paid period, then 7 days of grace, then reads only', () => {
    const paid = sub({ status: 'active', currentPeriodEnd: days(5) });
    expect(subscriptionState(paid, NOW)).toMatchObject({ state: 'active', access: 'full', daysLeft: 5 });
    const ended = sub({ status: 'past_due', currentPeriodEnd: days(-2) });
    expect(subscriptionState(ended, NOW)).toMatchObject({
      state: 'grace',
      access: 'full',
      daysLeft: DEFAULT_GRACE_DAYS - 2,
    });
    expect(subscriptionState({ ...ended, graceEndsAt: days(10) }, NOW)).toMatchObject({
      state: 'grace',
      daysLeft: 10,
    });
    expect(subscriptionState(sub({ status: 'active', currentPeriodEnd: days(-8) }), NOW).state).toBe(
      'read_only',
    );
    expect(subscriptionState(sub({ status: 'active', currentPeriodEnd: null }), NOW)).toMatchObject({
      state: 'active',
      endsAt: null,
    });
  });

  it('reads only when the platform suspends the store or the subscription, or it was cancelled', () => {
    const running = { status: 'active' as const, currentPeriodEnd: days(100), provisionalUntil: days(1) };
    expect(subscriptionState(sub({ ...running, storeSuspended: true }), NOW)).toMatchObject({
      state: 'suspended',
      access: 'read_only',
    });
    expect(subscriptionState(sub({ ...running, status: 'suspended' }), NOW).state).toBe('suspended');
    expect(subscriptionState(sub({ ...running, status: 'cancelled' }), NOW)).toMatchObject({
      state: 'cancelled',
      access: 'read_only',
    });
  });

  it('is read-only exactly in the three ended states, and never counts negative days', () => {
    const date = fc.option(fc.integer({ min: -400, max: 400 }).map(days), { nil: null });
    fc.assert(
      fc.property(
        fc.constantFrom('trialing', 'active', 'past_due', 'suspended', 'cancelled' as const),
        date,
        date,
        date,
        date,
        fc.boolean(),
        (status, trialEndsAt, currentPeriodEnd, graceEndsAt, provisionalUntil, storeSuspended) => {
          const r = subscriptionState(
            { status, trialEndsAt, currentPeriodEnd, graceEndsAt, provisionalUntil, storeSuspended },
            NOW,
          );
          expect(SUBSCRIPTION_STATE_KEYS).toContain(r.state);
          expect(r.access === 'read_only').toBe(['read_only', 'suspended', 'cancelled'].includes(r.state));
          if (r.daysLeft !== null) expect(r.daysLeft).toBeGreaterThanOrEqual(0);
          expect(r.endsAt === null || r.endsAt > NOW).toBe(true);
        },
      ),
    );
  });
});

describe('the read-only rule', () => {
  it('lets every read through', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS'])
      expect(allowedWhenReadOnly(method, '/v1/products')).toBe(true);
  });

  it('lets a read-only store pay, sign in, revoke a device and send what it sold', () => {
    expect(allowedWhenReadOnly('POST', '/v1/subscription/invoices/:id/payments')).toBe(true);
    expect(allowedWhenReadOnly('POST', '/v1/uploads')).toBe(true);
    expect(allowedWhenReadOnly('POST', '/v1/devices/:id/revoke')).toBe(true);
    expect(allowedWhenReadOnly('post', '/v1/sync/push')).toBe(true);
    expect(allowedWhenReadOnly('POST', '/v1/auth/refresh')).toBe(true);
  });

  it('stops selling setup and every edit', () => {
    expect(allowedWhenReadOnly('POST', '/v1/products')).toBe(false);
    expect(allowedWhenReadOnly('PATCH', '/v1/products/:id')).toBe(false);
    expect(allowedWhenReadOnly('POST', '/v1/devices/pairing-codes')).toBe(false);
    expect(allowedWhenReadOnly('POST', '/v1/devices/activate')).toBe(false);
    expect(allowedWhenReadOnly('PUT', '/v1/onboarding/store')).toBe(false);
    expect(allowedWhenReadOnly('DELETE', '/v1/subscription/invoices')).toBe(false);
  });

  it('lists only write routes, each once', () => {
    expect(new Set(READ_ONLY_ALLOWED_WRITES).size).toBe(READ_ONLY_ALLOWED_WRITES.length);
    for (const route of READ_ONLY_ALLOWED_WRITES) expect(route.startsWith('POST /v1/')).toBe(true);
  });
});

describe('amounts and periods', () => {
  it('converts dollar prices at the weekly rate into whole pounds (07; the design boards)', () => {
    expect(subscriptionSypAmount(25_000, '130')).toBe(3_250_000); // 250 $ → 32,500 ل.س
    expect(subscriptionSypAmount(1_000, '130')).toBe(130_000); // 10 $ → 1,300 ل.س
    expect(subscriptionSypAmount(2_500, '130')).toBe(325_000); // 25 $ → 3,250 ل.س
    expect(subscriptionSypAmount(1_234, '130.5')).toBe(161_000); // 1,610.37 → 1,610
    expect(subscriptionSypAmount(1_235, '130.5')).toBe(161_200); // 1,611.675 → 1,612
  });

  it('is always a whole number of pounds within half a pound of the exact amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 100, max: 50_000 }),
        (usd, rate) => {
          const out = subscriptionSypAmount(usd, String(rate));
          expect(out % 100).toBe(0);
          expect(Math.abs(out - usd * rate)).toBeLessThanOrEqual(50);
        },
      ),
    );
  });

  it('adds calendar months in UTC, the 31st becoming the last day', () => {
    expect(addMonthsUtc(new Date('2026-01-31T10:00:00Z'), 1)).toEqual(new Date('2026-02-28T10:00:00Z'));
    expect(addMonthsUtc(new Date('2028-01-31T10:00:00Z'), 1)).toEqual(new Date('2028-02-29T10:00:00Z'));
    expect(addMonthsUtc(new Date('2026-11-11T08:30:00Z'), 12)).toEqual(new Date('2027-11-11T08:30:00Z'));
    expect(addMonthsUtc(new Date('2026-12-15T00:00:00Z'), 1)).toEqual(new Date('2027-01-15T00:00:00Z'));
  });

  it('starts the paid year at the trial end when paying during the trial (PlanPay board)', () => {
    const trialEnd = new Date('2026-11-11T09:00:00Z');
    const trial = { status: 'trialing' as const, trialEndsAt: trialEnd, currentPeriodEnd: trialEnd };
    expect(paidPeriodOnConfirm(trial, new Date('2026-10-30T16:42:00Z'), 'yearly')).toEqual({
      start: trialEnd,
      end: new Date('2027-11-11T09:00:00Z'),
    });
  });

  it('adds a renewal to the running period, and starts now after an ended one', () => {
    const end = days(10);
    expect(
      paidPeriodOnConfirm({ status: 'active', trialEndsAt: null, currentPeriodEnd: end }, NOW, 'monthly')
        .start,
    ).toEqual(end);
    const late = paidPeriodOnConfirm(
      { status: 'past_due', trialEndsAt: null, currentPeriodEnd: days(-3) },
      NOW,
      'monthly',
    );
    expect(late).toEqual({ start: NOW, end: new Date('2026-11-30T12:00:00Z') });
    // A trial store's own currentPeriodEnd does not count, only its trial end
    const expired = { status: 'trialing' as const, trialEndsAt: days(-1), currentPeriodEnd: days(40) };
    expect(paidPeriodOnConfirm(expired, NOW, 'monthly').start).toEqual(NOW);
    expect(
      paidPeriodOnConfirm({ status: 'active', trialEndsAt: null, currentPeriodEnd: null }, NOW, 'yearly')
        .start,
    ).toEqual(NOW);
  });

  it("extends one store's 30-day trial by 10 days to 40 (23 › 6), and an ended one from today", () => {
    const start = new Date('2026-10-12T09:00:00Z');
    const trialEnd = new Date(start.getTime() + 30 * DAY);
    const extended = extendEnd(trialEnd, new Date('2026-10-20T09:00:00Z'), 10);
    expect((extended.getTime() - start.getTime()) / DAY).toBe(40);
    expect(extendEnd(days(-5), NOW, 10)).toEqual(days(10));
    expect(extendEnd(null, NOW, 1)).toEqual(days(1));
  });

  it('numbers invoices SUB- and payments SBP- by year', () => {
    expect(billingNumber('invoice', 2026, 1)).toBe('SUB-2026-000001');
    expect(billingNumber('payment', 2026, 311)).toBe('SBP-2026-000311');
    expect(() => billingNumber('invoice', 2026, 0)).toThrow(RangeError);
    expect(() => billingNumber('invoice', 2026, 1_000_000)).toThrow(RangeError);
    expect(() => billingNumber('invoice', 1999, 1)).toThrow(RangeError);
    expect(() => billingNumber('payment', 2026.5, 1)).toThrow(RangeError);
  });
});

describe('transaction numbers', () => {
  it.each([
    ['TX-6F21-90A7', 'TX6F2190A7'],
    ['tx 6f21 90a7', 'TX6F2190A7'],
    ['٨٨٤٢١٣٩٠٧', '884213907'],
    ['HW-778120', 'HW778120'],
    ['#4001/7733.', '40017733'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeTransactionNumber(input)).toBe(expected);
  });

  it.each(['', '123', 'TX-١', 'رقم 884213907', '8842<script>', 'A'.repeat(41)])('refuses %j', (input) => {
    expect(normalizeTransactionNumber(input)).toBeNull();
  });

  it('gives the same number for any spacing or case of the same characters', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z0-9]{4,40}$/),
        fc.array(fc.constantFrom(' ', '-', '/', '.'), { maxLength: 5 }),
        (core, seps) => {
          const messy = [...core]
            .map((ch, i) => (seps[i % (seps.length || 1)] ?? '') + ch.toLowerCase())
            .join('');
          expect(normalizeTransactionNumber(messy)).toBe(core);
          expect(normalizeTransactionNumber(core)).toBe(core);
        },
      ),
    );
  });

  it('gives the form its message', () => {
    expect(transactionNumberSchema.safeParse('??').error?.issues[0]?.message).toBe(
      'رقم العملية غير صحيح. انسخه كما يظهر في تطبيقك',
    );
  });
});

describe('invoice and payment inputs', () => {
  it('makes a yearly invoice unless monthly is chosen', () => {
    expect(createInvoiceInput.parse({ planId: PLAN_ID })).toEqual({ planId: PLAN_ID, cycle: 'yearly' });
    expect(createInvoiceInput.parse({ planId: PLAN_ID, cycle: 'monthly' }).cycle).toBe('monthly');
    expect(createInvoiceInput.safeParse({ planId: PLAN_ID, cycle: 'weekly' }).success).toBe(false);
    expect(createInvoiceInput.safeParse({}).success).toBe(false);
  });

  it('takes the transaction number and the receipt, the amount in pounds by default', () => {
    expect(
      submitPaymentInput.parse({
        accountId: ACCOUNT_ID,
        transactionNumber: 'TX-6F21-90A7',
        receiptUploadId: RECEIPT_ID,
      }),
    ).toEqual({
      accountId: ACCOUNT_ID,
      transactionNumber: 'TX6F2190A7',
      receiptUploadId: RECEIPT_ID,
      paidCurrency: 'SYP',
    });
    expect(
      submitPaymentInput.parse({
        accountId: ACCOUNT_ID,
        transactionNumber: '884213907',
        receiptUploadId: RECEIPT_ID,
        paidAmountMinor: 25_000,
        paidCurrency: 'USD',
        paidAt: '2026-10-29T04:09:00+03:00',
        note: ' من جوال أخي ',
      }),
    ).toMatchObject({ paidAmountMinor: 25_000, paidCurrency: 'USD', note: 'من جوال أخي' });
  });

  it.each([
    [{ transactionNumber: '12' }, 'transactionNumber'],
    [{ receiptUploadId: undefined }, 'receiptUploadId'],
    [{ paidAmountMinor: 0 }, 'paidAmountMinor'],
    [{ paidCurrency: 'EUR' }, 'paidCurrency'],
    [{ paidAt: 'yesterday' }, 'paidAt'],
    [{ accountId: 'shamcash' }, 'accountId'],
  ])('refuses %j', (patch, field) => {
    const result = submitPaymentInput.safeParse({
      accountId: ACCOUNT_ID,
      transactionNumber: '884213907',
      receiptUploadId: RECEIPT_ID,
      ...patch,
    });
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('lists payments by status', () => {
    expect(paymentListQuery.parse({ status: 'pending' })).toEqual({ status: 'pending', limit: 50 });
    expect(paymentListQuery.safeParse({ status: 'lost' }).success).toBe(false);
  });

  it('takes plan limits as numbers or null for unlimited, nothing unknown', () => {
    expect(planLimitsSchema.parse({ branches: 1, registers: 1, products: 2000, users: null })).toEqual({
      branches: 1,
      registers: 1,
      products: 2000,
      users: null,
    });
    expect(planLimitsSchema.safeParse({ branches: -1 }).success).toBe(false);
    expect(planLimitsSchema.safeParse({ branches: 1.5 }).success).toBe(false);
    expect(planLimitsSchema.safeParse({ tables: 3 }).success).toBe(false);
  });
});

describe('sign-up attribution (23 › 7)', () => {
  const base = {
    phone: '0944123456',
    fullName: 'أحمد',
    password: 'long enough pw',
    termsVersion: '2026-10-30',
  };

  it('records whether the agent code came from his link or was typed', () => {
    expect(registerStoreInput.parse({ ...base, agentCode: 'furat-07', agentVia: 'link' })).toMatchObject({
      agentCode: 'FURAT-07',
      agentVia: 'link',
    });
    expect(registerStoreInput.parse({ ...base, agentCode: 'FURAT-07' }).agentVia).toBeUndefined();
    expect(
      registerStoreInput.safeParse({ ...base, agentCode: 'FURAT-07', agentVia: 'whatsapp' }).success,
    ).toBe(false);
  });
});
