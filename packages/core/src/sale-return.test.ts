import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { returnPayloadSchema, validateDocumentPayload, type SalePayload } from './contracts/documents';
import { buildSalePayload, priceSale, type SaleCartLine } from './sale';
import {
  buildReturnPayload,
  defaultForeignRefund,
  defaultRefundMethod,
  paidForeign,
  returnableLines,
  returnAmounts,
  type ReturnedLine,
} from './sale-return';

const SHIFT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const CASHIER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';
const SALE_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a09';
const TAX = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a05';

let ids = 0;
const uuid = () => `0192a3b4-c5d6-7e8f-9a0b-${String(++ids).padStart(12, '0')}`;

const line = (lineNo: number, priceMinor: number, extra: Partial<SaleCartLine> = {}): SaleCartLine => ({
  lineNo,
  productId: uuid(),
  variantId: uuid(),
  name: `صنف ${lineNo}`,
  qty: 1000,
  priceCurrency: 'SYP',
  priceMinor,
  taxRateBp: 0,
  ...extra,
});

function aSale(
  lines: SaleCartLine[],
  method: 'cash' | 'card' = 'cash',
  invoiceDiscountBp?: number,
): SalePayload {
  const draft = priceSale({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [],
    lines,
    ...(invoiceDiscountBp
      ? {
          invoiceDiscount: {
            type: 'percent',
            bp: invoiceDiscountBp,
            source: 'manual',
            reason: null,
            approval: null,
          },
        }
      : {}),
  } as never);
  const due = draft.priced.totals.totalMinor;
  return buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [],
    shiftId: SHIFT,
    cashierId: CASHIER,
    cashSteps: {},
    lines,
    payments:
      method === 'cash'
        ? [{ method: 'cash', currency: 'SYP', amountMinor: due }]
        : [{ method: 'card', currency: 'SYP', amountMinor: due, reference: 'C1' }],
    ...(invoiceDiscountBp
      ? {
          invoiceDiscount: {
            type: 'percent',
            bp: invoiceDiscountBp,
            source: 'manual',
            reason: null,
            approval: null,
          },
        }
      : {}),
  } as never);
}

const request = (
  sale: SalePayload,
  picks: { saleLineNo: number; qty: number }[],
  returned: ReturnedLine[] = [],
) => ({
  sale,
  saleId: SALE_ID,
  saleNumber: 'INV-001-002-0000001',
  shiftId: SHIFT,
  cashierId: CASHIER,
  reason: 'الزبون غيّر رأيه',
  picks,
  returned,
});

const asReturned = (payload: ReturnType<typeof buildReturnPayload>): ReturnedLine[] =>
  payload.lines.map((l) => ({ saleLineNo: l.saleLineNo, qty: l.qty, ...l.refund }));

describe('a return', () => {
  it('of a whole line gives back exactly what the line took, and passes its schema', () => {
    const sale = aSale([line(1, 125_000, { qty: 2000 }), line(2, 37_500)]);
    const r = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 2000 }]));
    const sold = sale.lines[0]!.priced;
    expect(r.lines[0]!.refund).toEqual({
      grossExTaxMinor: sold.grossExTaxMinor,
      discountExTaxMinor: sold.discountExTaxMinor,
      taxMinor: sold.taxMinor,
      totalMinor: sold.totalMinor,
    });
    expect(r.totals.totalMinor).toBe(250_000);
    expect(r.refunds).toEqual([{ method: 'cash', currency: 'SYP', amountMinor: 250_000, reference: null }]);
    expect(validateDocumentPayload('return', r)).toEqual({ ok: true, checked: true });
  });

  it('says it is damaged only when it is (round 35, D7), and passes its schema either way', () => {
    const sale = aSale([line(1, 125_000, { qty: 2000 })]);
    const picks = [{ saleLineNo: 1, qty: 1000 }];
    const ordinary = buildReturnPayload(request(sale, picks));
    // An ordinary return carries no flag at all: it is exactly what every earlier till made
    expect('damaged' in ordinary).toBe(false);
    expect(buildReturnPayload({ ...request(sale, picks), damaged: false })).toEqual(ordinary);
    const broken = buildReturnPayload({ ...request(sale, picks), damaged: true });
    expect(broken).toEqual({ ...ordinary, damaged: true });
    expect(validateDocumentPayload('return', broken)).toEqual({ ok: true, checked: true });
    expect(validateDocumentPayload('return', ordinary)).toEqual({ ok: true, checked: true });
  });

  it('in pieces adds up, to the qirsh, to the line it came from, with tax and a discount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9_999_99 }),
        fc.integer({ min: 2, max: 9 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 1500 }),
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 5 }),
        (price, units, bp, taxBp, parts) => {
          const sale = aSale(
            [line(1, price, { qty: units * 1000, taxRateId: taxBp ? TAX : null, taxRateBp: taxBp })],
            'cash',
            bp,
          );
          const sold = sale.lines[0]!;
          let returned: ReturnedLine[] = [];
          let left = sold.qty;
          for (const part of parts) {
            if (left === 0) break;
            const qty = Math.min(left, part * 1000);
            const r = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty }], returned));
            expect(returnPayloadSchema.safeParse(r).error?.issues ?? [], JSON.stringify(r)).toEqual([]);
            returned = [...returned, ...asReturned(r)];
            left -= qty;
          }
          if (left > 0) {
            const r = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: left }], returned));
            returned = [...returned, ...asReturned(r)];
          }
          const sum = (k: keyof ReturnedLine) => returned.reduce((acc, r) => acc + (r[k] as number), 0);
          expect(sum('qty')).toBe(sold.qty);
          expect(sum('totalMinor')).toBe(sold.priced.totalMinor);
          expect(sum('taxMinor')).toBe(sold.priced.taxMinor);
          expect(sum('grossExTaxMinor')).toBe(sold.priced.grossExTaxMinor);
          expect(sum('discountExTaxMinor')).toBe(sold.priced.discountExTaxMinor);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never gives back more than is left on a line', () => {
    const sale = aSale([line(1, 10_000, { qty: 3000 })]);
    const first = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 2000 }]));
    expect(() =>
      buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 2000 }], asReturned(first))),
    ).toThrow(/only 1000 left/);
    expect(returnableLines(sale, asReturned(first))).toEqual([
      { saleLineNo: 1, name: 'صنف 1', soldQty: 3000, returnedQty: 2000, remainingQty: 1000 },
    ]);
    expect(() => returnAmounts(sale.lines[0]!, 0)).toThrow();
    expect(() => buildReturnPayload(request(sale, []))).toThrow(/at least one line/);
    expect(() => buildReturnPayload(request(sale, [{ saleLineNo: 9, qty: 1000 }]))).toThrow(/no line 9/);
  });

  it('pays back by card what was paid by card, with its reference', () => {
    const sale = aSale([line(1, 50_000)], 'card');
    expect(defaultRefundMethod(sale)).toBe('card');
    const r = buildReturnPayload({ ...request(sale, [{ saleLineNo: 1, qty: 1000 }]), reference: 'R-77' });
    expect(r.refunds).toEqual([{ method: 'card', currency: 'SYP', amountMinor: 50_000, reference: 'R-77' }]);
    // Without the reference, the schema says so
    const bare = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }]));
    expect(returnPayloadSchema.safeParse(bare).success).toBe(false);
  });

  it('is refused when its totals or refunds do not add up', () => {
    const sale = aSale([line(1, 50_000)]);
    const r = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }]));
    expect(
      returnPayloadSchema.safeParse({ ...r, refunds: [{ ...r.refunds[0]!, amountMinor: 1 }] }).success,
    ).toBe(false);
    expect(
      returnPayloadSchema.safeParse({ ...r, totals: { ...r.totals, totalMinor: 1, grossExTaxMinor: 1 } })
        .success,
    ).toBe(false);
    expect(
      returnPayloadSchema.safeParse({ ...r, lines: [r.lines[0]!, { ...r.lines[0]!, lineNo: 2 }] }).success,
    ).toBe(false);
  });

  it('counts only what came back from the same line, and refuses a part of a thousandth', () => {
    const sale = aSale([line(1, 10_000, { qty: 2000 }), line(2, 4_000, { qty: 2000 })]);
    const earlier: ReturnedLine[] = [
      {
        saleLineNo: 2,
        qty: 1000,
        grossExTaxMinor: 2_000,
        discountExTaxMinor: 0,
        taxMinor: 0,
        totalMinor: 2_000,
      },
      {
        saleLineNo: 1,
        qty: 1000,
        grossExTaxMinor: 10_000,
        discountExTaxMinor: 0,
        taxMinor: 0,
        totalMinor: 10_000,
      },
    ];
    // Line 1 has 1000 left and takes what is left of its 20,000, whatever line 2 gave back
    expect(returnAmounts(sale.lines[0]!, 1000, earlier)).toEqual({
      grossExTaxMinor: 10_000,
      discountExTaxMinor: 0,
      taxMinor: 0,
      totalMinor: 10_000,
    });
    expect(returnAmounts(sale.lines[1]!, 1000)).toMatchObject({ totalMinor: 4_000 });
    expect(returnableLines(sale).map((l) => l.remainingQty)).toEqual([2000, 2000]);
    expect(() => returnAmounts(sale.lines[0]!, 1.5)).toThrow(/positive whole number/);
    expect(() => returnAmounts(sale.lines[0]!, 2001)).toThrow('only 2000 left to return on line 1');
  });

  it('skips lines picked at zero, and counts pieces of a pack into base units', () => {
    const sale = aSale([line(1, 12_000, { packQty: 12_000, name: 'كرتونة' }), line(2, 1_000)]);
    const r = buildReturnPayload(
      request(sale, [
        { saleLineNo: 2, qty: 0 },
        { saleLineNo: 1, qty: 1000 },
      ]),
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ lineNo: 1, saleLineNo: 1, qty: 1000, baseQty: 12_000 });
  });

  it('pays back the way it was paid, and cash for a mix', () => {
    const paidBy = (method: 'wallet' | 'transfer' | 'voucher') =>
      ({ ...aSale([line(1, 1_000)]), payments: [{ method }] }) as unknown as SalePayload;
    expect(defaultRefundMethod(paidBy('wallet'))).toBe('wallet');
    expect(defaultRefundMethod(paidBy('transfer'))).toBe('transfer');
    // What a voucher paid goes back on a voucher, never as cash
    expect(defaultRefundMethod(paidBy('voucher'))).toBe('voucher');
    expect(defaultRefundMethod(paidBy('points' as 'voucher'))).toBe('voucher');
    const mixed = {
      ...aSale([line(1, 1_000)]),
      payments: [{ method: 'card' }, { method: 'cash' }],
    } as unknown as SalePayload;
    expect(defaultRefundMethod(mixed)).toBe('cash');
    expect(defaultRefundMethod(aSale([line(1, 1_000)]))).toBe('cash');
    // A cheque stays as it is: the refund goes to the customer's account, or a voucher without one
    const byCheque = (customerId: string | null) =>
      ({
        ...aSale([line(1, 1_000)]),
        customerId,
        payments: [{ method: 'cheque' }],
      }) as unknown as SalePayload;
    expect(defaultRefundMethod(byCheque(CASHIER))).toBe('account');
    expect(defaultRefundMethod(byCheque(null))).toBe('voucher');
    // Cash carries no reference even when one is typed; a card without one keeps null
    const sale = aSale([line(1, 1_000)], 'card');
    const cash = buildReturnPayload({
      ...request(sale, [{ saleLineNo: 1, qty: 1000 }]),
      refundMethod: 'cash',
      reference: 'X',
    });
    expect(cash.refunds[0]!.reference).toBeNull();
    // A voucher refund carries none either: its code is the return's own number
    const voucher = buildReturnPayload({
      ...request(sale, [{ saleLineNo: 1, qty: 1000 }]),
      refundMethod: 'voucher',
      reference: 'X',
    });
    expect(voucher.refunds).toEqual([
      { method: 'voucher', currency: 'SYP', amountMinor: 1_000, reference: null },
    ]);
    expect(returnPayloadSchema.safeParse(voucher).success).toBe(true);
    expect(
      buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }])).refunds[0]!.reference,
    ).toBeNull();
  });

  it('gives goods that cost nothing back with nothing paid out', () => {
    const sale = aSale([line(1, 0), line(2, 1_000)]);
    const r = buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }]));
    expect(r.totals.totalMinor).toBe(0);
    expect(r.refunds).toEqual([]);
    expect(returnPayloadSchema.safeParse(r).success).toBe(true);
  });
});

describe('a return on account (08 › مرتجع مبيعات: تخفيض دين الزبون)', () => {
  const CUSTOMER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a77';
  const onCredit = (methods: ('cash' | 'credit')[], customerId: string | null = CUSTOMER) =>
    ({
      ...aSale([line(1, 1_000)]),
      customerId,
      payments: methods.map((method) => ({ method })),
    }) as unknown as SalePayload;

  it('is the default for a named customer’s sale that was on credit, wholly or in part', () => {
    expect(defaultRefundMethod(onCredit(['credit']))).toBe('account');
    expect(defaultRefundMethod(onCredit(['cash', 'credit']))).toBe('account');
    // No customer, or no credit in the sale: as before
    expect(defaultRefundMethod(onCredit(['credit'], null))).toBe('cash');
    expect(defaultRefundMethod(onCredit(['cash']))).toBe('cash');
  });

  it('names the customer, carries no reference and passes the contract', () => {
    const sale = aSale([line(1, 1_000)]);
    const withCustomer = { ...sale, customerId: CUSTOMER } as SalePayload;
    const r = buildReturnPayload({
      ...request(withCustomer, [{ saleLineNo: 1, qty: 1000 }]),
      refundMethod: 'account',
      reference: 'X',
    });
    expect(r.refunds).toEqual([{ method: 'account', currency: 'SYP', amountMinor: 1_000, reference: null }]);
    expect(r.customerId).toBe(CUSTOMER);
    expect(returnPayloadSchema.safeParse(r).success).toBe(true);
    // Other returns have no customerId at all, exactly as tills that predate it send them
    expect('customerId' in buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }]))).toBe(false);
  });

  it('cannot be built or accepted without a customer', () => {
    const sale = aSale([line(1, 1_000)]);
    expect(() =>
      buildReturnPayload({ ...request(sale, [{ saleLineNo: 1, qty: 1000 }]), refundMethod: 'account' }),
    ).toThrow(/named customer/);
    const forged = {
      ...buildReturnPayload(request(sale, [{ saleLineNo: 1, qty: 1000 }])),
      refunds: [{ method: 'account', currency: 'SYP', amountMinor: 1_000, reference: null }],
    };
    expect(returnPayloadSchema.safeParse(forged).success).toBe(false);
  });
});

// ─── Round 36 (decision 10): a refund from the dollar drawer ────────────────────────────────────

describe('a cash refund from the dollar drawer', () => {
  const USD_130 = { unit: 'USD', quote: 'SYP', rate: '130' } as const;
  // 1,170.00 ل.س sold; paid in dollars (9.00 $ at 130 = 1,170.00), or 585.00 ل.س + 4.50 $
  const aDollarSale = (payments: Record<string, unknown>[]): SalePayload =>
    buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [USD_130],
      shiftId: SHIFT,
      cashierId: CASHIER,
      cashSteps: {},
      lines: [line(1, 117_000)],
      payments,
    } as never);
  const allUsd = () => aDollarSale([{ method: 'cash', currency: 'USD', amountMinor: 900 }]);
  const half = () =>
    aDollarSale([
      { method: 'cash', currency: 'SYP', amountMinor: 58_500 },
      { method: 'cash', currency: 'USD', amountMinor: 450 },
    ]);
  const request = (sale: SalePayload, extra: Record<string, unknown> = {}) => ({
    sale,
    saleId: SALE_ID,
    saleNumber: 'INV-1',
    shiftId: SHIFT,
    cashierId: CASHIER,
    reason: 'تالف',
    picks: [{ saleLineNo: 1, qty: 1000 }],
    ...extra,
  });

  it('knows what the sale took in dollars, net of the change given back in them', () => {
    expect(paidForeign(allUsd())).toEqual([
      { currency: 'USD', amountMinor: 900, rate: USD_130, baseAmountMinor: 117_000 },
    ]);
    const withChange = aDollarSale([{ method: 'cash', currency: 'USD', amountMinor: 1000 }]);
    // 10 $ handed over, the change came back in pounds: the dollar drawer took the 10 $, but a refund never exceeds the goods
    expect(withChange.change?.currency).toBe('SYP');
    expect(paidForeign(withChange)[0]!.amountMinor).toBe(1000);
    expect(defaultForeignRefund(withChange, 117_000)).toEqual([{ currency: 'USD', amountMinor: 900 }]);
    expect(paidForeign(aSale([line(1, 5_000)]))).toEqual([]);
  });

  it('defaults to the same split as the payment, up to the dollars paid', () => {
    expect(defaultForeignRefund(allUsd(), 117_000)).toEqual([{ currency: 'USD', amountMinor: 900 }]);
    // half of the goods back: half of the dollars
    expect(defaultForeignRefund(allUsd(), 58_500)).toEqual([{ currency: 'USD', amountMinor: 450 }]);
    // a sale half in dollars gives half the refund to the dollar drawer
    expect(defaultForeignRefund(half(), 117_000)).toEqual([{ currency: 'USD', amountMinor: 450 }]);
    expect(defaultForeignRefund(half(), 58_500)).toEqual([{ currency: 'USD', amountMinor: 225 }]);
    expect(defaultForeignRefund(aSale([line(1, 5_000)]), 5_000)).toEqual([]);
  });

  it('pays the dollars from the dollar drawer, the rest from the pound drawer, and passes the contract', () => {
    const sale = half();
    const ret = buildReturnPayload(
      request(sale, { refundMethod: 'cash', foreignRefund: [{ currency: 'USD', amountMinor: 450 }] }),
    );
    expect(ret.refunds).toEqual([
      {
        method: 'cash',
        currency: 'SYP',
        amountMinor: 117_000,
        reference: null,
        foreign: [{ currency: 'USD', amountMinor: 450, baseAmountMinor: 58_500, rate: USD_130 }],
      },
    ]);
    expect(returnPayloadSchema.safeParse(ret).success).toBe(true);
  });

  it('rounds only what the pound drawer pays', () => {
    const sale = aDollarSale([
      { method: 'cash', currency: 'SYP', amountMinor: 58_900 },
      { method: 'cash', currency: 'USD', amountMinor: 450 },
    ]);
    // goods 1,174.00: 4.50 $ (585.00) from the dollar drawer, 589.00 left, rounded to 590.00 by the 10-pound step
    const ret = buildReturnPayload(
      request(sale, {
        refundMethod: 'cash',
        cashStepMinor: 1000,
        foreignRefund: [{ currency: 'USD', amountMinor: 450 }],
      }),
    );
    expect(ret.totals.totalMinor).toBe(sale.totals.totalMinor);
    const refund = ret.refunds[0]!;
    expect(refund.amountMinor - (refund.foreign?.[0]?.baseAmountMinor ?? 0)).toBe(
      Math.round((sale.totals.totalMinor - 58_500) / 1000) * 1000,
    );
    expect(refund.amountMinor - (refund.roundingMinor ?? 0)).toBe(ret.totals.totalMinor);
    expect(returnPayloadSchema.safeParse(ret).success).toBe(true);
  });

  it('refuses dollars the sale never took, or more than it took', () => {
    expect(() =>
      buildReturnPayload(
        request(aSale([line(1, 5_000)]), {
          refundMethod: 'cash',
          foreignRefund: [{ currency: 'USD', amountMinor: 10 }],
        }),
      ),
    ).toThrow(/not paid in USD/);
    expect(() =>
      buildReturnPayload(
        request(half(), { refundMethod: 'cash', foreignRefund: [{ currency: 'USD', amountMinor: 451 }] }),
      ),
    ).toThrow(/more than/);
  });

  it('adds the dollars of every payment, takes the dollar change off, and skips a drawer left with nothing', () => {
    const twice = aDollarSale([
      { method: 'cash', currency: 'USD', amountMinor: 400 },
      { method: 'cash', currency: 'USD', amountMinor: 500 },
    ]);
    expect(paidForeign(twice)[0]!.amountMinor).toBe(900);
    const dollarChange = {
      ...allUsd(),
      change: { currency: 'USD' as const, amountMinor: 100, rate: USD_130, baseAmountMinor: 13_000 },
    };
    expect(paidForeign(dollarChange)[0]!.amountMinor).toBe(800);
    const nothingLeft = {
      ...allUsd(),
      change: { currency: 'USD' as const, amountMinor: 900, rate: USD_130, baseAmountMinor: 117_000 },
    };
    expect(paidForeign(nothingLeft)).toEqual([]);
  });

  it('rounds the default down to whole cents and gives nothing for a refund too small to be a cent', () => {
    // 380.00 ل.س paid with a 3.00 $ note … 292.31 $ would be 38,000.30: the drawer never pays more than the goods
    const sale = aDollarSale([{ method: 'cash', currency: 'USD', amountMinor: 30_000 }]);
    const exact = sale.totals.totalMinor;
    const [one] = defaultForeignRefund(sale, exact);
    expect(one!.currency).toBe('USD');
    expect(one!.amountMinor * 130).toBeLessThanOrEqual(exact);
    expect(defaultForeignRefund(sale, 0)).toEqual([]);
    expect(defaultForeignRefund(sale, 1)).toEqual([]);
  });

  it('skips a foreign amount of zero and refuses dollars worth more than the goods', () => {
    const none = buildReturnPayload(
      request(allUsd(), { refundMethod: 'cash', foreignRefund: [{ currency: 'USD', amountMinor: 0 }] }),
    );
    expect(none.refunds[0]!.foreign).toBeUndefined();
    const tender = aDollarSale([{ method: 'cash', currency: 'USD', amountMinor: 1000 }]);
    expect(() =>
      buildReturnPayload(
        request(tender, { refundMethod: 'cash', foreignRefund: [{ currency: 'USD', amountMinor: 1000 }] }),
      ),
    ).toThrow(/more than the goods/);
  });

  it('leaves a refund with no foreign part exactly as before', () => {
    const sale = allUsd();
    const plain = buildReturnPayload(request(sale, { refundMethod: 'cash' }));
    expect(plain.refunds[0]).toEqual({
      method: 'cash',
      currency: 'SYP',
      amountMinor: 117_000,
      reference: null,
    });
    const empty = buildReturnPayload(request(sale, { refundMethod: 'cash', foreignRefund: [] }));
    expect(empty).toEqual(plain);
    // a refund by card never leaves a dollar drawer
    const card = buildReturnPayload(
      request(sale, {
        refundMethod: 'card',
        reference: 'C-1',
        foreignRefund: [{ currency: 'USD', amountMinor: 900 }],
      }),
    );
    expect(card.refunds[0]!.foreign).toBeUndefined();
  });

  it('is refused by the contract when the drawers pay more than the refund or a foreign drawer repeats', () => {
    const ret = buildReturnPayload(
      request(half(), { refundMethod: 'cash', foreignRefund: [{ currency: 'USD', amountMinor: 450 }] }),
    );
    const refund = ret.refunds[0]!;
    const over = {
      ...ret,
      refunds: [{ ...refund, foreign: [{ ...refund.foreign![0]!, baseAmountMinor: 120_000 }] }],
    };
    expect(returnPayloadSchema.safeParse(over).success).toBe(false);
    const twice = { ...ret, refunds: [{ ...refund, foreign: [refund.foreign![0]!, refund.foreign![0]!] }] };
    expect(returnPayloadSchema.safeParse(twice).success).toBe(false);
    const sameCurrency = {
      ...ret,
      refunds: [{ ...refund, foreign: [{ ...refund.foreign![0]!, currency: 'SYP' }] }],
    };
    expect(returnPayloadSchema.safeParse(sameCurrency).success).toBe(false);
  });
});

describe('the default dollar part of a refund is whole pounds when the store rounds its cash (round 39)', () => {
  const USD_120 = { unit: 'USD', quote: 'SYP', rate: '120' } as const;
  // 638 ل.س sold, paid 2.00 $ (240) and 398 ل.س, the trial's sale
  const sale = (): SalePayload =>
    buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [USD_120],
      shiftId: SHIFT,
      cashierId: CASHIER,
      cashSteps: {},
      lines: [line(1, 63_800)],
      payments: [
        { method: 'cash', currency: 'SYP', amountMinor: 39_800 },
        { method: 'cash', currency: 'USD', amountMinor: 200 },
      ],
    } as never);

  it('gives 0.75 $ (90 ل.س) instead of 0.76 $ (91.20 ل.س) so no fraction of a pound is paid or shown', () => {
    const s = sale();
    expect(defaultForeignRefund(s, 24_300)).toEqual([{ currency: 'USD', amountMinor: 76 }]);
    expect(defaultForeignRefund(s, 24_300, 100)).toEqual([{ currency: 'USD', amountMinor: 75 }]);
    const ret = buildReturnPayload({
      sale: s,
      saleId: SALE_ID,
      saleNumber: 'INV-1',
      shiftId: SHIFT,
      cashierId: CASHIER,
      reason: 'x',
      picks: [{ saleLineNo: 1, qty: 1000 }],
      refundMethod: 'cash',
      cashStepMinor: 500,
      foreignRefund: defaultForeignRefund(s, 24_300, 100),
    });
    // every amount in pounds is whole: the refund and the dollars' worth
    const r = ret.refunds[0]!;
    expect(r.amountMinor % 100).toBe(0);
    expect(r.foreign![0]!.baseAmountMinor % 100).toBe(0);
    expect(returnPayloadSchema.safeParse(ret).success).toBe(true);
  });

  it('keeps a sale paid only in dollars exactly as before', () => {
    const usdOnly = buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [USD_120],
      shiftId: SHIFT,
      cashierId: CASHIER,
      cashSteps: {},
      lines: [line(1, 63_800)],
      payments: [{ method: 'cash', currency: 'USD', amountMinor: 532 }],
    } as never);
    expect(defaultForeignRefund(usdOnly, 24_300, 100)).toEqual(defaultForeignRefund(usdOnly, 24_300));
  });
});
