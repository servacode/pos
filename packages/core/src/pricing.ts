import { allocate, applyBasisPoints, lineGross, roundDiv, roundToStep, sumMinor } from './money';

/**
 * Version of this engine's arithmetic, sent as `engineVersion` on every document (17 › حقول
 * إلزامية). The server recomputes a sale with the same version (15 › اقبل ونبّه للمال), so any change
 * to how priceInvoice or roundCashDue round a number must bump it and keep the old path available.
 */
export const PRICING_ENGINE_VERSION = '1.0.0';

export type Discount = { type: 'amount'; minor: number } | { type: 'percent'; bp: number };

export interface PricingLineInput {
  /**
   * The line's fixed number on the invoice (`line_no`), unique and > 0. Ties in the invoice-discount split
   * go to the smaller number, so the device and the server price the same lines identically in any order.
   */
  lineNo: number;
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
}

export interface PricedLine {
  lineNo: number;
  grossMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountShareMinor: number;
  /** After all discounts, as priced (includes tax when prices are tax-inclusive). */
  netMinor: number;
  taxMinor: number;
  /** Gross before tax: credited to sales (4100) before discounts. Equals grossMinor for tax-exclusive prices. */
  grossExTaxMinor: number;
  /** Line + invoice discounts before tax (4200), by subtraction: grossExTaxMinor − netExTaxMinor. */
  discountExTaxMinor: number;
  /** Revenue for accounting. */
  netExTaxMinor: number;
  /** What the customer owes for the line. */
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
    grossExTaxMinor: number;
    discountExTaxMinor: number;
    netExTaxMinor: number;
    taxMinor: number;
    /**
     * Exact invoice total, never cash-rounded (spec 10, step 5). Cash rounding happens at payment, on the
     * cash part only: see roundCashDue.
     */
    totalMinor: number;
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

/** Tax contained in a tax-inclusive amount: round(amount × r / (1 + r)), never more than the amount. */
function includedTax(amountMinor: number, taxRateBp: number): number {
  const rate = BigInt(taxRateBp);
  return Number(roundDiv(BigInt(amountMinor) * rate, 10_000n + rate));
}

/**
 * Prices an invoice: line gross → line discount → invoice discount allocated by line net (largest
 * remainder, ties by line number) → per-line tax. Totals are always the sum of the rounded lines, and
 * total + discountExTax = grossExTax + tax, so the sale's journal entry balances to the qirsh.
 */
export function priceInvoice(input: PricingInput): PricedInvoice {
  const { lines, invoiceDiscount, taxInclusive } = input;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError('an invoice needs at least one line');
  }

  const seenLineNos = new Set<number>();
  const discounted = lines.map((line, i) => {
    const at = `lines[${i}]`;
    if (!Number.isSafeInteger(line.lineNo) || line.lineNo <= 0) {
      throw new RangeError(`${at}.lineNo must be a positive safe integer, got ${String(line.lineNo)}`);
    }
    if (seenLineNos.has(line.lineNo)) throw new RangeError(`${at}.lineNo ${line.lineNo} is used twice`);
    seenLineNos.add(line.lineNo);
    assertNonNegativeInteger(line.unitPriceMinor, `${at}.unitPriceMinor`);
    assertNonNegativeInteger(line.qty, `${at}.qty`);
    assertNonNegativeInteger(line.taxRateBp, `${at}.taxRateBp`);
    const grossMinor = lineGross(line.unitPriceMinor, line.qty);
    const lineDiscountMinor = resolveDiscount(line.discount, grossMinor, `${at}.discount`);
    return {
      lineNo: line.lineNo,
      grossMinor,
      lineDiscountMinor,
      netBefore: grossMinor - lineDiscountMinor,
      taxRateBp: line.taxRateBp,
    };
  });

  const weights = discounted.map((line) => line.netBefore);
  const invoiceDiscountMinor = resolveDiscount(invoiceDiscount, sumMinor(weights), 'invoiceDiscount');
  const shares = allocate(
    invoiceDiscountMinor,
    weights,
    discounted.map((line) => line.lineNo),
  );

  const priced = discounted.map((line, i): PricedLine => {
    const share = shares[i] ?? 0;
    const netMinor = line.netBefore - share;
    let taxMinor: number;
    let grossExTaxMinor: number;
    let netExTaxMinor: number;
    let totalMinor: number;
    if (taxInclusive) {
      taxMinor = includedTax(netMinor, line.taxRateBp);
      netExTaxMinor = netMinor - taxMinor;
      grossExTaxMinor = line.grossMinor - includedTax(line.grossMinor, line.taxRateBp);
      totalMinor = netMinor;
    } else {
      taxMinor = applyBasisPoints(netMinor, line.taxRateBp);
      netExTaxMinor = netMinor;
      grossExTaxMinor = line.grossMinor;
      totalMinor = sumMinor([netMinor, taxMinor]);
    }
    return {
      lineNo: line.lineNo,
      grossMinor: line.grossMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      invoiceDiscountShareMinor: share,
      netMinor,
      taxMinor,
      grossExTaxMinor,
      // By subtraction, so sales − discounts = net revenue exactly (accountant E1).
      discountExTaxMinor: grossExTaxMinor - netExTaxMinor,
      netExTaxMinor,
      totalMinor,
    };
  });

  const sum = (pick: (line: PricedLine) => number) => sumMinor(priced.map(pick));
  const lineDiscountTotal = sum((l) => l.lineDiscountMinor);
  const invoiceDiscountTotal = sum((l) => l.invoiceDiscountShareMinor);

  return {
    lines: priced,
    totals: {
      grossMinor: sum((l) => l.grossMinor),
      lineDiscountMinor: lineDiscountTotal,
      invoiceDiscountMinor: invoiceDiscountTotal,
      discountMinor: sumMinor([lineDiscountTotal, invoiceDiscountTotal]),
      netMinor: sum((l) => l.netMinor),
      grossExTaxMinor: sum((l) => l.grossExTaxMinor),
      discountExTaxMinor: sum((l) => l.discountExTaxMinor),
      netExTaxMinor: sum((l) => l.netExTaxMinor),
      taxMinor: sum((l) => l.taxMinor),
      totalMinor: sum((l) => l.totalMinor),
    },
  };
}

export interface CashDue {
  /** The exact amount settled in cash: what is left of the invoice after card, wallet and credit parts. */
  exactMinor: number;
  /** What the cashier collects (or pays back on a refund): exactMinor rounded to the cash step. */
  dueMinor: number;
  /** dueMinor − exactMinor, posted to 6400 فروقات التقريب: positive is a credit (gain), negative a debit. */
  roundingMinor: number;
}

/**
 * Cash rounding at payment (spec 10, step 6): only the part paid in cash is rounded, half away from zero, to
 * the step of the cash currency (10 pounds = 1000, a quarter dollar = 25; 0 = none). The invoice itself is
 * never rounded, so credit, card and wallet payments settle the exact amount. Refunds (negative amounts)
 * mirror sales.
 */
export function roundCashDue(exactMinor: number, cashStepMinor: number): CashDue {
  if (!Number.isSafeInteger(exactMinor)) {
    throw new RangeError(`exactMinor must be a safe integer, got ${String(exactMinor)}`);
  }
  assertNonNegativeInteger(cashStepMinor, 'cashStepMinor');
  const dueMinor = cashStepMinor > 0 ? roundToStep(exactMinor, cashStepMinor) : exactMinor;
  return { exactMinor, dueMinor, roundingMinor: dueMinor - exactMinor };
}

/** Change to hand back in cash. Throws RangeError when the tendered amount does not cover the cash due. */
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
