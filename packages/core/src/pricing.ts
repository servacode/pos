import { allocate, applyBasisPoints, lineGross, roundDiv, roundToStep, sumMinor } from './money';

export type Discount = { type: 'amount'; minor: number } | { type: 'percent'; bp: number };

export interface PricingLineInput {
  unitPriceMinor: number;
  /** Thousandths: 3 pieces = 3000, 0.250 kg = 250. */
  qty: number;
  taxRateBp: number;
  discount?: Discount;
}

export interface PricingInput {
  lines: PricingLineInput[];
  invoiceDiscount?: Discount;
  /** true: prices already include tax. false: tax is added on top. */
  taxInclusive: boolean;
  /** Cash rounding step in minor units (5 = round to 0.05). 0 or undefined = none. */
  cashRoundingMinor?: number;
}

export interface PricedLine {
  grossMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountShareMinor: number;
  /** After all discounts, as priced (includes tax when prices are tax-inclusive). */
  netMinor: number;
  taxMinor: number;
  /** Revenue for accounting. */
  netExTaxMinor: number;
  /** What the customer pays for the line. */
  totalMinor: number;
}

export interface PricedInvoice {
  lines: PricedLine[];
  totals: {
    grossMinor: number;
    lineDiscountMinor: number;
    invoiceDiscountMinor: number;
    /** Line + invoice discounts. */
    discountMinor: number;
    netMinor: number;
    netExTaxMinor: number;
    taxMinor: number;
    totalMinor: number;
    /** payable − total (cash rounding adjustment, may be negative). */
    roundingMinor: number;
    payableMinor: number;
  };
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${String(value)}`);
  }
}

/** Resolves a discount against `base` (the amount it applies to) into minor units. */
function resolveDiscount(discount: Discount | undefined, base: number, name: string): number {
  if (discount === undefined) return 0;
  switch (discount.type) {
    case 'amount':
      assertNonNegativeInteger(discount.minor, `${name}.minor`);
      if (discount.minor > base) {
        throw new RangeError(`${name} (${discount.minor}) exceeds the amount it applies to (${base})`);
      }
      return discount.minor;
    case 'percent':
      if (!Number.isSafeInteger(discount.bp) || discount.bp < 0 || discount.bp > 10_000) {
        throw new RangeError(`${name}.bp must be an integer between 0 and 10000, got ${String(discount.bp)}`);
      }
      return applyBasisPoints(base, discount.bp);
    default:
      throw new RangeError(`${name} has an unknown discount type`);
  }
}

/**
 * Prices an invoice: line gross → line discount → invoice discount allocated by line net
 * (largest remainder) → per-line tax. Totals are always the sum of the rounded lines.
 */
export function priceInvoice(input: PricingInput): PricedInvoice {
  const { lines, invoiceDiscount, taxInclusive } = input;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError('an invoice needs at least one line');
  }
  const cashStep = input.cashRoundingMinor ?? 0;
  assertNonNegativeInteger(cashStep, 'cashRoundingMinor');

  const discounted = lines.map((line, i) => {
    const at = `lines[${i}]`;
    assertNonNegativeInteger(line.unitPriceMinor, `${at}.unitPriceMinor`);
    assertNonNegativeInteger(line.qty, `${at}.qty`);
    assertNonNegativeInteger(line.taxRateBp, `${at}.taxRateBp`);
    const grossMinor = lineGross(line.unitPriceMinor, line.qty);
    const lineDiscountMinor = resolveDiscount(line.discount, grossMinor, `${at}.discount`);
    return {
      grossMinor,
      lineDiscountMinor,
      netBefore: grossMinor - lineDiscountMinor,
      taxRateBp: line.taxRateBp,
    };
  });

  const weights = discounted.map((line) => line.netBefore);
  const invoiceDiscountMinor = resolveDiscount(invoiceDiscount, sumMinor(weights), 'invoiceDiscount');
  const shares = allocate(invoiceDiscountMinor, weights);

  const priced = discounted.map((line, i): PricedLine => {
    const share = shares[i] ?? 0;
    const netMinor = line.netBefore - share;
    let taxMinor: number;
    let netExTaxMinor: number;
    let totalMinor: number;
    if (taxInclusive) {
      const rate = BigInt(line.taxRateBp);
      taxMinor = Number(roundDiv(BigInt(netMinor) * rate, 10_000n + rate)); // always <= netMinor
      netExTaxMinor = netMinor - taxMinor;
      totalMinor = netMinor;
    } else {
      taxMinor = applyBasisPoints(netMinor, line.taxRateBp);
      netExTaxMinor = netMinor;
      totalMinor = sumMinor([netMinor, taxMinor]);
    }
    return {
      grossMinor: line.grossMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      invoiceDiscountShareMinor: share,
      netMinor,
      taxMinor,
      netExTaxMinor,
      totalMinor,
    };
  });

  const sum = (pick: (line: PricedLine) => number) => sumMinor(priced.map(pick));
  const lineDiscountTotal = sum((l) => l.lineDiscountMinor);
  const invoiceDiscountTotal = sum((l) => l.invoiceDiscountShareMinor);
  const totalMinor = sum((l) => l.totalMinor);
  const payableMinor = cashStep > 0 ? roundToStep(totalMinor, cashStep) : totalMinor;

  return {
    lines: priced,
    totals: {
      grossMinor: sum((l) => l.grossMinor),
      lineDiscountMinor: lineDiscountTotal,
      invoiceDiscountMinor: invoiceDiscountTotal,
      discountMinor: sumMinor([lineDiscountTotal, invoiceDiscountTotal]),
      netMinor: sum((l) => l.netMinor),
      netExTaxMinor: sum((l) => l.netExTaxMinor),
      taxMinor: sum((l) => l.taxMinor),
      totalMinor,
      roundingMinor: payableMinor - totalMinor,
      payableMinor,
    },
  };
}

/** Change to hand back in cash. Throws RangeError when the tendered amount does not cover the payable. */
export function computeChange(payableMinor: number, tenderedMinor: number): number {
  assertNonNegativeInteger(payableMinor, 'payableMinor');
  assertNonNegativeInteger(tenderedMinor, 'tenderedMinor');
  if (tenderedMinor < payableMinor) {
    throw new RangeError(
      `tendered amount (${tenderedMinor}) is less than the payable amount (${payableMinor})`,
    );
  }
  return tenderedMinor - payableMinor;
}
