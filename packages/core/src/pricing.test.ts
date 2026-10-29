import { describe, expect, it } from 'vitest';
import { applyBasisPoints, lineGross } from './money';
import {
  computeChange,
  priceInvoice,
  type Discount,
  type PricingInput,
  type PricingLineInput,
} from './pricing';
import { seededRandom } from './test-random';

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
      { unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 }, // milk
      { unitPriceMinor: 75, qty: 3000, taxRateBp: 1500 }, // bread
      { unitPriceMinor: 890, qty: 1000, taxRateBp: 1500, discount: { type: 'amount', minor: 40 } }, // rice
    ],
  };
  const invoice = priceInvoice(input);
  const [milk, bread, rice] = invoice.lines;

  it('prices milk', () => {
    expect(milk).toEqual({
      grossMinor: 250,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 19,
      netMinor: 231,
      taxMinor: 35,
      netExTaxMinor: 231,
      totalMinor: 266,
    });
  });

  it('prices bread', () => {
    expect(bread).toEqual({
      grossMinor: 225,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 17,
      netMinor: 208,
      taxMinor: 31,
      netExTaxMinor: 208,
      totalMinor: 239,
    });
  });

  it('prices rice', () => {
    expect(rice).toEqual({
      grossMinor: 890,
      lineDiscountMinor: 40,
      invoiceDiscountShareMinor: 64,
      netMinor: 786,
      taxMinor: 118,
      netExTaxMinor: 786,
      totalMinor: 904,
    });
  });

  it('totals the lines', () => {
    expect(invoice.totals).toEqual({
      grossMinor: 1365,
      lineDiscountMinor: 40,
      invoiceDiscountMinor: 100,
      discountMinor: 140,
      netMinor: 1225,
      netExTaxMinor: 1225,
      taxMinor: 184,
      totalMinor: 1409,
      roundingMinor: 0,
      payableMinor: 1409,
    });
  });

  it('gives change from 20.00', () => {
    expect(computeChange(invoice.totals.payableMinor, 2000)).toBe(591);
  });

  it('applies cash rounding to 0.05 on top', () => {
    const rounded = priceInvoice({ ...input, cashRoundingMinor: 5 });
    expect(rounded.lines).toEqual(invoice.lines);
    expect(rounded.totals.totalMinor).toBe(1409);
    expect(rounded.totals.payableMinor).toBe(1410);
    expect(rounded.totals.roundingMinor).toBe(1);
    expect(computeChange(rounded.totals.payableMinor, 2000)).toBe(590);
  });
});

describe('priceInvoice — tax-inclusive prices', () => {
  it('extracts tax from the price', () => {
    const invoice = priceInvoice({
      taxInclusive: true,
      lines: [
        { unitPriceMinor: 11500, qty: 1000, taxRateBp: 1500 },
        { unitPriceMinor: 1050, qty: 2000, taxRateBp: 0 },
        { unitPriceMinor: 5250, qty: 1000, taxRateBp: 500 },
      ],
    });
    expect(invoice.lines[0]).toEqual({
      grossMinor: 11500,
      lineDiscountMinor: 0,
      invoiceDiscountShareMinor: 0,
      netMinor: 11500,
      taxMinor: 1500,
      netExTaxMinor: 10000,
      totalMinor: 11500,
    });
    expect(invoice.lines[1]).toMatchObject({
      netMinor: 2100,
      taxMinor: 0,
      netExTaxMinor: 2100,
      totalMinor: 2100,
    });
    expect(invoice.lines[2]).toMatchObject({
      netMinor: 5250,
      taxMinor: 250,
      netExTaxMinor: 5000,
      totalMinor: 5250,
    });
    expect(invoice.totals).toMatchObject({
      grossMinor: 18850,
      netMinor: 18850,
      taxMinor: 1750,
      netExTaxMinor: 17100,
      totalMinor: 18850,
      payableMinor: 18850,
    });
  });

  it('extracts tax after discounts, rounding half away from zero', () => {
    // 100.00 − 10% = 90.00 inclusive of 15% → tax = 9000 × 1500 / 11500 = 1173.9 → 1174
    const invoice = priceInvoice({
      taxInclusive: true,
      invoiceDiscount: { type: 'percent', bp: 1000 },
      lines: [{ unitPriceMinor: 10000, qty: 1000, taxRateBp: 1500 }],
    });
    expect(invoice.lines[0]).toMatchObject({
      netMinor: 9000,
      taxMinor: 1174,
      netExTaxMinor: 7826,
      totalMinor: 9000,
    });
  });
});

describe('priceInvoice — percent discounts', () => {
  it('applies percent line and invoice discounts', () => {
    const invoice = priceInvoice({
      taxInclusive: false,
      invoiceDiscount: { type: 'percent', bp: 500 }, // 5% of 18.99 = 0.9495 → 0.95
      lines: [
        { unitPriceMinor: 1000, qty: 1000, taxRateBp: 1500, discount: { type: 'percent', bp: 1000 } },
        { unitPriceMinor: 333, qty: 3000, taxRateBp: 1500 },
      ],
    });
    expect(invoice.lines).toEqual([
      {
        grossMinor: 1000,
        lineDiscountMinor: 100,
        invoiceDiscountShareMinor: 45, // 45.02
        netMinor: 855,
        taxMinor: 128, // 128.25
        netExTaxMinor: 855,
        totalMinor: 983,
      },
      {
        grossMinor: 999,
        lineDiscountMinor: 0,
        invoiceDiscountShareMinor: 50, // 49.98
        netMinor: 949,
        taxMinor: 142, // 142.35
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
      netExTaxMinor: 1804,
      taxMinor: 270,
      totalMinor: 2074,
      roundingMinor: 0,
      payableMinor: 2074,
    });
  });

  it('allows 0% and 100% discounts', () => {
    const free = priceInvoice({
      taxInclusive: false,
      lines: [{ unitPriceMinor: 500, qty: 1000, taxRateBp: 1500, discount: { type: 'percent', bp: 10000 } }],
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
        { unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 },
        { unitPriceMinor: 75, qty: 3000, taxRateBp: 1500 },
        { unitPriceMinor: 890, qty: 1000, taxRateBp: 1500, discount: { type: 'amount', minor: 40 } },
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
      lines: [{ unitPriceMinor: 1200, qty: 250, taxRateBp: 0 }],
    });
    expect(invoice.lines[0]).toMatchObject({ grossMinor: 300, netMinor: 300, totalMinor: 300 });
  });

  it('rounds fractional cents of weighed lines per line', () => {
    // 0.333 kg × 9.99 = 3.32667 → 3.33; 1.005 kg × 0.10 = 0.1005 → 0.10
    const invoice = priceInvoice({
      taxInclusive: false,
      lines: [
        { unitPriceMinor: 999, qty: 333, taxRateBp: 0 },
        { unitPriceMinor: 10, qty: 1005, taxRateBp: 0 },
      ],
    });
    expect(invoice.lines.map((l) => l.grossMinor)).toEqual([333, 10]);
    expect(invoice.totals.grossMinor).toBe(343);
  });
});

describe('priceInvoice — cash rounding', () => {
  const syp = (totalMinor: number, cashRoundingMinor: number) =>
    priceInvoice({
      taxInclusive: true,
      cashRoundingMinor,
      lines: [{ unitPriceMinor: totalMinor, qty: 1000, taxRateBp: 0 }],
    }).totals;

  it('rounds to 0.05', () => {
    expect(syp(1407, 5)).toMatchObject({ totalMinor: 1407, payableMinor: 1405, roundingMinor: -2 });
    expect(syp(1408, 5)).toMatchObject({ totalMinor: 1408, payableMinor: 1410, roundingMinor: 2 });
    expect(syp(1410, 5)).toMatchObject({ totalMinor: 1410, payableMinor: 1410, roundingMinor: 0 });
  });

  it('rounds to 50.00, half away from zero', () => {
    expect(syp(1_234_567, 5000)).toMatchObject({ payableMinor: 1_235_000, roundingMinor: 433 });
    expect(syp(1_232_499, 5000)).toMatchObject({ payableMinor: 1_230_000, roundingMinor: -2499 });
    expect(syp(1_232_500, 5000)).toMatchObject({ payableMinor: 1_235_000, roundingMinor: 2500 });
  });

  it('treats 0 or undefined as no rounding', () => {
    expect(syp(1407, 0)).toMatchObject({ payableMinor: 1407, roundingMinor: 0 });
  });
});

describe('priceInvoice — validation', () => {
  const line: PricingLineInput = { unitPriceMinor: 100, qty: 1000, taxRateBp: 1500 };
  const price = (overrides: Partial<PricingInput>) =>
    priceInvoice({ taxInclusive: false, lines: [line], ...overrides });

  it('requires at least one line', () => {
    expect(() => price({ lines: [] })).toThrow(RangeError);
    expect(() => price({ lines: undefined as unknown as PricingLineInput[] })).toThrow(RangeError);
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
    expect(() => price({ lines: [line, { ...line, qty: 1.5 }] })).toThrow(/lines\[1\]\.qty/);
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
      { unitPriceMinor: 125, qty: 2000, taxRateBp: 1500 },
      { unitPriceMinor: 890, qty: 1000, taxRateBp: 1500, discount: { type: 'amount', minor: 40 } },
    ];
    expect(() => price({ lines, invoiceDiscount: { type: 'amount', minor: 1101 } })).toThrow(RangeError);
    expect(price({ lines, invoiceDiscount: { type: 'amount', minor: 1100 } }).totals.netMinor).toBe(0);
    expect(() => price({ invoiceDiscount: { type: 'percent', bp: 10001 } })).toThrow(RangeError);
    expect(() =>
      price({ lines: [{ ...line, unitPriceMinor: 0 }], invoiceDiscount: { type: 'amount', minor: 1 } }),
    ).toThrow(RangeError);
  });

  it('rejects an invalid cash rounding step', () => {
    expect(() => price({ cashRoundingMinor: -5 })).toThrow(RangeError);
    expect(() => price({ cashRoundingMinor: 0.5 })).toThrow(RangeError);
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

describe('priceInvoice — invariants (seeded property test)', () => {
  it('always sums lines exactly and allocates the whole invoice discount', () => {
    const rand = seededRandom(1503);
    const steps = [0, 5, 10, 25, 100, 5000];
    for (let run = 0; run < 1000; run++) {
      const taxInclusive = rand.next() < 0.5;
      const lines: PricingLineInput[] = Array.from({ length: rand.int(1, 8) }, () => {
        const unitPriceMinor = rand.int(0, rand.next() < 0.5 ? 2_000 : 50_000_000);
        const qty = rand.next() < 0.5 ? rand.int(1, 20) * 1000 : rand.int(0, 5_000);
        const taxRateBp = [0, 500, 1000, 1500][rand.int(0, 3)] ?? 0;
        const gross = lineGross(unitPriceMinor, qty);
        const roll = rand.next();
        const discount: Discount | undefined =
          roll < 0.33
            ? { type: 'amount', minor: rand.int(0, gross) }
            : roll < 0.66
              ? { type: 'percent', bp: rand.int(0, 10_000) }
              : undefined;
        return { unitPriceMinor, qty, taxRateBp, discount };
      });
      const netBefore = lines.map((l) => {
        const gross = lineGross(l.unitPriceMinor, l.qty);
        const d = l.discount;
        return gross - (!d ? 0 : d.type === 'amount' ? d.minor : applyBasisPoints(gross, d.bp));
      });
      const netBeforeSum = netBefore.reduce((a, b) => a + b, 0);
      const invoiceDiscount: Discount =
        rand.next() < 0.5
          ? { type: 'amount', minor: rand.int(0, netBeforeSum) }
          : { type: 'percent', bp: rand.int(0, 10_000) };
      const expectedInvoiceDiscount =
        invoiceDiscount.type === 'amount'
          ? invoiceDiscount.minor
          : applyBasisPoints(netBeforeSum, invoiceDiscount.bp);
      const cashRoundingMinor = steps[rand.int(0, steps.length - 1)] ?? 0;

      const { lines: priced, totals } = priceInvoice({
        lines,
        invoiceDiscount,
        taxInclusive,
        cashRoundingMinor,
      });

      const sum = (pick: (l: (typeof priced)[number]) => number) => priced.reduce((a, l) => a + pick(l), 0);
      priced.forEach((l, i) => {
        expect(l.grossMinor - l.lineDiscountMinor).toBe(netBefore[i]);
        expect(l.invoiceDiscountShareMinor).toBeGreaterThanOrEqual(0);
        expect(l.netMinor).toBe(l.grossMinor - l.lineDiscountMinor - l.invoiceDiscountShareMinor);
        expect(l.netMinor).toBeGreaterThanOrEqual(0);
        expect(l.taxMinor).toBeGreaterThanOrEqual(0);
        if (taxInclusive) {
          expect(l.totalMinor).toBe(l.netMinor);
          expect(l.netExTaxMinor + l.taxMinor).toBe(l.netMinor);
        } else {
          expect(l.netExTaxMinor).toBe(l.netMinor);
          expect(l.totalMinor).toBe(l.netMinor + l.taxMinor);
        }
      });
      expect(totals.invoiceDiscountMinor).toBe(expectedInvoiceDiscount);
      expect(sum((l) => l.invoiceDiscountShareMinor)).toBe(expectedInvoiceDiscount);
      expect(totals.grossMinor).toBe(sum((l) => l.grossMinor));
      expect(totals.lineDiscountMinor).toBe(sum((l) => l.lineDiscountMinor));
      expect(totals.discountMinor).toBe(totals.lineDiscountMinor + totals.invoiceDiscountMinor);
      expect(totals.netMinor).toBe(totals.grossMinor - totals.discountMinor);
      expect(totals.netExTaxMinor).toBe(sum((l) => l.netExTaxMinor));
      expect(totals.taxMinor).toBe(sum((l) => l.taxMinor));
      expect(totals.totalMinor).toBe(sum((l) => l.totalMinor));
      expect(totals.payableMinor - totals.totalMinor).toBe(totals.roundingMinor);
      if (cashRoundingMinor > 0) {
        expect(totals.payableMinor % cashRoundingMinor).toBe(0);
        expect(Math.abs(totals.roundingMinor) * 2).toBeLessThanOrEqual(cashRoundingMinor);
      } else {
        expect(totals.roundingMinor).toBe(0);
      }
    }
  });
});
