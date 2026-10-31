import { describe, expect, it } from 'vitest';
import { buildSalePayload, type SaleCart } from '../sale';
import {
  cashMovementPayloadSchema,
  DOCUMENT_PAYLOAD_SCHEMAS,
  hasPayloadSchema,
  INVALID_PAYLOAD,
  salePayloadSchema,
  shiftClosePayloadSchema,
  shiftOpenPayloadSchema,
  validateDocumentPayload,
  type CashMovementPayload,
  type SalePayload,
  type ShiftClosePayload,
  type ShiftOpenPayload,
} from './documents';

const SHIFT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const CASHIER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';
const MANAGER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03';
const CUSTOMER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04';
const PRODUCT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a05';
const VARIANT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a06';
const TAX = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a07';
const USD = { unit: 'USD', quote: 'SYP', rate: '130' } as const;
const approval = { userId: MANAGER, method: 'pin', at: '2026-10-30T10:00:00.000Z', offline: true } as const;

const clone = <T>(value: T): T => structuredClone(value);

function saleCart(overrides: Partial<SaleCart> = {}): SaleCart {
  return {
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [USD],
    lines: [
      {
        lineNo: 1,
        productId: PRODUCT,
        variantId: VARIANT,
        name: 'غلاية كهربائية · أبيض',
        qty: 1000,
        priceCurrency: 'USD',
        priceMinor: 3500,
        taxRateId: TAX,
        taxRateBp: 500,
        discount: { type: 'percent', bp: 2000, source: 'manual', reason: 'زبون دائم', approval },
      },
      {
        lineNo: 2,
        productId: PRODUCT,
        variantId: VARIANT,
        name: 'زيتون أخضر',
        unitName: 'كغ',
        qty: 1250,
        priceCurrency: 'SYP',
        priceMinor: 30000,
        taxRateBp: 0,
      },
    ],
    shiftId: SHIFT,
    cashierId: CASHIER,
    payments: [
      { method: 'card', currency: 'SYP', amountMinor: 100000, reference: '731205', cardLast4: '4821' },
      { method: 'cash', currency: 'USD', amountMinor: 1000 },
      { method: 'cash', currency: 'SYP', amountMinor: 200000 },
    ],
    cashSteps: { SYP: 1000, USD: 25 },
    ...overrides,
  };
}

const validSale = (): SalePayload => buildSalePayload(saleCart());

const issuesOf = (type: string, payload: unknown) => {
  const result = validateDocumentPayload(type, payload);
  return result.ok ? [] : result.issues.map((i) => i.path);
};

describe('sale payload', () => {
  it('accepts what buildSalePayload makes: mixed card, dollars and pounds; credit with a customer; no payment for zero', () => {
    expect(salePayloadSchema.safeParse(validSale()).success).toBe(true);
    const credit = buildSalePayload(
      saleCart({
        payments: [{ method: 'credit', currency: 'SYP', amountMinor: 401500 }],
        customerId: CUSTOMER,
      }),
    );
    expect(salePayloadSchema.safeParse(credit).success).toBe(true);
    const free = buildSalePayload(
      saleCart({ lines: [{ ...saleCart().lines[1]!, priceMinor: 0 }], payments: [] }),
    );
    expect(salePayloadSchema.safeParse(free).success).toBe(true);
  });

  it('keeps unknown keys out of the way (additive fields stay inside contract v1)', () => {
    expect(salePayloadSchema.safeParse({ ...validSale(), loyaltyPoints: 33 }).success).toBe(true);
  });

  const broken: [string, (s: SalePayload) => void, string][] = [
    ['an unbalanced sale', (s) => void (s.totals.totalMinor += 100), 'payments'],
    ['a line number used twice', (s) => void (s.lines[1]!.lineNo = 1), 'lines.1.lineNo'],
    ['a wrong base quantity', (s) => void (s.lines[0]!.baseQty = 999), 'lines.0.baseQty'],
    ['a fractional quantity', (s) => void (s.lines[0]!.qty = 1.5), 'lines.0.qty'],
    ['a zero quantity', (s) => void (s.lines[0]!.qty = 0), 'lines.0.qty'],
    ['a float amount', (s) => void (s.lines[0]!.priced.totalMinor = 10.5), 'lines.0.priced.totalMinor'],
    ['a dollar line without a dollar rate', (s) => void (s.exchangeRates = []), 'lines.0.priceCurrency'],
    [
      'a converted price on a pound line',
      (s) => void (s.lines[1]!.unitPriceMinor += 1),
      'lines.1.unitPriceMinor',
    ],
    ['a taxed line without its rate', (s) => void (s.lines[0]!.taxRateId = null), 'lines.0.taxRateId'],
    [
      'a rate that does not pair with the invoice currency',
      (s) => void (s.exchangeRates = [{ unit: 'USD', quote: 'USD', rate: '1' }]),
      'exchangeRates.0.quote',
    ],
    [
      'an inverted rate',
      (s) => void (s.exchangeRates = [{ unit: 'USD', quote: 'SYP', rate: '0.5' }]),
      'exchangeRates.0.rate',
    ],
    ['two rates for the dollar', (s) => void s.exchangeRates.push({ ...USD }), 'exchangeRates.1'],
    ['a payment number used twice', (s) => void (s.payments[1]!.paymentNo = 1), 'payments.1.paymentNo'],
    ['a dollar payment without a rate', (s) => void (s.payments[1]!.rate = null), 'payments.1.rate'],
    ['a pound payment with a rate', (s) => void (s.payments[2]!.rate = { ...USD }), 'payments.2.rate'],
    [
      'a card without its approval code',
      (s) => void (s.payments[0]!.reference = null),
      'payments.0.reference',
    ],
    ['card digits on cash', (s) => void (s.payments[2]!.cardLast4 = '1234'), 'payments.2.cardLast4'],
    ['a reference on cash', (s) => void (s.payments[2]!.reference = 'x'), 'payments.2.reference'],
    ['a payment of zero', (s) => void (s.payments[2]!.amountMinor = 0), 'payments.2.amountMinor'],
    [
      'an unknown method',
      (s) => void ((s.payments[2] as { method: string }).method = 'barter'),
      'payments.2.method',
    ],
    ['cash rounding without cash', (s) => void (s.payments = s.payments.slice(0, 1)), 'cashRounding'],
    [
      'a rounding that is not due − exact',
      (s) => void (s.cashRounding!.roundingMinor += 1),
      'cashRounding.roundingMinor',
    ],
    ['a malformed shift id', (s) => void (s.shiftId = 'shift-1'), 'shiftId'],
    [
      'a missing field (never left out, null instead)',
      (s) => void delete (s as Partial<SalePayload>).note,
      'note',
    ],
    ['no lines', (s) => void (s.lines = []), 'lines'],
    [
      'the old pound as invoice currency',
      (s) => void ((s as { currency: string }).currency = 'SYP_OLD'),
      'currency',
    ],
  ];
  it.each(broken)('refuses %s', (_name, mutate, path) => {
    const sale = validSale();
    mutate(sale);
    expect(issuesOf('sale', sale)).toContain(path);
  });

  it('refuses credit without a customer or in a foreign currency, and change without cash', () => {
    const credit = buildSalePayload(
      saleCart({
        payments: [{ method: 'credit', currency: 'SYP', amountMinor: 401500 }],
        customerId: CUSTOMER,
      }),
    );
    expect(issuesOf('sale', { ...clone(credit), customerId: null })).toContain('payments.0.method');
    const foreign = clone(credit);
    foreign.payments[0] = { ...foreign.payments[0]!, currency: 'USD', rate: { ...USD } };
    expect(issuesOf('sale', foreign)).toContain('payments.0.currency');
    const change = clone(credit);
    change.change = { currency: 'SYP', amountMinor: 100, rate: null, baseAmountMinor: 100 };
    expect(issuesOf('sale', change)).toContain('change');
  });

  it('refuses change in another currency than the settlement, card payments over the total, and a foreign change without a rate', () => {
    const sale = validSale();
    expect(sale.change).not.toBeNull();
    const other = clone(sale);
    other.change = { ...other.change!, currency: 'USD', rate: { ...USD } };
    expect(issuesOf('sale', other)).toContain('change.currency');
    const noRate = clone(sale);
    noRate.change = { ...noRate.change!, currency: 'USD', rate: null };
    expect(issuesOf('sale', noRate)).toContain('change.rate');
    const overCard = clone(sale);
    overCard.payments[0]!.amountMinor = overCard.payments[0]!.baseAmountMinor = 9_000_000;
    expect(issuesOf('sale', overCard)).toContain('payments');
  });
});

const shiftOpen = (): ShiftOpenPayload => ({
  openedBy: CASHIER,
  mode: 'per_cashier',
  handoverFromShiftId: null,
  opening: [
    {
      currency: 'SYP',
      amountMinor: 3458000,
      denominations: [
        { valueMinor: 50000, count: 40 },
        { valueMinor: 20000, count: 35 },
        { valueMinor: 10000, count: 52 },
        { valueMinor: 5000, count: 30 },
        { valueMinor: 2500, count: 20 },
        { valueMinor: 1000, count: 38 },
      ],
    },
    { currency: 'USD', amountMinor: 20200, denominations: null },
  ],
});

describe('shift_open payload', () => {
  it('accepts counted and typed openings, and a handover naming its shift', () => {
    expect(shiftOpenPayloadSchema.safeParse(shiftOpen()).success).toBe(true);
    const handover = { ...shiftOpen(), mode: 'handover', handoverFromShiftId: SHIFT };
    expect(validateDocumentPayload('shift_open', handover)).toEqual({ ok: true, checked: true });
  });

  it('refuses a count that does not add up, a currency twice, and a handover without its shift', () => {
    const wrongSum = shiftOpen();
    wrongSum.opening[0]!.amountMinor += 1;
    expect(issuesOf('shift_open', wrongSum)).toContain('opening.0.amountMinor');
    expect(
      issuesOf('shift_open', { ...shiftOpen(), opening: [shiftOpen().opening[1], shiftOpen().opening[1]] }),
    ).toContain('opening');
    expect(issuesOf('shift_open', { ...shiftOpen(), mode: 'handover' })).toContain('handoverFromShiftId');
    expect(issuesOf('shift_open', { ...shiftOpen(), handoverFromShiftId: SHIFT })).toContain(
      'handoverFromShiftId',
    );
    expect(issuesOf('shift_open', { ...shiftOpen(), opening: [] })).toContain('opening');
  });
});

const zeroFlows = {
  refundsMinor: 0,
  receiptsMinor: 0,
  fxInMinor: 0,
  fxOutMinor: 0,
};

const shiftClose = (): ShiftClosePayload => ({
  shiftId: SHIFT,
  shiftNumber: 'SFT-001-002-0000012',
  closedBy: CASHIER,
  baseCurrency: 'SYP',
  cash: [
    {
      currency: 'SYP',
      rate: null,
      openingMinor: 3458000,
      cashInMinor: 61230000,
      changeOutMinor: 640000,
      payInMinor: 0,
      payOutMinor: 30000,
      dropsMinor: 15000000,
      ...zeroFlows,
      expectedMinor: 49018000,
      countedMinor: 49118000,
      denominations: null,
      differenceMinor: 100000,
      differenceBaseMinor: 100000,
    },
    {
      currency: 'USD',
      rate: { ...USD },
      openingMinor: 20200,
      cashInMinor: 102000,
      changeOutMinor: 0,
      payInMinor: 0,
      payOutMinor: 0,
      dropsMinor: 0,
      ...zeroFlows,
      expectedMinor: 122200,
      countedMinor: 122000,
      denominations: [
        { valueMinor: 10000, count: 12 },
        { valueMinor: 100, count: 20 },
      ],
      differenceMinor: -200,
      differenceBaseMinor: -26000,
    },
  ],
  shortageTreatment: 'loss',
  approval: null,
  summary: {
    saleCount: 214,
    byMethod: [
      { method: 'cash', currency: 'SYP', count: 142, amountMinor: 60590000 },
      { method: 'cash', currency: 'USD', count: 9, amountMinor: 102000 },
      { method: 'card', currency: 'SYP', count: 31, amountMinor: 18430000 },
    ],
  },
  forced: false,
});

describe('shift_close payload', () => {
  it('accepts a close whose drawers follow the formula of tab 10', () => {
    expect(shiftClosePayloadSchema.safeParse(shiftClose()).success).toBe(true);
    const charged = { ...shiftClose(), shortageTreatment: 'cashier_receivable', approval };
    expect(validateDocumentPayload('shift_close', charged).ok).toBe(true);
  });

  const broken: [string, (c: ShiftClosePayload) => void, string][] = [
    [
      'an expected amount off the formula',
      (c) => void (c.cash[0]!.expectedMinor += 1),
      'cash.0.expectedMinor',
    ],
    [
      'a difference that is not counted − expected',
      (c) => void (c.cash[0]!.differenceMinor = 0),
      'cash.0.differenceMinor',
    ],
    [
      'a base difference off the rate',
      (c) => void (c.cash[1]!.differenceBaseMinor = -200),
      'cash.1.differenceBaseMinor',
    ],
    [
      'a base difference off in the base currency',
      (c) => void (c.cash[0]!.differenceBaseMinor = 1),
      'cash.0.differenceBaseMinor',
    ],
    ['a rate on the base currency', (c) => void (c.cash[0]!.rate = { ...USD }), 'cash.0.rate'],
    ['a foreign drawer without a rate', (c) => void (c.cash[1]!.rate = null), 'cash.1.rate'],
    ['notes that do not add up', (c) => void (c.cash[1]!.countedMinor = 121000), 'cash.1.countedMinor'],
    ['a drawer twice', (c) => void c.cash.push(c.cash[0]!), 'cash'],
    ['a malformed shift number', (c) => void (c.shiftNumber = 'INV-001-002-0000012'), 'shiftNumber'],
    [
      'a shortage charged to the cashier without approval',
      (c) => void (c.shortageTreatment = 'cashier_receivable'),
      'approval',
    ],
  ];
  it.each(broken)('refuses %s', (_name, mutate, path) => {
    const close = shiftClose();
    mutate(close);
    expect(issuesOf('shift_close', close)).toContain(path);
  });
});

const movement = (): CashMovementPayload => ({
  shiftId: SHIFT,
  kind: 'expense',
  currency: 'SYP',
  amountMinor: 30000,
  baseCurrency: 'SYP',
  rate: null,
  baseAmountMinor: 30000,
  reason: 'أجرة نقل كراتين المياه',
  expenseAccountCode: '6105',
  reference: null,
  performedBy: CASHIER,
  approval,
});

describe('cash_movement payload', () => {
  it('accepts an expense, a drop to the safe and a dollar pay-in', () => {
    expect(cashMovementPayloadSchema.safeParse(movement()).success).toBe(true);
    const drop = {
      ...movement(),
      kind: 'safe_drop',
      expenseAccountCode: null,
      amountMinor: 15000000,
      baseAmountMinor: 15000000,
    };
    expect(validateDocumentPayload('cash_movement', drop).ok).toBe(true);
    const dollars = {
      ...movement(),
      kind: 'pay_in',
      expenseAccountCode: null,
      currency: 'USD',
      amountMinor: 5000,
      rate: { ...USD },
      baseAmountMinor: 650000,
    };
    expect(validateDocumentPayload('cash_movement', dollars).ok).toBe(true);
  });

  const broken: [string, Partial<Record<keyof CashMovementPayload, unknown>>, string][] = [
    ['an expense without its account', { expenseAccountCode: null }, 'expenseAccountCode'],
    ['an account outside 6101–6190', { expenseAccountCode: '6200' }, 'expenseAccountCode'],
    ['an account on a drop', { kind: 'safe_drop' }, 'expenseAccountCode'],
    ['a movement without a reason', { reason: '  ' }, 'reason'],
    ['a zero amount', { amountMinor: 0, baseAmountMinor: 0 }, 'amountMinor'],
    ['a base amount off in the base currency', { baseAmountMinor: 1 }, 'baseAmountMinor'],
    ['a rate on the base currency', { rate: { ...USD } }, 'rate'],
    ['dollars without a rate', { currency: 'USD', amountMinor: 5000, baseAmountMinor: 650000 }, 'rate'],
    [
      'dollars converted wrongly',
      { currency: 'USD', amountMinor: 5000, rate: { ...USD }, baseAmountMinor: 5000 },
      'baseAmountMinor',
    ],
    ['an unknown kind', { kind: 'owner_draw' }, 'kind'],
  ];
  it.each(broken)('refuses %s', (_name, patch, path) => {
    expect(issuesOf('cash_movement', { ...movement(), ...patch })).toContain(path);
  });
});

describe('validateDocumentPayload', () => {
  it('checks the four phase-1 types and passes the others unchecked', () => {
    expect(Object.keys(DOCUMENT_PAYLOAD_SCHEMAS)).toEqual([
      'sale',
      'shift_open',
      'shift_close',
      'cash_movement',
    ]);
    expect(hasPayloadSchema('sale')).toBe(true);
    expect(hasPayloadSchema('return')).toBe(false);
    expect(hasPayloadSchema('toString')).toBe(false);
    expect(validateDocumentPayload('return', { anything: true })).toEqual({ ok: true, checked: false });
  });

  it('answers invalid_payload with dotted paths, at most 20 issues', () => {
    const result = validateDocumentPayload('sale', { lines: 'none' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(INVALID_PAYLOAD);
    expect(result.issues.length).toBeGreaterThan(5);
    expect(result.issues.length).toBeLessThanOrEqual(20);
    expect(result.issues.map((i) => i.path)).toContain('shiftId');
    expect(validateDocumentPayload('cash_movement', null)).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    });
  });
});
