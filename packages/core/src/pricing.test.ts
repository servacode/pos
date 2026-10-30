import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENCIES } from './currencies';
import { applyBasisPoints, lineGross } from './money';
import {
  computeChange,
  priceInvoice,
  roundCashDue,
  type Discount,
  type PricedLine,
  type PricingInput,
  type PricingLineInput,
} from './pricing';

describe('priceInvoice — approved worked example', () => {
  // Prices exclusive of tax, tax 15%. Invoice discount = 1.00 (amount).
  // | line  | qty × price  | line discount | invoice-discount share | net   | tax 15% | total |
  // | milk  | 2 × 1.25     | 0.00          | 0.19                   | 2.31  | 0.35    | 2.66  |
  // | bread | 3 × 0.75     | 0.00          | 0.17                   | 2.08  | 0.31    | 2.39  |
  // | rice  | 1 × 8.90     | 0.40          | 0.64                   | 7.86  | 1.18    | 9.04  |
  // | total | gross 13.65  | 0.40          | 1.00                   | 12.25 | 1.84    | 14.09 |
  // Customer pays 20.00 → change 5.91.
  const input: PricingInput = {
    taxInclusive: false,
    invoiceDiscount: { type: 'amount', minor: 100 },
    lines: [
      { lineNo: 1, unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 }, // milk
      { lineNo: 2, unitPriceMinor: 75, qty: 3000, taxRateBp: 1500 }, // bread
      { lineNo: 3, unitPriceMinor: 890, qty: 1000, taxRateBp: 1500, discount: { type: 'amount', minor: 40 } }, // rice
    ],
  };
  const invoice = priceInvoice(input);
  const [milk, bread, rice] = invoice.lines;

  it('prices milk', () => {
    expect(milk).toEqual({
      lineNo: 1,
      grossMinor: 250,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 19,
      netMinor: 231,
      taxMinor: 35,
      grossExTaxMinor: 250,
      discountExTaxMinor: 19,
      netExTaxMinor: 231,
      totalMinor: 266,
    });
  });

  it('prices bread', () => {
    expect(bread).toEqual({
      lineNo: 2,
      grossMinor: 225,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 17,
      netMinor: 208,
      taxMinor: 31,
      grossExTaxMinor: 225,
      discountExTaxMinor: 17,
      netExTaxMinor: 208,
      totalMinor: 239,
    });
  });

  it('prices rice', () => {
    expect(rice).toEqual({
      lineNo: 3,
      grossMinor: 890,
      lineDiscountMinor: 40,
      invoiceDiscountShareMinor: 64,
      netMinor: 786,
      taxMinor: 118,
      grossExTaxMinor: 890,
      discountExTaxMinor: 104,
      netExTaxMinor: 786,
      totalMinor: 904,
    });
  });

  it('totals the lines exactly, without cash rounding', () => {
    expect(invoice.totals).toEqual({
      grossMinor: 1365,
      lineDiscountMinor: 40,
      invoiceDiscountMinor: 100,
      discountMinor: 140,
      netMinor: 1225,
      grossExTaxMinor: 1365,
      discountExTaxMinor: 140,
      netExTaxMinor: 1225,
      taxMinor: 184,
      totalMinor: 1409,
    });
  });

  it('gives change from 20.00', () => {
    expect(computeChange(invoice.totals.totalMinor, 2000)).toBe(591);
  });

  it('rounds only the cash payment to 0.05, leaving the invoice at 14.09', () => {
    const cash = roundCashDue(invoice.totals.totalMinor, 5);
    expect(cash).toEqual({ exactMinor: 1409, dueMinor: 1410, roundingMinor: 1 });
    expect(computeChange(cash.dueMinor, 2000)).toBe(590);
    expect(invoice.totals.totalMinor).toBe(1409);
  });
});

describe('priceInvoice — tax-inclusive prices', () => {
  it('extracts tax from the price', () => {
    const invoice = priceInvoice({
      taxInclusive: true,
      lines: [
        { lineNo: 1, unitPriceMinor: 11500, qty: 1000, taxRateBp: 1500 },
        { lineNo: 2, unitPriceMinor: 1050, qty: 2000, taxRateBp: 0 },
        { lineNo: 3, unitPriceMinor: 5250, qty: 1000, taxRateBp: 500 },
      ],
    });
    expect(invoice.lines[0]).toEqual({
      lineNo: 1,
      grossMinor: 11500,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 0,
      netMinor: 11500,
      taxMinor: 1500,
      grossExTaxMinor: 10000,
      discountExTaxMinor: 0,
      netExTaxMinor: 10000,
      totalMinor: 11500,
    });
    expect(invoice.lines[1]).toMatchObject({
      netMinor: 2100,
      taxMinor: 0,
      grossExTaxMinor: 2100,
      netExTaxMinor: 2100,
      totalMinor: 2100,
    });
    expect(invoice.lines[2]).toMatchObject({
      netMinor: 5250,
      taxMinor: 250,
      grossExTaxMinor: 5000,
      netExTaxMinor: 5000,
      totalMinor: 5250,
    });
    expect(invoice.totals).toMatchObject({
      grossMinor: 18850,
      netMinor: 18850,
      taxMinor: 1750,
      grossExTaxMinor: 17100,
      discountExTaxMinor: 0,
      netExTaxMinor: 17100,
      totalMinor: 18850,
    });
  });

  it('extracts tax after discounts, rounding half away from zero', () => {
    // 100.00 − 10% = 90.00 inclusive of 15% → tax = 9000 × 1500 / 11500 = 1173.9 → 1174
    // Gross before tax = 10000 − round(1304.3) = 8696, so the discount before tax = 8696 − 7826 = 870.
    const invoice = priceInvoice({
      taxInclusive: true,
      invoiceDiscount: { type: 'percent', bp: 1000 },
      lines: [{ lineNo: 1, unitPriceMinor: 10000, qty: 1000, taxRateBp: 1500 }],
    });
    expect(invoice.lines[0]).toMatchObject({
      netMinor: 9000,
      taxMinor: 1174,
      grossExTaxMinor: 8696,
      discountExTaxMinor: 870,
      netExTaxMinor: 7826,
      totalMinor: 9000,
    });
  });

  it('returns gross and discount before tax so the sale entry balances (spec 10, accountant E1)', () => {
    // 1,150 inclusive of 15% with a 150 inclusive discount: sales 1,000, discount 130, net 870, tax 130.
    const invoice = priceInvoice({
      taxInclusive: true,
      lines: [
        {
          lineNo: 1,
          unitPriceMinor: 1150,
          qty: 1000,
          taxRateBp: 1500,
          discount: { type: 'amount', minor: 150 },
        },
      ],
    });
    expect(invoice.lines[0]).toEqual({
      lineNo: 1,
      grossMinor: 1150,
      lineDiscountMinor: 150,
      invoiceDiscountShareMinor: 0,
      netMinor: 1000,
      taxMinor: 130,
      grossExTaxMinor: 1000,
      discountExTaxMinor: 130,
      netExTaxMinor: 870,
      totalMinor: 1000,
    });
    const { totals } = invoice;
    // Dr 1110 cash 1,000 + Dr 4200 discounts 130 = Cr 4100 sales 1,000 + Cr output tax 130.
    const debit = totals.totalMinor + totals.discountExTaxMinor;
    const credit = totals.grossExTaxMinor + totals.taxMinor;
    expect([debit, credit]).toEqual([1130, 1130]);
  });
});

describe('priceInvoice — percent discounts', () => {
  it('applies percent line and invoice discounts', () => {
    const invoice = priceInvoice({
      taxInclusive: false,
      invoiceDiscount: { type: 'percent', bp: 500 }, // 5% of 18.99 = 0.9495 → 0.95
      lines: [
        {
          lineNo: 1,
          unitPriceMinor: 1000,
          qty: 1000,
          taxRateBp: 1500,
          discount: { type: 'percent', bp: 1000 },
        },
        { lineNo: 2, unitPriceMinor: 333, qty: 3000, taxRateBp: 1500 },
      ],
    });
    expect(invoice.lines).toEqual([
      {
        lineNo: 1,
        grossMinor: 1000,
        lineDiscountMinor: 100,
        invoiceDiscountShareMinor: 45, // 45.02
        netMinor: 855,
        taxMinor: 128, // 128.25
        grossExTaxMinor: 1000,
        discountExTaxMinor: 145,
        netExTaxMinor: 855,
        totalMinor: 983,
      },
      {
        lineNo: 2,
        grossMinor: 999,
        lineDiscountMinor: 0,
        invoiceDiscountShareMinor: 50, // 49.98
        netMinor: 949,
        taxMinor: 142, // 142.35
        grossExTaxMinor: 999,
        discountExTaxMinor: 50,
        netExTaxMinor: 949,
        totalMinor: 1091,
      },
    ]);
    expect(invoice.totals).toEqual({
      grossMinor: 1999,
      lineDiscountMinor: 100,
      invoiceDiscountMinor: 95,
      discountMinor: 195,
      netMinor: 1804,
      grossExTaxMinor: 1999,
      discountExTaxMinor: 195,
      netExTaxMinor: 1804,
      taxMinor: 270,
      totalMinor: 2074,
    });
  });

  it('allows 0% and 100% discounts', () => {
    const free = priceInvoice({
      taxInclusive: false,
      lines: [
        {
          lineNo: 1,
          unitPriceMinor: 500,
          qty: 1000,
          taxRateBp: 1500,
          discount: { type: 'percent', bp: 10000 },
        },
      ],
      invoiceDiscount: { type: 'percent', bp: 0 },
    });
    expect(free.totals).toMatchObject({
      grossMinor: 500,
      discountMinor: 500,
      netMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
    });
  });

  it('allows an invoice discount equal to the whole net', () => {
    const invoice = priceInvoice({
      taxInclusive: false,
      invoiceDiscount: { type: 'amount', minor: 1325 },
      lines: [
        { lineNo: 1, unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 },
        { lineNo: 2, unitPriceMinor: 75, qty: 3000, taxRateBp: 1500 },
        {
          lineNo: 3,
          unitPriceMinor: 890,
          qty: 1000,
          taxRateBp: 1500,
          discount: { type: 'amount', minor: 40 },
        },
      ],
    });
    expect(invoice.lines.map((l) => l.invoiceDiscountShareMinor)).toEqual([250, 225, 850]);
    expect(invoice.totals.totalMinor).toBe(0);
  });
});

describe('priceInvoice — weighed quantities', () => {
  it('prices 0.250 kg × 12.00 as 3.00', () => {
    const invoice = priceInvoice({
      taxInclusive: false,
      lines: [{ lineNo: 1, unitPriceMinor: 1200, qty: 250, taxRateBp: 0 }],
    });
    expect(invoice.lines[0]).toMatchObject({ grossMinor: 300, netMinor: 300, totalMinor: 300 });
  });

  it('rounds fractional cents of weighed lines per line', () => {
    // 0.333 kg × 9.99 = 3.32667 → 3.33; 1.005 kg × 0.10 = 0.1005 → 0.10
    const invoice = priceInvoice({
      taxInclusive: false,
      lines: [
        { lineNo: 1, unitPriceMinor: 999, qty: 333, taxRateBp: 0 },
        { lineNo: 2, unitPriceMinor: 10, qty: 1005, taxRateBp: 0 },
      ],
    });
    expect(invoice.lines.map((l) => l.grossMinor)).toEqual([333, 10]);
    expect(invoice.totals.grossMinor).toBe(343);
  });
});

describe('priceInvoice — line order', () => {
  // QA review: a 0.01 invoice discount over two 0.10 lines, one taxed 15%, totalled 0.21 or 0.20 by order.
  const untaxed: PricingLineInput = { lineNo: 1, unitPriceMinor: 10, qty: 1000, taxRateBp: 0 };
  const taxed: PricingLineInput = { lineNo: 2, unitPriceMinor: 10, qty: 1000, taxRateBp: 1500 };
  const price = (lines: PricingLineInput[]) =>
    priceInvoice({ taxInclusive: false, invoiceDiscount: { type: 'amount', minor: 1 }, lines });

  it('gives the tied unit to the smaller line number in any order', () => {
    const forward = price([untaxed, taxed]);
    const backward = price([taxed, untaxed]);
    expect(forward.totals.totalMinor).toBe(21);
    expect(backward.totals).toEqual(forward.totals);
    expect(backward.lines).toEqual([forward.lines[1], forward.lines[0]]);
    expect(forward.lines.map((l) => l.invoiceDiscountShareMinor)).toEqual([1, 0]);
  });
});

describe('roundCashDue — cash rounding at payment (spec 10, step 6)', () => {
  it('rounds the cash part with the step of its currency (12,347.50 → 12,350, +2.50 to 6400)', () => {
    expect(roundCashDue(1_234_750, 1000)).toEqual({
      exactMinor: 1_234_750,
      dueMinor: 1_235_000,
      roundingMinor: 250,
    });
  });

  it('rounds only what is paid in cash after card or wallet payments', () => {
    // 12,347.50: 10,000.00 by Sham Cash (exact), the remaining 2,347.50 in cash → 2,350.00.
    const cash = roundCashDue(1_234_750 - 1_000_000, CURRENCIES.SYP.cashStepMinor);
    expect(cash).toEqual({ exactMinor: 234_750, dueMinor: 235_000, roundingMinor: 250 });
    expect(computeChange(cash.dueMinor, 250_000)).toBe(15_000);
  });

  it('uses a quarter-dollar step for dollars', () => {
    expect(roundCashDue(1409, CURRENCIES.USD.cashStepMinor)).toMatchObject({
      dueMinor: 1400,
      roundingMinor: -9,
    });
    expect(roundCashDue(1413, 25)).toMatchObject({ dueMinor: 1425, roundingMinor: 12 });
    expect(roundCashDue(1_232_500, 5000)).toMatchObject({ dueMinor: 1_235_000, roundingMinor: 2500 });
  });

  it('treats step 0 as no rounding and mirrors refunds', () => {
    expect(roundCashDue(1407, 0)).toEqual({ exactMinor: 1407, dueMinor: 1407, roundingMinor: 0 });
    expect(roundCashDue(-1_234_750, 1000)).toEqual({
      exactMinor: -1_234_750,
      dueMinor: -1_235_000,
      roundingMinor: -250,
    });
  });

  it('rejects an invalid step or amount', () => {
    expect(() => roundCashDue(100, -5)).toThrow(RangeError);
    expect(() => roundCashDue(100, 0.5)).toThrow(RangeError);
    expect(() => roundCashDue(100.5, 5)).toThrow(RangeError);
    expect(() => roundCashDue(Number.NaN, 0)).toThrow(RangeError);
  });

  it('keeps the rounding within half a step (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.constantFrom(0, 5, 10, 25, 100, 500, 1000, 5000),
        (exact, step) => {
          const { dueMinor, roundingMinor } = roundCashDue(exact, step);
          expect(dueMinor - exact).toBe(roundingMinor);
          if (step === 0) {
            expect(roundingMinor).toBe(0);
          } else {
            expect(Math.abs(dueMinor % step)).toBe(0);
            expect(Math.abs(roundingMinor) * 2).toBeLessThanOrEqual(step);
          }
          expect(roundCashDue(-exact, step).roundingMinor).toBe(-roundingMinor || 0);
        },
      ),
    );
  });
});

describe('priceInvoice — validation', () => {
  const line: PricingLineInput = { lineNo: 1, unitPriceMinor: 100, qty: 1000, taxRateBp: 1500 };
  const price = (overrides: Partial<PricingInput>) =>
    priceInvoice({ taxInclusive: false, lines: [line], ...overrides });

  it('requires at least one line', () => {
    expect(() => price({ lines: [] })).toThrow(RangeError);
    expect(() => price({ lines: undefined as unknown as PricingLineInput[] })).toThrow(RangeError);
  });

  it('requires a unique positive line number on every line', () => {
    expect(() => price({ lines: [line, { ...line }] })).toThrow(/lines\[1\]\.lineNo 1 is used twice/);
    expect(() => price({ lines: [{ ...line, lineNo: 0 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, lineNo: 1.5 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, lineNo: undefined as unknown as number }] })).toThrow(
      /lines\[0\]\.lineNo/,
    );
  });

  it('requires non-negative safe integers for price, quantity and tax', () => {
    expect(() => price({ lines: [{ ...line, unitPriceMinor: -1 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, unitPriceMinor: 1.25 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, qty: 0.5 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, qty: -1000 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, taxRateBp: Number.NaN }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, taxRateBp: -1500 }] })).toThrow(RangeError);
    expect(() => price({ lines: [{ ...line, unitPriceMinor: Number.MAX_SAFE_INTEGER, qty: 2000 }] })).toThrow(
      RangeError,
    );
  });

  it('names the offending line in the message', () => {
    expect(() => price({ lines: [line, { ...line, lineNo: 2, qty: 1.5 }] })).toThrow(/lines\[1\]\.qty/);
  });

  it('rejects out-of-range line discounts', () => {
    const withDiscount = (discount: Discount) => price({ lines: [{ ...line, discount }] });
    expect(() => withDiscount({ type: 'amount', minor: 101 })).toThrow(RangeError);
    expect(() => withDiscount({ type: 'amount', minor: -1 })).toThrow(RangeError);
    expect(() => withDiscount({ type: 'percent', bp: 10001 })).toThrow(RangeError);
    expect(() => withDiscount({ type: 'percent', bp: -1 })).toThrow(RangeError);
    expect(() => withDiscount({ type: 'percent', bp: 12.5 })).toThrow(RangeError);
    expect(() => withDiscount({ type: 'fixed' } as unknown as Discount)).toThrow(RangeError);
    expect(withDiscount({ type: 'amount', minor: 100 }).totals.netMinor).toBe(0);
  });

  it('rejects an invoice discount larger than the discounted lines', () => {
    const lines: PricingLineInput[] = [
      { lineNo: 1, unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 },
      { lineNo: 2, unitPriceMinor: 890, qty: 1000, taxRateBp: 1500, discount: { type: 'amount', minor: 40 } },
    ];
    expect(() => price({ lines, invoiceDiscount: { type: 'amount', minor: 1101 } })).toThrow(RangeError);
    expect(price({ lines, invoiceDiscount: { type: 'amount', minor: 1100 } }).totals.netMinor).toBe(0);
    expect(() => price({ invoiceDiscount: { type: 'percent', bp: 10001 } })).toThrow(RangeError);
    expect(() =>
      price({ lines: [{ ...line, unitPriceMinor: 0 }], invoiceDiscount: { type: 'amount', minor: 1 } }),
    ).toThrow(RangeError);
  });
});

describe('computeChange', () => {
  it('returns tendered − payable', () => {
    expect(computeChange(1409, 2000)).toBe(591);
    expect(computeChange(1409, 1409)).toBe(0);
  });

  it('throws when the customer has not paid enough', () => {
    expect(() => computeChange(1409, 1408)).toThrow(RangeError);
    expect(() => computeChange(-1, 0)).toThrow(RangeError);
    expect(() => computeChange(100, 150.5)).toThrow(RangeError);
  });
});

describe('priceInvoice — invariants (property tests)', () => {
  const netBefore = (line: PricingLineInput) => {
    const gross = lineGross(line.unitPriceMinor, line.qty);
    const d = line.discount;
    return gross - (!d ? 0 : d.type === 'amount' ? d.minor : applyBasisPoints(gross, d.bp));
  };

  const discountArb = (base: number): fc.Arbitrary<Discount> =>
    fc.oneof(
      fc.integer({ min: 0, max: base }).map((minor): Discount => ({ type: 'amount', minor })),
      fc.integer({ min: 0, max: 10_000 }).map((bp): Discount => ({ type: 'percent', bp })),
    );

  // Tiny prices make equal nets (and so allocation ties) common; large ones exercise the BigInt range.
  const lineArb = fc
    .record({
      unitPriceMinor: fc.oneof(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 2_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
      ),
      qty: fc.oneof(
        fc.integer({ min: 1, max: 20 }).map((pieces) => pieces * 1000),
        fc.integer({ min: 0, max: 5_000 }),
      ),
      taxRateBp: fc.constantFrom(0, 500, 1000, 1500),
    })
    .chain((line) =>
      fc
        .option(discountArb(lineGross(line.unitPriceMinor, line.qty)), { nil: undefined })
        .map((discount) => ({ ...line, discount })),
    );

  const invoiceArb: fc.Arbitrary<PricingInput> = fc
    .array(lineArb, { minLength: 1, maxLength: 8 })
    .chain((lines) =>
      fc
        .uniqueArray(fc.integer({ min: 1, max: 999 }), { minLength: lines.length, maxLength: lines.length })
        .map((lineNos): PricingLineInput[] =>
          lines.map((line, i) => ({ ...line, lineNo: lineNos[i] ?? i + 1 })),
        ),
    )
    .chain((lines) =>
      fc.record({
        lines: fc.constant(lines),
        taxInclusive: fc.boolean(),
        invoiceDiscount: discountArb(lines.map(netBefore).reduce((a, b) => a + b, 0)),
      }),
    );

  it('sums lines exactly, allocates the whole invoice discount and balances the journal', () => {
    fc.assert(
      fc.property(invoiceArb, (input) => {
        const { lines: priced, totals } = priceInvoice(input);
        const netBeforeSum = input.lines.map(netBefore).reduce((a, b) => a + b, 0);
        const discount = input.invoiceDiscount as Discount;
        const expectedInvoiceDiscount =
          discount.type === 'amount' ? discount.minor : applyBasisPoints(netBeforeSum, discount.bp);

        const sum = (pick: (l: PricedLine) => number) => priced.reduce((a, l) => a + pick(l), 0);
        priced.forEach((l, i) => {
          const line = input.lines[i] as PricingLineInput;
          expect(l.lineNo).toBe(line.lineNo);
          expect(l.grossMinor - l.lineDiscountMinor).toBe(netBefore(line));
          expect(l.invoiceDiscountShareMinor).toBeGreaterThanOrEqual(0);
          expect(l.netMinor).toBe(l.grossMinor - l.lineDiscountMinor - l.invoiceDiscountShareMinor);
          expect(l.netMinor).toBeGreaterThanOrEqual(0);
          expect(l.taxMinor).toBeGreaterThanOrEqual(0);
          expect(l.grossExTaxMinor - l.discountExTaxMinor).toBe(l.netExTaxMinor);
          expect(l.discountExTaxMinor).toBeGreaterThanOrEqual(0);
          expect(l.grossExTaxMinor).toBeLessThanOrEqual(l.grossMinor);
          if (input.taxInclusive) {
            expect(l.totalMinor).toBe(l.netMinor);
            expect(l.netExTaxMinor + l.taxMinor).toBe(l.netMinor);
          } else {
            expect(l.netExTaxMinor).toBe(l.netMinor);
            expect(l.grossExTaxMinor).toBe(l.grossMinor);
            expect(l.totalMinor).toBe(l.netMinor + l.taxMinor);
          }
        });
        expect(totals.invoiceDiscountMinor).toBe(expectedInvoiceDiscount);
        expect(sum((l) => l.invoiceDiscountShareMinor)).toBe(expectedInvoiceDiscount);
        expect(totals.grossMinor).toBe(sum((l) => l.grossMinor));
        expect(totals.lineDiscountMinor).toBe(sum((l) => l.lineDiscountMinor));
        expect(totals.discountMinor).toBe(totals.lineDiscountMinor + totals.invoiceDiscountMinor);
        expect(totals.netMinor).toBe(totals.grossMinor - totals.discountMinor);
        expect(totals.grossExTaxMinor).toBe(sum((l) => l.grossExTaxMinor));
        expect(totals.discountExTaxMinor).toBe(sum((l) => l.discountExTaxMinor));
        expect(totals.netExTaxMinor).toBe(sum((l) => l.netExTaxMinor));
        expect(totals.taxMinor).toBe(sum((l) => l.taxMinor));
        expect(totals.totalMinor).toBe(sum((l) => l.totalMinor));
        // Sale entry: Dr cash + Dr discounts (before tax) = Cr sales (before tax) + Cr tax.
        expect(totals.totalMinor + totals.discountExTaxMinor).toBe(totals.grossExTaxMinor + totals.taxMinor);
      }),
    );
  });

  it('prices every line the same whatever the order of the lines', () => {
    const orderingsArb = invoiceArb.chain((input) =>
      fc.tuple(fc.constant(input), fc.shuffledSubarray(input.lines, { minLength: input.lines.length })),
    );
    fc.assert(
      fc.property(orderingsArb, ([input, shuffled]) => {
        const original = priceInvoice(input);
        const reordered = priceInvoice({ ...input, lines: shuffled });
        const byLineNo = (lines: PricedLine[]) => new Map(lines.map((l) => [l.lineNo, l]));
        expect(reordered.totals).toEqual(original.totals);
        expect(byLineNo(reordered.lines)).toEqual(byLineNo(original.lines));
      }),
    );
  });
});
