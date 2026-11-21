import { describe, expect, it } from 'vitest';
import {
  returnPayloadSchema,
  saleLineSchema,
  validateDocumentPayload,
  type SalePayload,
} from './contracts/documents';
import { priceInvoice } from './pricing';
import { buildSalePayload, priceSale, verifySalePayload, type SaleCartLine } from './sale';
import { buildReturnPayload } from './sale-return';

/**
 * Round 21, owner decisions D1 (a cash refund is rounded to the cash step like a cash sale) and
 * D3 (the invoice-level discount skips service lines).
 */

const SHIFT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const CASHIER = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';
const SALE_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a09';

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

const percent = (bp: number) => ({ type: 'percent', bp, source: 'manual', reason: null, approval: null });

function aSale(lines: SaleCartLine[], invoiceBp?: number): SalePayload {
  const common = {
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [],
    lines,
    ...(invoiceBp ? { invoiceDiscount: percent(invoiceBp) } : {}),
  };
  const due = priceSale(common as never).priced.totals.totalMinor;
  return buildSalePayload({
    ...common,
    shiftId: SHIFT,
    cashierId: CASHIER,
    cashSteps: {},
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: due }],
  } as never);
}

const request = (
  sale: SalePayload,
  extra: { cashStepMinor?: number; refundMethod?: 'cash' | 'card' } = {},
) => ({
  sale,
  saleId: SALE_ID,
  saleNumber: 'INV-001-002-0000001',
  shiftId: SHIFT,
  cashierId: CASHIER,
  reason: 'الزبون غيّر رأيه',
  picks: [{ saleLineNo: 1, qty: 1000 }],
  ...extra,
});

describe('D1: a cash refund is rounded to the cash step', () => {
  const sale = () => aSale([line(1, 71_250)]); // 712.50

  it('pays 710 out and records the 2.50 rounding (golden)', () => {
    const r = buildReturnPayload(request(sale(), { cashStepMinor: 1000 }));
    expect(r.totals.totalMinor).toBe(71_250);
    expect(r.refunds).toEqual([
      { method: 'cash', currency: 'SYP', amountMinor: 71_000, reference: null, roundingMinor: -250 },
    ]);
    expect(validateDocumentPayload('return', r)).toEqual({ ok: true, checked: true });
  });

  it('rounds half away from zero like a sale', () => {
    const half = buildReturnPayload(request(aSale([line(1, 71_500)]), { cashStepMinor: 1000 }));
    expect(half.refunds[0]).toMatchObject({ amountMinor: 72_000, roundingMinor: 500 });
    expect(validateDocumentPayload('return', half)).toEqual({ ok: true, checked: true });
  });

  it('leaves non-cash refunds and a store without a step exactly as they were', () => {
    const card = buildReturnPayload(request(sale(), { cashStepMinor: 1000, refundMethod: 'card' }));
    expect(card.refunds[0]).toEqual({
      method: 'card',
      currency: 'SYP',
      amountMinor: 71_250,
      reference: null,
    });
    const none = buildReturnPayload(request(sale()));
    expect(none.refunds).toEqual([{ method: 'cash', currency: 'SYP', amountMinor: 71_250, reference: null }]);
    const zero = buildReturnPayload(request(sale(), { cashStepMinor: 0 }));
    expect(zero.refunds).toEqual(none.refunds);
  });

  it('never rounds a refund down to nothing', () => {
    const tiny = buildReturnPayload(request(aSale([line(1, 300)]), { cashStepMinor: 1000 }));
    expect(tiny.refunds).toEqual([{ method: 'cash', currency: 'SYP', amountMinor: 300, reference: null }]);
  });

  it('accepts what an older till sent (exact cash, no rounding) and refuses a lie', () => {
    const old = buildReturnPayload(request(sale()));
    expect(returnPayloadSchema.safeParse(old).success).toBe(true);
    // the server does not round again: a rounded refund passes as sent, exact ones too
    const rounded = buildReturnPayload(request(sale(), { cashStepMinor: 1000 }));
    expect(returnPayloadSchema.safeParse(JSON.parse(JSON.stringify(rounded))).success).toBe(true);
    // rounding that does not explain the difference to the total is refused
    const lie = { ...rounded, refunds: [{ ...rounded.refunds[0]!, roundingMinor: -100 }] };
    expect(returnPayloadSchema.safeParse(lie).success).toBe(false);
    // and only a cash refund can carry a rounding
    const card = buildReturnPayload(request(sale(), { refundMethod: 'card' }));
    const bad = {
      ...card,
      refunds: [{ ...card.refunds[0]!, reference: 'R1', amountMinor: 71_000, roundingMinor: -250 }],
    };
    expect(returnPayloadSchema.safeParse(bad).success).toBe(false);
  });
});

describe('D3: the invoice discount skips service lines', () => {
  const fee = (lineNo: number, priceMinor: number) => line(lineNo, priceMinor, { noInvoiceDiscount: true });

  it('10% off a jacket and an alteration fee takes the jacket only (golden)', () => {
    const priced = priceSale({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [],
      lines: [line(1, 100_000), fee(2, 20_000)],
      invoiceDiscount: percent(1000),
    } as never).priced;
    // 10% of the goods (100 000), not of 120 000
    expect(priced.totals.invoiceDiscountMinor).toBe(10_000);
    expect(priced.lines[0]!.invoiceDiscountShareMinor).toBe(10_000);
    expect(priced.lines[1]).toMatchObject({ invoiceDiscountShareMinor: 0, totalMinor: 20_000 });
    expect(priced.totals.totalMinor).toBe(110_000);
  });

  it('keeps a line discount the cashier set on the service line', () => {
    const priced = priceInvoice({
      taxInclusive: true,
      invoiceDiscount: { type: 'percent', bp: 1000 },
      lines: [
        { lineNo: 1, unitPriceMinor: 100_000, qty: 1000, taxRateBp: 0 },
        {
          lineNo: 2,
          unitPriceMinor: 20_000,
          qty: 1000,
          taxRateBp: 0,
          discount: { type: 'amount', minor: 5_000 },
          noInvoiceDiscount: true,
        },
      ],
    });
    expect(priced.lines[1]).toMatchObject({ lineDiscountMinor: 5_000, invoiceDiscountShareMinor: 0 });
    expect(priced.totals.invoiceDiscountMinor).toBe(10_000);
  });

  it('is the same as before when no line is a service, and amounts still split by net', () => {
    const lines = [
      { lineNo: 1, unitPriceMinor: 70_000, qty: 1000, taxRateBp: 0 },
      { lineNo: 2, unitPriceMinor: 30_000, qty: 1000, taxRateBp: 0 },
    ];
    const a = priceInvoice({ taxInclusive: true, invoiceDiscount: { type: 'amount', minor: 10_000 }, lines });
    expect(a.lines.map((l) => l.invoiceDiscountShareMinor)).toEqual([7_000, 3_000]);
  });

  it('a discount over the goods is refused though the fee would cover it', () => {
    expect(() =>
      priceInvoice({
        taxInclusive: true,
        invoiceDiscount: { type: 'amount', minor: 110_000 },
        lines: [
          { lineNo: 1, unitPriceMinor: 100_000, qty: 1000, taxRateBp: 0 },
          { lineNo: 2, unitPriceMinor: 20_000, qty: 1000, taxRateBp: 0, noInvoiceDiscount: true },
        ],
      }),
    ).toThrow(RangeError);
  });

  it('a sale of services alone takes no invoice discount', () => {
    const priced = priceInvoice({
      taxInclusive: true,
      invoiceDiscount: { type: 'percent', bp: 1000 },
      lines: [{ lineNo: 1, unitPriceMinor: 20_000, qty: 1000, taxRateBp: 0, noInvoiceDiscount: true }],
    });
    expect(priced.totals.invoiceDiscountMinor).toBe(0);
    expect(priced.totals.totalMinor).toBe(20_000);
  });

  it('the server recomputes both ways: the new flag, and an older till without it', () => {
    const lines = [line(1, 100_000), fee(2, 20_000)];
    const fresh = aSale(lines, 1000);
    expect(fresh.lines[1]!.noInvoiceDiscount).toBe(true);
    expect(fresh.lines[0]!.noInvoiceDiscount).toBeUndefined();
    expect(saleLineSchema.safeParse(fresh.lines[1]).success).toBe(true);
    expect(verifySalePayload(fresh)).toEqual([]);
    expect(validateDocumentPayload('sale', fresh)).toEqual({ ok: true, checked: true });

    // An older till priced the same cart the old way: the discount spread over every line
    const old = aSale([line(1, 100_000), line(2, 20_000)], 1000);
    expect(old.lines[1]!.noInvoiceDiscount).toBeUndefined();
    expect(old.lines[1]!.priced.invoiceDiscountShareMinor).toBe(2_000);
    expect(verifySalePayload(old)).toEqual([]);
    expect(validateDocumentPayload('sale', old)).toEqual({ ok: true, checked: true });
  });
});
