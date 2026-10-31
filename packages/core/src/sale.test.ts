import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TradeRate } from './contracts/common';
import { salePayloadSchema, validateDocumentPayload, type SalePayload } from './contracts/documents';
import { convert } from './money';
import { PRICING_ENGINE_VERSION, priceInvoice } from './pricing';
import {
  buildSalePayload,
  businessDateOf,
  discountOverLimit,
  packPrice,
  lineBaseQty,
  priceSale,
  rateFor,
  settleSale,
  verifySalePayload,
  type SaleCart,
  type SaleCartLine,
  type SaleTender,
} from './sale';

const SHIFT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const CASHIER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';
const MANAGER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03';
const CUSTOMER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04';
const TAX = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a05';
const USD_130: TradeRate = { unit: 'USD', quote: 'SYP', rate: '130' };
const STEPS = { SYP: 1000, USD: 25 };

let ids = 0;
const uuid = () => `0192a3b4-c5d6-7e8f-9a0b-${String(++ids).padStart(12, '0')}`;

function line(lineNo: number, priceMinor: number, extra: Partial<SaleCartLine> = {}): SaleCartLine {
  return {
    lineNo,
    productId: uuid(),
    variantId: uuid(),
    name: `صنف ${lineNo}`,
    qty: 1000,
    priceCurrency: 'SYP',
    priceMinor,
    taxRateBp: 0,
    ...extra,
  };
}

function cart(lines: SaleCartLine[], payments: SaleTender[], extra: Partial<SaleCart> = {}): SaleCart {
  return {
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [USD_130],
    lines,
    shiftId: SHIFT,
    cashierId: CASHIER,
    payments,
    cashSteps: STEPS,
    ...extra,
  };
}

const cash = (currency: 'SYP' | 'USD', amountMinor: number, rate?: TradeRate): SaleTender => ({
  method: 'cash',
  currency,
  amountMinor,
  ...(rate ? { rate } : {}),
});

/** Σ payments − change − (total + tip + rounding): zero for every sale that may be sent. */
const imbalance = (sale: SalePayload) =>
  sale.payments.reduce((acc, p) => acc + p.baseAmountMinor, 0) -
  (sale.change?.baseAmountMinor ?? 0) -
  (sale.totals.totalMinor + sale.tipMinor + (sale.cashRounding?.roundingBaseMinor ?? 0));

describe('the golden first sale (23 › المرحلة 1 › أول بيع)', () => {
  // Rate 130. Water 50 ×3, laban 325, tea 600 with 10% off, sugar 275 (the biscuit was removed).
  const lines = [
    line(1, 5000, { qty: 3000, name: 'ماء' }),
    line(3, 32500, { name: 'لبن' }),
    line(4, 60000, {
      name: 'شاي',
      discount: { type: 'percent', bp: 1000, source: 'manual', reason: null, approval: null },
    }),
    line(5, 27500, { name: 'سكر' }),
  ];

  it('totals 1,290.00 ل.س, takes 9 $ then 200 ل.س and gives back 80.00 ل.س', () => {
    const sale = buildSalePayload(cart(lines, [cash('USD', 900), cash('SYP', 20000)]));
    expect(sale.totals.totalMinor).toBe(129000);
    expect(sale.lines.find((l) => l.lineNo === 4)!.priced.totalMinor).toBe(54000);
    expect(
      sale.payments.map((p) => [p.method, p.currency, p.amountMinor, p.baseAmountMinor, p.rate]),
    ).toEqual([
      ['cash', 'USD', 900, 117000, USD_130],
      ['cash', 'SYP', 20000, 20000, null],
    ]);
    expect(sale.change).toEqual({ currency: 'SYP', amountMinor: 8000, rate: null, baseAmountMinor: 8000 });
    expect(sale.cashRounding).toEqual({
      currency: 'SYP',
      stepMinor: 1000,
      exactMinor: 12000,
      dueMinor: 12000,
      roundingMinor: 0,
      roundingBaseMinor: 0,
    });
    expect(imbalance(sale)).toBe(0);
    expect(salePayloadSchema.safeParse(sale).success).toBe(true);
    expect(verifySalePayload(sale)).toEqual([]);
  });

  it('shows 120.00 ل.س still due after the dollars, and refuses to close before it is paid', () => {
    const partial = settleSale({
      currency: 'SYP',
      exchangeRates: [USD_130],
      totalMinor: 129000,
      payments: [cash('USD', 900)],
      cashSteps: STEPS,
    });
    expect(partial).toMatchObject({
      covered: false,
      remainingMinor: 12000,
      remainingCashMinor: 12000,
      change: null,
      cashRounding: null,
    });
    expect(() => buildSalePayload(cart(lines, [cash('USD', 900)]))).toThrow(/still due/);
  });
});

describe('buildSalePayload', () => {
  it('matches the receipt board: 20 $ and 800 on credit for 3,300, 100 ل.س back', () => {
    const sale = buildSalePayload(
      cart(
        [line(1, 330000)],
        [cash('USD', 2000), { method: 'credit', currency: 'SYP', amountMinor: 80000 }],
        { customerId: CUSTOMER, customerName: 'أبو أحمد الخلف' },
      ),
    );
    expect(sale.change).toMatchObject({ currency: 'SYP', amountMinor: 10000 });
    expect(sale.cashRounding).toMatchObject({ exactMinor: -10000, dueMinor: -10000, roundingBaseMinor: 0 });
    expect(salePayloadSchema.safeParse(sale).success).toBe(true);
  });

  it('rounds only the cash part to the step: 12,347.50 is paid 12,350 in cash, 2.50 to 6400 (10 › تقريب النقد)', () => {
    const sale = buildSalePayload(cart([line(1, 1234750)], [cash('SYP', 1235000)]));
    expect(sale.cashRounding).toMatchObject({
      exactMinor: 1234750,
      dueMinor: 1235000,
      roundingBaseMinor: 250,
    });
    expect(sale.change).toBeNull();
    expect(imbalance(sale)).toBe(0);
  });

  it('leaves a credit sale exact: no rounding without cash', () => {
    const sale = buildSalePayload(
      cart([line(1, 1234750)], [{ method: 'credit', currency: 'SYP', amountMinor: 1234750 }], {
        customerId: CUSTOMER,
      }),
    );
    expect(sale.cashRounding).toBeNull();
    expect(sale.change).toBeNull();
  });

  it('prices the worked example of tab 10 (tax exclusive 15%) and gives 5.91 change on 20.00', () => {
    const vat = { taxRateId: TAX, taxRateBp: 1500 };
    const sale = buildSalePayload({
      ...cart(
        [
          line(1, 125, { qty: 2000, priceCurrency: 'USD', ...vat }),
          line(2, 75, { qty: 3000, priceCurrency: 'USD', ...vat }),
          line(3, 890, {
            priceCurrency: 'USD',
            ...vat,
            discount: { type: 'amount', minor: 40, source: 'manual', reason: null, approval: null },
          }),
        ],
        [cash('USD', 2000)],
        { currency: 'USD', exchangeRates: [], taxInclusive: false, cashSteps: {} },
      ),
      invoiceDiscount: {
        type: 'amount',
        minor: 100,
        source: 'manual',
        reason: 'زبون دائم',
        approval: { userId: MANAGER, method: 'pin', at: '2026-10-30T10:00:00.000Z', offline: true },
      },
    });
    expect(sale.totals).toMatchObject({
      grossMinor: 1365,
      discountMinor: 140,
      taxMinor: 184,
      totalMinor: 1409,
    });
    expect(sale.change).toMatchObject({ currency: 'USD', amountMinor: 591 });
    expect(sale.invoiceDiscount?.approval?.userId).toBe(MANAGER);
  });

  it('converts a dollar price at the sale rate and keeps the catalog price beside it', () => {
    const sale = buildSalePayload(cart([line(1, 3500, { priceCurrency: 'USD' })], [cash('SYP', 455000)]));
    expect(sale.lines[0]).toMatchObject({ priceCurrency: 'USD', priceMinor: 3500, unitPriceMinor: 455000 });
    expect(sale.exchangeRates).toEqual([USD_130]);
  });

  it('sells packs: a box of 12 scanned twice moves 24 pieces', () => {
    const sale = buildSalePayload(
      cart(
        [line(1, 145600, { packQty: 12000, qty: 2000, barcode: '16970123450018' })],
        [cash('SYP', 291200)],
      ),
    );
    expect(sale.lines[0]).toMatchObject({
      packQty: 12000,
      qty: 2000,
      baseQty: 24000,
      barcode: '16970123450018',
    });
  });

  it('settles in dollars when the cashier gives change in dollars, rounding to a quarter', () => {
    const sale = buildSalePayload(cart([line(1, 129000)], [cash('USD', 1000)], { changeCurrency: 'USD' }));
    // 1,290 ل.س = 9.92 $ → 10.00 $ in cash; the 10 ل.س difference is the rounding.
    expect(sale.cashRounding).toEqual({
      currency: 'USD',
      stepMinor: 25,
      exactMinor: 992,
      dueMinor: 1000,
      roundingMinor: 8,
      roundingBaseMinor: 1000,
    });
    expect(sale.change).toBeNull();
    expect(imbalance(sale)).toBe(0);
  });

  it('values dollars at the collect rate when the store takes them below the sale rate', () => {
    const collect: TradeRate = { unit: 'USD', quote: 'SYP', rate: '128' };
    const sale = buildSalePayload(cart([line(1, 129000)], [cash('USD', 900, collect), cash('SYP', 20000)]));
    expect(sale.payments[0]).toMatchObject({ baseAmountMinor: 115200, rate: collect });
    expect(sale.cashRounding).toMatchObject({ exactMinor: 13800, dueMinor: 14000, roundingBaseMinor: 200 });
    expect(sale.change).toMatchObject({ amountMinor: 6000 });
  });

  it('adds the tip on top of the total, outside sales', () => {
    const sale = buildSalePayload(cart([line(1, 125000)], [cash('SYP', 150000)], { tipMinor: 5000 }));
    expect(sale.tipMinor).toBe(5000);
    expect(sale.change).toMatchObject({ amountMinor: 20000 });
    expect(imbalance(sale)).toBe(0);
  });

  it('carries card and wallet references and closes a zero sale without payments', () => {
    const card: SaleTender = {
      method: 'card',
      currency: 'SYP',
      amountMinor: 60000,
      reference: '731205',
      cardLast4: '4821',
      cardBrand: 'Visa',
    };
    const sale = buildSalePayload(cart([line(1, 60000)], [card]));
    expect(sale.payments[0]).toMatchObject({
      reference: '731205',
      cardLast4: '4821',
      providerAccountId: null,
    });
    expect(salePayloadSchema.safeParse(sale).success).toBe(true);
    expect(buildSalePayload(cart([line(1, 0)], [])).payments).toEqual([]);
  });

  it('refuses what can never be sent', () => {
    expect(() =>
      buildSalePayload(cart([line(1, 1000)], [{ method: 'credit', currency: 'SYP', amountMinor: 1000 }])),
    ).toThrow(/customer/);
    expect(() =>
      buildSalePayload(
        cart([line(1, 1000)], [{ method: 'card', currency: 'SYP', amountMinor: 2000, reference: '1' }]),
      ),
    ).toThrow(/exceed/);
    expect(() =>
      buildSalePayload(cart([line(1, 1000, { priceCurrency: 'USD' })], [], { exchangeRates: [] })),
    ).toThrow(/no USD\/SYP exchange rate/);
    expect(() =>
      buildSalePayload(
        cart([line(1, 1000)], [cash('USD', 100), cash('USD', 100, { ...USD_130, rate: '128' })], {
          changeCurrency: 'USD',
        }),
      ),
    ).toThrow(/one rate/);
    expect(() => buildSalePayload(cart([line(1, 1000)], [cash('SYP', 0)]))).toThrow(/amountMinor/);
    expect(() =>
      settleSale({ currency: 'SYP', exchangeRates: [], totalMinor: -1, payments: [], cashSteps: {} }),
    ).toThrow(/totalMinor/);
  });
});

describe('settleSale', () => {
  it('waits for a card to pay the exact remainder: no rounding without cash', () => {
    const base = { currency: 'SYP' as const, exchangeRates: [USD_130], totalMinor: 129050, cashSteps: STEPS };
    expect(settleSale({ ...base, payments: [] })).toMatchObject({
      covered: false,
      remainingMinor: 129050,
      remainingCashMinor: 129000,
    });
    const card: SaleTender = { method: 'card', currency: 'SYP', amountMinor: 129050, reference: '1' };
    expect(settleSale({ ...base, payments: [card] })).toMatchObject({
      covered: true,
      remainingMinor: 0,
      cashRounding: null,
    });
  });

  it('lets a few qirsh of cash due round away to nothing', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [],
      totalMinor: 100400,
      payments: [{ method: 'card', currency: 'SYP', amountMinor: 100000, reference: '1' }, cash('SYP', 1000)],
      cashSteps: STEPS,
    });
    // 4.00 ل.س left for cash rounds to 0: the 10 ل.س note comes back whole.
    expect(settled.cashRounding).toMatchObject({ exactMinor: 400, dueMinor: 0, roundingBaseMinor: -400 });
    expect(settled.change).toMatchObject({ amountMinor: 1000 });
  });

  it('closes a sale whose cash left rounds to nothing, with no cash handed over', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [],
      totalMinor: 100400,
      payments: [{ method: 'card', currency: 'SYP', amountMinor: 100000, reference: '1' }],
      cashSteps: STEPS,
    });
    // 4.00 ل.س left rounds to 0 with a 10 ل.س step: nothing to collect, and the rounding is kept.
    expect(settled).toMatchObject({ covered: true, remainingCashMinor: 0, change: null });
    expect(settled.cashRounding).toMatchObject({ exactMinor: 400, dueMinor: 0, roundingBaseMinor: -400 });
    // A remainder that rounds up still waits for cash.
    expect(
      settleSale({
        currency: 'SYP',
        exchangeRates: [],
        totalMinor: 100600,
        payments: [{ method: 'card', currency: 'SYP', amountMinor: 100000, reference: '1' }],
        cashSteps: STEPS,
      }),
    ).toMatchObject({ covered: false, remainingCashMinor: 1000 });
  });

  it('finds rates in either direction and none for the invoice currency', () => {
    const inverse: TradeRate = { unit: 'SYP', quote: 'USD', rate: '1' };
    expect(rateFor([USD_130], 'SYP', 'SYP')).toBeUndefined();
    expect(rateFor([USD_130], 'USD', 'SYP')).toBe(USD_130);
    expect(rateFor([inverse], 'SYP', 'USD')).toBe(inverse);
    expect(rateFor([inverse], 'USD', 'SYP')).toBe(inverse);
    expect(() => rateFor([], 'USD', 'SYP')).toThrow(RangeError);
  });

  it('prices a pack from its own price or from the unit price', () => {
    expect(packPrice(364000, 4000, 1456000)).toBe(1456000);
    expect(packPrice(364000, 4000, null)).toBe(1456000);
    expect(packPrice(333, 1500, null)).toBe(500);
  });

  it('asks for the manager only above the role’s limit', () => {
    // A cashier's limit is 10%: 60.00 off 600.00 is fine, 60.01 is not.
    expect(discountOverLimit(6000, 60000, 1000)).toBe(false);
    expect(discountOverLimit(6001, 60000, 1000)).toBe(true);
    expect(discountOverLimit(1, 60000, 0)).toBe(true);
    expect(discountOverLimit(60000, 60000, 10000)).toBe(false);
  });

  it('computes base quantities and refuses impossible ones', () => {
    expect(lineBaseQty(333, 250)).toBe(83);
    expect(lineBaseQty(1500, 12000)).toBe(18000);
    expect(() => lineBaseQty(0, 1000)).toThrow(/qty/);
    expect(() => lineBaseQty(1000, 0)).toThrow(/packQty/);
  });
});

describe('verifySalePayload', () => {
  const sale = () => buildSalePayload(cart([line(1, 32500), line(2, 60000)], [cash('SYP', 100000)]));

  it('agrees with a payload built by the helper', () => {
    expect(verifySalePayload(sale())).toEqual([]);
    const byCard = buildSalePayload(
      cart([line(1, 32500)], [{ method: 'card', currency: 'SYP', amountMinor: 32500, reference: '1' }]),
    );
    expect(verifySalePayload(byCard)).toEqual([]);
  });

  it('reports every number the engine computes differently (totals_mismatch)', () => {
    const tampered = sale();
    tampered.totals.totalMinor -= 100;
    tampered.lines[1]!.priced.totalMinor -= 100;
    tampered.lines[0]!.baseQty = 2000;
    tampered.payments[0]!.baseAmountMinor += 1;
    tampered.change!.amountMinor += 1000;
    (tampered.lines[0] as { priced: unknown }).priced = [];
    expect(verifySalePayload(tampered).map((m) => m.path)).toEqual([
      'lines.0.baseQty',
      'lines.0.priced',
      'lines.1.priced',
      'totals',
      'payments.0.baseAmountMinor',
      'change',
    ]);
  });

  it('does not depend on the order of keys in what the device sent', () => {
    const reordered = JSON.parse(
      JSON.stringify(sale(), (_k, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
      ),
    ) as SalePayload;
    expect(verifySalePayload(reordered)).toEqual([]);
  });

  it('reports inputs the engine refuses, and payments that do not cover', () => {
    const overDiscount = sale();
    overDiscount.lines[0]!.discount = {
      type: 'amount',
      minor: 99999999,
      source: 'manual',
      reason: null,
      approval: null,
    };
    expect(verifySalePayload(overDiscount)).toEqual([
      { path: 'lines', device: 'priced', engine: expect.any(String) },
    ]);

    const overCard = sale();
    overCard.payments = [
      {
        ...overCard.payments[0]!,
        method: 'card',
        reference: '1',
        amountMinor: 999999,
        baseAmountMinor: 999999,
      },
    ];
    expect(verifySalePayload(overCard).map((m) => m.path)).toContain('payments');

    const short = sale();
    short.payments[0]!.amountMinor = 1000;
    short.payments[0]!.baseAmountMinor = 1000;
    expect(verifySalePayload(short)).toContainEqual({
      path: 'payments',
      device: 'covered',
      engine: expect.any(Number),
    });
  });
});

describe('businessDateOf', () => {
  const lateNight = Date.parse('2026-10-30T22:30:00Z'); // 01:30 on the 31st in Damascus (UTC+3)

  it('is the local date, moved back by the end of the business day', () => {
    expect(businessDateOf(lateNight, 'Asia/Damascus')).toBe('2026-10-31');
    expect(businessDateOf(new Date(lateNight), 'Asia/Damascus', '04:00')).toBe('2026-10-30');
    expect(businessDateOf(lateNight, 'UTC', '04:00')).toBe('2026-10-30');
  });

  it('refuses a malformed cutoff or instant', () => {
    expect(() => businessDateOf(lateNight, 'Asia/Damascus', '4:00')).toThrow(/HH:MM/);
    expect(() => businessDateOf(Number.NaN, 'Asia/Damascus')).toThrow(/instant/);
  });
});

// ─── Properties ──────────────────────────────────────────────────────────────

const RATES = ['130', '13000.125', '99.5', '1'];
const discountArb = fc.option(
  fc.integer({ min: 0, max: 10_000 }).map((bp) => ({
    type: 'percent' as const,
    bp,
    source: 'manual' as const,
    reason: null,
    approval: null,
  })),
  { nil: undefined },
);
const lineArb = fc.record({
  priceMinor: fc.integer({ min: 0, max: 2_000_000 }),
  priceCurrency: fc.constantFrom('SYP' as const, 'USD' as const),
  qty: fc.integer({ min: 1, max: 20_000 }),
  packQty: fc.constantFrom(1000, 12000, 250),
  taxRateBp: fc.constantFrom(0, 500, 1500),
  discount: discountArb,
});
const cartArb = fc.record({
  lines: fc.array(lineArb, { minLength: 1, maxLength: 8 }),
  rate: fc.constantFrom(...RATES),
  taxInclusive: fc.boolean(),
  invoiceDiscountBp: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  tipMinor: fc.integer({ min: 0, max: 50_000 }),
  cardShare: fc.integer({ min: 0, max: 100 }),
  usdTender: fc.integer({ min: 0, max: 50_000 }),
  extraTender: fc.integer({ min: 0, max: 500_000 }),
  changeCurrency: fc.constantFrom('SYP' as const, 'USD' as const),
  sypStep: fc.constantFrom(0, 500, 1000, 5000),
  usdStep: fc.constantFrom(0, 1, 25, 100),
});

type CartCase = typeof cartArb extends fc.Arbitrary<infer T> ? T : never;

/** A sale paid by card for part, dollars for some, and the settlement currency for the rest. */
function caseToCart(c: CartCase): SaleCart {
  const rate: TradeRate = { unit: 'USD', quote: 'SYP', rate: c.rate };
  const lines = c.lines.map((l, i) =>
    line(i + 1, l.priceMinor, { ...l, taxRateId: l.taxRateBp ? TAX : null, discount: l.discount ?? null }),
  );
  const base = cart(lines, [], {
    exchangeRates: [rate],
    taxInclusive: c.taxInclusive,
    tipMinor: c.tipMinor,
    changeCurrency: c.changeCurrency,
    cashSteps: { SYP: c.sypStep, USD: c.usdStep },
    ...(c.invoiceDiscountBp !== undefined
      ? {
          invoiceDiscount: {
            type: 'percent' as const,
            bp: c.invoiceDiscountBp,
            source: 'manual' as const,
            reason: null,
            approval: null,
          },
        }
      : {}),
  });
  const total = priceSale(base).priced.totals.totalMinor;
  const payments: SaleTender[] = [];
  const cardPart = Math.floor(((total + c.tipMinor) * c.cardShare) / 100);
  if (cardPart > 0)
    payments.push({ method: 'card', currency: 'SYP', amountMinor: cardPart, reference: 'A1' });
  if (c.usdTender > 0 && c.changeCurrency === 'SYP') payments.push(cash('USD', c.usdTender));
  const pending = settleSale({ ...base, totalMinor: total, payments });
  const top = pending.remainingCashMinor + c.extraTender;
  if (top > 0) payments.push(cash(c.changeCurrency, top));
  return { ...base, payments };
}

describe('sale payload properties', () => {
  it('the totals are the engine’s, line by line, for any cart', () => {
    fc.assert(
      fc.property(cartArb, (c) => {
        const input = caseToCart(c);
        const sale = buildSalePayload(input);
        const engine = priceInvoice({
          lines: input.lines.map((l) => ({
            lineNo: l.lineNo,
            unitPriceMinor: convert(l.priceMinor, l.priceCurrency, 'SYP', input.exchangeRates[0]),
            qty: l.qty,
            taxRateBp: l.taxRateBp,
            ...(l.discount ? { discount: l.discount } : {}),
          })),
          ...(input.invoiceDiscount ? { invoiceDiscount: input.invoiceDiscount } : {}),
          taxInclusive: input.taxInclusive,
        });
        expect(sale.totals).toEqual(engine.totals);
        sale.lines.forEach((l, i) => expect({ lineNo: l.lineNo, ...l.priced }).toEqual(engine.lines[i]));
      }),
    );
  });

  it('closes a zero sale with a tip too small to collect in the change currency (found by CI)', () => {
    const sale = buildSalePayload(
      caseToCart({
        lines: [
          { priceMinor: 0, priceCurrency: 'SYP', qty: 1, packQty: 1000, taxRateBp: 0, discount: undefined },
        ],
        rate: '130',
        taxInclusive: false,
        invoiceDiscountBp: undefined,
        tipMinor: 1,
        cardShare: 0,
        usdTender: 0,
        extraTender: 0,
        changeCurrency: 'USD',
        sypStep: 0,
        usdStep: 0,
      } as CartCase),
    );
    expect(imbalance(sale)).toBe(0);
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(verifySalePayload(sale)).toEqual([]);
  });

  it('payments always cover the total: Σ payments − change = total + tip + rounding, and the payload is valid', () => {
    fc.assert(
      fc.property(cartArb, (c) => {
        const sale = buildSalePayload(caseToCart(c));
        expect(imbalance(sale)).toBe(0);
        expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
        expect(verifySalePayload(sale)).toEqual([]);
      }),
    );
  });

  it('change and rounding are right with pounds and dollars', () => {
    fc.assert(
      fc.property(cartArb, (c) => {
        const input = caseToCart(c);
        const sale = buildSalePayload(input);
        const r = sale.cashRounding;
        const hasCash = sale.payments.some((p) => p.method === 'cash');
        // Rounding comes with a cash payment, or alone when the cash left rounded to nothing.
        if (hasCash) expect(r).not.toBeNull();
        else expect(r === null || r.dueMinor === 0).toBe(true);
        if (!r) return;
        const step = r.currency === 'SYP' ? c.sypStep : c.usdStep;
        expect(r.currency).toBe(c.changeCurrency);
        expect(r.stepMinor).toBe(step);
        // The cash due is a whole number of steps, at most half a step from the exact amount.
        if (step > 0) expect(Math.abs(r.dueMinor % step)).toBe(0);
        expect(2 * Math.abs(r.roundingMinor)).toBeLessThanOrEqual(step);
        // What was tendered in the settlement currency, less the change, is exactly the cash due.
        const tendered = sale.payments
          .filter((p) => p.method === 'cash' && p.currency === r.currency)
          .reduce((acc, p) => acc + p.amountMinor, 0);
        expect(tendered - (sale.change?.amountMinor ?? 0)).toBe(r.dueMinor);
        expect(sale.change === null || sale.change.amountMinor > 0).toBe(true);
        // In pounds the rounding is the rounding; through dollars it also absorbs the conversion.
        if (r.currency === 'SYP') expect(r.roundingBaseMinor).toBe(r.roundingMinor);
        else {
          const rate = input.exchangeRates[0];
          const bound = convert(Math.ceil(step / 2) + 1, 'USD', 'SYP', rate) + sale.payments.length + 2;
          expect(Math.abs(r.roundingBaseMinor)).toBeLessThanOrEqual(bound);
        }
      }),
    );
  });

  it('is what the document carries as engineVersion', () => {
    expect(PRICING_ENGINE_VERSION).toBe('1.0.0');
  });
});
