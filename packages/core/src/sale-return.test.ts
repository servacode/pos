import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { returnPayloadSchema, validateDocumentPayload, type SalePayload } from './contracts/documents';
import { buildSalePayload, priceSale, type SaleCartLine } from './sale';
import {
  buildReturnPayload,
  defaultRefundMethod,
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
