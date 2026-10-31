import type { CurrencyCode, CurrencyId } from './currencies';
import type {
  DocumentDiscount,
  PaymentMethod,
  SaleCashRounding,
  SaleChange,
  SaleLine,
  SalePayload,
  SalePayment,
} from './contracts/documents';
import type { TradeRate } from './contracts/common';
import { convert, roundDiv, sumMinor } from './money';
import { priceInvoice, roundCashDue, type PricedInvoice } from './pricing';

/**
 * Builds the `sale` document payload from the cart (17 › الإرسال; 10 › حساب الفاتورة). The cashier
 * screen and the server both use these functions, so the totals printed on the receipt, the
 * payment panel's «الباقي» and the server's recomputation (totals_mismatch) are the same numbers:
 * priceInvoice() for the lines, roundCashDue() for the cash part, convert() for every currency.
 *
 * Settlement, in the invoice currency (the store's base currency):
 *   due = total + tip
 *   non-cash payments (card, wallet, transfer, credit) settle exact amounts and never give change;
 *   cash tendered in any currency other than the settlement currency S is applied in full;
 *   what is left is converted to S, rounded to S's cash step, and paid in S notes; the change, if
 *   any, comes back in S. S is the change currency the cashier picked (the base currency by default).
 * The rounding (and any residue of converting between currencies) is whatever makes the sale
 * balance exactly:  Σ payments − change = total + tip + rounding  (posted to 6400).
 */

export type SaleDiscount = DocumentDiscount;

export interface SaleCartLine {
  lineNo: number;
  productId: string;
  variantId: string;
  /** Product name with the variant's label, as printed */
  name: string;
  unitName?: string | null;
  barcode?: string | null;
  /** Base units in one pack, thousandths; 1000 (one piece or one kg) by default */
  packQty?: number;
  /** Packs, thousandths */
  qty: number;
  /** The catalog price of one pack, in its own currency */
  priceCurrency: CurrencyCode;
  priceMinor: number;
  taxRateId?: string | null;
  taxRateBp: number;
  discount?: SaleDiscount | null;
}

export interface SalePricingInput {
  /** Invoice currency: the store's base currency */
  currency: CurrencyCode;
  taxInclusive: boolean;
  /** Rates in force, each pairing a foreign currency with the invoice currency */
  exchangeRates: readonly TradeRate[];
  lines: readonly SaleCartLine[];
  invoiceDiscount?: SaleDiscount | null;
}

export interface SaleTender {
  method: PaymentMethod;
  currency: CurrencyCode;
  /** For cash, what the customer handed over in this currency */
  amountMinor: number;
  /** The rate this payment is taken at; the sale's rate for its currency by default */
  rate?: TradeRate | null;
  reference?: string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
  providerAccountId?: string | null;
}

export interface SettlementInput {
  currency: CurrencyCode;
  exchangeRates: readonly TradeRate[];
  /** priceInvoice(...).totals.totalMinor */
  totalMinor: number;
  tipMinor?: number;
  payments: readonly SaleTender[];
  /** Currency the change is given in, and the cash due rounded in; the invoice currency by default */
  changeCurrency?: CurrencyCode;
  /** settings.cashRoundingSteps: the cash step per currency in minor units (0 or missing = none) */
  cashSteps: Partial<Record<CurrencyId, number>>;
}

export interface SaleSettlement {
  /** total + tip */
  dueMinor: number;
  /** Payments cover what is due: the sale can close */
  covered: boolean;
  /** Still to pay in the invoice currency, exact (for a card or a credit part); 0 when covered */
  remainingMinor: number;
  /** The settlement currency S */
  settlementCurrency: CurrencyCode;
  /** Still to pay in cash in S, rounded to its step: what the payment panel shows; 0 when covered */
  remainingCashMinor: number;
  payments: SalePayment[];
  change: SaleChange | null;
  cashRounding: SaleCashRounding | null;
}

export interface SaleCart
  extends SalePricingInput, Omit<SettlementInput, 'totalMinor' | 'currency' | 'exchangeRates'> {
  /** The shift_open document's id */
  shiftId: string;
  cashierId: string;
  salespersonId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  note?: string | null;
}

/** The rate pairing `currency` with the invoice currency, or undefined for the invoice currency itself. */
export function rateFor(
  rates: readonly TradeRate[],
  currency: CurrencyCode,
  invoiceCurrency: CurrencyCode,
): TradeRate | undefined {
  if (currency === invoiceCurrency) return undefined;
  const rate = rates.find(
    (r) =>
      (r.unit === currency && r.quote === invoiceCurrency) ||
      (r.unit === invoiceCurrency && r.quote === currency),
  );
  if (!rate) throw new RangeError(`no ${currency}/${invoiceCurrency} exchange rate`);
  return rate;
}

const plainRate = (rate: TradeRate | undefined): TradeRate | null =>
  rate ? { unit: rate.unit, quote: rate.quote, rate: rate.rate } : null;

/** Base units moved by a line: roundDiv(qty × packQty, 1000). */
export function lineBaseQty(qty: number, packQty: number): number {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError(`qty must be a positive safe integer, got ${qty}`);
  if (!Number.isSafeInteger(packQty) || packQty <= 0) {
    throw new RangeError(`packQty must be a positive safe integer, got ${packQty}`);
  }
  return sumMinor([Number(roundDiv(BigInt(qty) * BigInt(packQty), 1000n))]);
}

/**
 * Prices the cart's lines: converts foreign-priced lines into the invoice currency, then runs
 * priceInvoice(). This is what the cart screen shows while the cashier scans.
 */
export function priceSale(input: SalePricingInput): { lines: SaleLine[]; priced: PricedInvoice } {
  const converted = input.lines.map((line) => {
    const rate = rateFor(input.exchangeRates, line.priceCurrency, input.currency);
    return { line, unitPriceMinor: convert(line.priceMinor, line.priceCurrency, input.currency, rate) };
  });
  const priced = priceInvoice({
    lines: converted.map(({ line, unitPriceMinor }) => ({
      lineNo: line.lineNo,
      unitPriceMinor,
      qty: line.qty,
      taxRateBp: line.taxRateBp,
      ...(line.discount ? { discount: line.discount } : {}),
    })),
    ...(input.invoiceDiscount ? { invoiceDiscount: input.invoiceDiscount } : {}),
    taxInclusive: input.taxInclusive,
  });
  const lines = converted.map(({ line, unitPriceMinor }, i): SaleLine => {
    const { lineNo: _lineNo, ...result } = priced.lines[i]!;
    const packQty = line.packQty ?? 1000;
    return {
      lineNo: line.lineNo,
      productId: line.productId,
      variantId: line.variantId,
      name: line.name,
      unitName: line.unitName ?? null,
      barcode: line.barcode ?? null,
      packQty,
      qty: line.qty,
      baseQty: lineBaseQty(line.qty, packQty),
      priceCurrency: line.priceCurrency,
      priceMinor: line.priceMinor,
      unitPriceMinor,
      taxRateId: line.taxRateId ?? null,
      taxRateBp: line.taxRateBp,
      discount: line.discount ?? null,
      priced: result,
    };
  });
  return { lines, priced };
}

function assertAmount(value: number, name: string, positive: boolean): void {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(
      `${name} must be a ${positive ? 'positive' : 'non-negative'} safe integer, got ${value}`,
    );
  }
}

/**
 * Applies the payments to what is due (see the file comment). Throws RangeError for what can never
 * be valid (a missing rate, non-cash payments over the amount due, two rates for the settlement
 * currency); a payment that is simply not enough yet answers `covered: false` with what remains.
 */
export function settleSale(input: SettlementInput): SaleSettlement {
  const base = input.currency;
  const tip = input.tipMinor ?? 0;
  assertAmount(input.totalMinor, 'totalMinor', false);
  assertAmount(tip, 'tipMinor', false);
  const due = sumMinor([input.totalMinor, tip]);
  const settlement = input.changeCurrency ?? base;

  const sTenders = input.payments.filter((p) => p.method === 'cash' && p.currency === settlement);
  const tenderRate = (p: SaleTender) =>
    p.currency === base ? undefined : (p.rate ?? rateFor(input.exchangeRates, p.currency, base));
  // One rate values the settlement currency: its tenders', or the sale's.
  const sRate = sTenders[0] ? tenderRate(sTenders[0]) : rateFor(input.exchangeRates, settlement, base);
  for (const p of sTenders) {
    const rate = tenderRate(p);
    if (rate?.rate !== sRate?.rate || rate?.unit !== sRate?.unit) {
      throw new RangeError(`cash in ${settlement} must all be taken at one rate`);
    }
  }

  const payments = input.payments.map((p, i): SalePayment => {
    assertAmount(p.amountMinor, `payments[${i}].amountMinor`, true);
    const rate = tenderRate(p);
    return {
      paymentNo: i + 1,
      method: p.method,
      currency: p.currency,
      amountMinor: p.amountMinor,
      rate: plainRate(rate),
      baseAmountMinor: convert(p.amountMinor, p.currency, base, rate),
      reference: p.reference ?? null,
      cardLast4: p.cardLast4 ?? null,
      cardBrand: p.cardBrand ?? null,
      providerAccountId: p.providerAccountId ?? null,
    };
  });

  const isS = (p: SalePayment) => p.method === 'cash' && p.currency === settlement;
  const nonCash = sumMinor(payments.filter((p) => p.method !== 'cash').map((p) => p.baseAmountMinor));
  if (nonCash > due) throw new RangeError(`non-cash payments (${nonCash}) exceed the amount due (${due})`);
  const otherCash = sumMinor(
    payments.filter((p) => p.method === 'cash' && !isS(p)).map((p) => p.baseAmountMinor),
  );
  const hasCash = payments.some((p) => p.method === 'cash');

  // Left for cash in S, exact, in the invoice currency; negative when other cash already overpays.
  const remainder = due - nonCash - otherCash;
  const exactS = convert(remainder, base, settlement, sRate);
  const step = input.cashSteps[settlement] ?? 0;
  const { dueMinor: dueS } = roundCashDue(exactS, step);
  const tenderedS = sumMinor(payments.filter(isS).map((p) => p.amountMinor));
  const changeS = tenderedS - dueS;

  const paidBase = sumMinor(payments.map((p) => p.baseAmountMinor));
  const remainingMinor = Math.max(0, due - paidBase);
  const remainingCashMinor = Math.max(0, -changeS);
  const covered = hasCash ? changeS >= 0 : remainder === 0;
  if (!covered) {
    return {
      dueMinor: due,
      covered,
      remainingMinor,
      settlementCurrency: settlement,
      remainingCashMinor,
      payments,
      change: null,
      cashRounding: null,
    };
  }
  if (!hasCash) {
    return {
      dueMinor: due,
      covered,
      remainingMinor: 0,
      settlementCurrency: settlement,
      remainingCashMinor: 0,
      payments,
      change: null,
      cashRounding: null,
    };
  }

  const changeBase = convert(changeS, settlement, base, sRate);
  const change: SaleChange | null =
    changeS > 0
      ? { currency: settlement, amountMinor: changeS, rate: plainRate(sRate), baseAmountMinor: changeBase }
      : null;
  return {
    dueMinor: due,
    covered,
    remainingMinor: 0,
    settlementCurrency: settlement,
    remainingCashMinor: 0,
    payments,
    change,
    cashRounding: {
      currency: settlement,
      stepMinor: step,
      exactMinor: exactS,
      dueMinor: dueS,
      roundingMinor: dueS - exactS,
      // By subtraction: the sale balances to the qirsh whatever the conversions rounded.
      roundingBaseMinor: paidBase - (change ? changeBase : 0) - due,
    },
  };
}

/**
 * The full `sale` payload from the cart, ready for the outbox (with PRICING_ENGINE_VERSION as the
 * document's engineVersion). Throws RangeError when the payments do not cover the sale yet, or
 * when the cart is invalid (see priceInvoice and settleSale).
 */
export function buildSalePayload(cart: SaleCart): SalePayload {
  const { lines, priced } = priceSale(cart);
  const settlement = settleSale({
    currency: cart.currency,
    exchangeRates: cart.exchangeRates,
    totalMinor: priced.totals.totalMinor,
    tipMinor: cart.tipMinor ?? 0,
    payments: cart.payments,
    ...(cart.changeCurrency ? { changeCurrency: cart.changeCurrency } : {}),
    cashSteps: cart.cashSteps,
  });
  if (!settlement.covered) {
    throw new RangeError(
      `the payments do not cover the sale: ${settlement.remainingCashMinor} ${settlement.settlementCurrency} still due`,
    );
  }
  const customerId = cart.customerId ?? null;
  if (customerId === null && cart.payments.some((p) => p.method === 'credit')) {
    throw new RangeError('a credit payment needs a customer');
  }
  return {
    shiftId: cart.shiftId,
    cashierId: cart.cashierId,
    salespersonId: cart.salespersonId ?? null,
    customerId,
    customerName: cart.customerName ?? null,
    currency: cart.currency,
    taxInclusive: cart.taxInclusive,
    exchangeRates: cart.exchangeRates.map((r) => ({ unit: r.unit, quote: r.quote, rate: r.rate })),
    lines,
    invoiceDiscount: cart.invoiceDiscount ?? null,
    totals: priced.totals,
    tipMinor: cart.tipMinor ?? 0,
    payments: settlement.payments,
    change: settlement.change,
    cashRounding: settlement.cashRounding,
    note: cart.note ?? null,
  };
}

/** A difference between what the device sent and what the engine computes from the same inputs. */
export interface SaleMismatch {
  path: string;
  device: unknown;
  engine: unknown;
}

/** Deep equality of JSON values, whatever the order of object keys. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

function compare(path: string, device: unknown, engine: unknown, out: SaleMismatch[]): void {
  if (!sameValue(device, engine)) out.push({ path, device, engine });
}

/**
 * Recomputes a schema-valid sale payload with this engine: line conversions, base quantities,
 * the priced lines and totals, the payments' base amounts, the change and the cash rounding (with
 * the step the device used). An empty list means the device and the server agree; anything else
 * is accepted and flagged totals_mismatch (15 › اقبل ونبّه للمال). An input the engine refuses (a
 * discount over its line…) is reported at `lines`.
 */
export function verifySalePayload(sale: SalePayload): SaleMismatch[] {
  const out: SaleMismatch[] = [];
  let lines: SaleLine[];
  let priced: PricedInvoice;
  try {
    ({ lines, priced } = priceSale({
      currency: sale.currency,
      taxInclusive: sale.taxInclusive,
      exchangeRates: sale.exchangeRates,
      lines: sale.lines,
      invoiceDiscount: sale.invoiceDiscount,
    }));
  } catch (error) {
    return [{ path: 'lines', device: 'priced', engine: (error as Error).message }];
  }
  sale.lines.forEach((line, i) => {
    const engine = lines[i]!;
    compare(`lines.${i}.unitPriceMinor`, line.unitPriceMinor, engine.unitPriceMinor, out);
    compare(`lines.${i}.baseQty`, line.baseQty, engine.baseQty, out);
    compare(`lines.${i}.priced`, line.priced, engine.priced, out);
  });
  compare('totals', sale.totals, priced.totals, out);

  const settlement = sale.cashRounding?.currency;
  try {
    const engine = settleSale({
      currency: sale.currency,
      exchangeRates: sale.exchangeRates,
      totalMinor: priced.totals.totalMinor,
      tipMinor: sale.tipMinor,
      payments: sale.payments,
      ...(settlement ? { changeCurrency: settlement } : {}),
      cashSteps: settlement ? { [settlement]: sale.cashRounding!.stepMinor } : {},
    });
    sale.payments.forEach((p, i) => {
      compare(`payments.${i}.baseAmountMinor`, p.baseAmountMinor, engine.payments[i]!.baseAmountMinor, out);
    });
    compare('change', sale.change, engine.change, out);
    compare('cashRounding', sale.cashRounding, engine.cashRounding, out);
    if (!engine.covered) out.push({ path: 'payments', device: 'covered', engine: engine.remainingMinor });
  } catch (error) {
    out.push({ path: 'payments', device: 'settled', engine: (error as Error).message });
  }
  return out;
}

/**
 * The business day of an instant (15 › ساعة الجهاز: تاريخ يوم العمل يحسبه الجهاز… والخادم يتحقق منه):
 * the store's local date, where a day ends at `cutoff` («نهاية يوم العمل», "HH:MM", e.g. "04:00"
 * keeps a café's 1 a.m. sales on the evening before). Pass the corrected device time.
 */
export function businessDateOf(instant: number | Date, timeZone: string, cutoff = '00:00'): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoff);
  if (!match) throw new RangeError(`cutoff must be HH:MM, got ${JSON.stringify(cutoff)}`);
  const ms =
    (typeof instant === 'number' ? instant : instant.getTime()) -
    (Number(match[1]) * 60 + Number(match[2])) * 60_000;
  if (!Number.isFinite(ms)) throw new RangeError('invalid instant');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
