import type {
  Approval,
  Refund,
  RefundMethod,
  ReturnLine,
  ReturnPayload,
  SaleLine,
  SalePayload,
} from './contracts/documents';
import type { TradeRate } from './contracts/common';
import type { CurrencyCode } from './currencies';
import { convert, QTY_SCALE, roundDiv } from './money';
import { roundCashDue } from './pricing';
import { INSTALMENT_FEE_VARIANT_ID } from './installments';

/**
 * Returns (08 › مرتجع مبيعات، قواعد ثابتة 5): goods come back at the prices their sale charged,
 * never more than was sold, paid back in the sale's currency.
 *
 * A returned line takes its sale line's amounts in proportion to the quantity (half away from
 * zero). The last return of a line takes exactly what is left of it, so a sale returned in pieces
 * pays back, to the qirsh, what it took. Tips and the sale's own cash rounding stay with the sale:
 * they were not the goods.
 *
 * Round 21: a refund paid in cash is rounded to the cash step like a cash sale (the exact amount
 * stays in `totals`, the drawer pays `refunds[0].amountMinor`, the difference is
 * `refunds[0].roundingMinor`, posted to 6400). An older till sends no rounding: its refund pays
 * exactly the total and posts as it always did.
 */

export interface ReturnAmounts {
  grossExTaxMinor: number;
  discountExTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** What earlier returns already took back from one sale line */
export interface ReturnedLine extends ReturnAmounts {
  saleLineNo: number;
  qty: number;
}

export interface ReturnableLine {
  saleLineNo: number;
  name: string;
  soldQty: number;
  returnedQty: number;
  remainingQty: number;
}

const ZERO: ReturnAmounts = { grossExTaxMinor: 0, discountExTaxMinor: 0, taxMinor: 0, totalMinor: 0 };

function returnedOf(returned: readonly ReturnedLine[], saleLineNo: number): ReturnedLine {
  return returned
    .filter((r) => r.saleLineNo === saleLineNo)
    .reduce<ReturnedLine>(
      (acc, r) => ({
        saleLineNo,
        qty: acc.qty + r.qty,
        grossExTaxMinor: acc.grossExTaxMinor + r.grossExTaxMinor,
        discountExTaxMinor: acc.discountExTaxMinor + r.discountExTaxMinor,
        taxMinor: acc.taxMinor + r.taxMinor,
        totalMinor: acc.totalMinor + r.totalMinor,
      }),
      { saleLineNo, qty: 0, ...ZERO },
    );
}

/** The lines of a sale with what is still returnable on each */
export function returnableLines(sale: SalePayload, returned: readonly ReturnedLine[] = []): ReturnableLine[] {
  return sale.lines.map((line) => {
    const done = returnedOf(returned, line.lineNo).qty;
    return {
      saleLineNo: line.lineNo,
      name: line.name,
      soldQty: line.qty,
      returnedQty: done,
      remainingQty: Math.max(0, line.qty - done),
    };
  });
}

const share = (amount: number, qty: number, of: number) =>
  Number(roundDiv(BigInt(amount) * BigInt(qty), BigInt(of)));

/** A line's amounts for `qty` packs, given what earlier returns took from it */
export function returnAmounts(
  line: SaleLine,
  qty: number,
  returned: readonly ReturnedLine[] = [],
): ReturnAmounts {
  if (!Number.isInteger(qty) || qty <= 0)
    throw new Error('return qty must be a positive whole number of thousandths');
  const before = returnedOf(returned, line.lineNo);
  const remaining = line.qty - before.qty;
  if (qty > remaining) throw new Error(`only ${remaining} left to return on line ${line.lineNo}`);
  const p = line.priced;
  // Where the line stands once `upTo` packs have come back: every amount in proportion, rounded
  // the same way each time, so each return is the step between two such points and the steps add
  // up to the line exactly.
  // At the whole line, share() gives the sale's own amounts.
  const at = (upTo: number) => {
    const totalMinor = share(p.totalMinor, upTo, line.qty);
    return {
      totalMinor,
      taxMinor: Math.min(totalMinor, share(p.taxMinor, upTo, line.qty)),
      discountExTaxMinor: share(p.discountExTaxMinor, upTo, line.qty),
    };
  };
  const target = at(before.qty + qty);
  const piece = {
    totalMinor: target.totalMinor - before.totalMinor,
    taxMinor: target.taxMinor - before.taxMinor,
    discountExTaxMinor: target.discountExTaxMinor - before.discountExTaxMinor,
  };
  // Rounding can leave a step a qirsh short on tax or discount; the next step makes it up
  piece.taxMinor = Math.max(0, Math.min(piece.taxMinor, piece.totalMinor));
  piece.discountExTaxMinor = Math.max(0, piece.discountExTaxMinor);
  return {
    grossExTaxMinor: piece.totalMinor - piece.taxMinor + piece.discountExTaxMinor,
    discountExTaxMinor: piece.discountExTaxMinor,
    taxMinor: piece.taxMinor,
    totalMinor: piece.totalMinor,
  };
}

/**
 * The method the money goes back by: the sale's own, when it was paid one way other than cash. A
 * sale of a named customer that was (partly) on account goes back to their account, so the debt
 * they still owe comes down (08 › مرتجع مبيعات). A sale paid by cheque does the same.
 */
export function defaultRefundMethod(sale: SalePayload): RefundMethod {
  if (sale.customerId && sale.payments.some((p) => p.method === 'credit')) return 'account';
  // A cheque stays as it is in the books: the refund never comes out of the drawer. It goes to the
  // customer's account, or on a voucher when the sale names nobody
  if (sale.payments.some((p) => p.method === 'cheque')) return sale.customerId ? 'account' : 'voucher';
  const methods = new Set(sale.payments.map((p) => p.method));
  if (methods.size === 1) {
    const [only] = [...methods];
    if (only === 'card' || only === 'wallet' || only === 'transfer' || only === 'voucher') return only;
    // What points paid goes back on a voucher, never as cash
    if (only === 'points') return 'voucher';
  }
  return 'cash';
}

/** What a sale took in one foreign cash drawer (the dollar's), after the change given back in it */
export interface PaidForeign {
  currency: CurrencyCode;
  /** In `currency`, net of the change */
  amountMinor: number;
  /** The rate the sale took that payment at */
  rate: TradeRate;
  /** `amountMinor` in the invoice currency at `rate` */
  baseAmountMinor: number;
}

/** The foreign cash the sale took, net of change: where a cash refund can go back to the same drawer */
export function paidForeign(sale: SalePayload): PaidForeign[] {
  const byCurrency = new Map<CurrencyCode, { amountMinor: number; rate: TradeRate }>();
  for (const p of sale.payments) {
    if (p.method !== 'cash' || p.currency === sale.currency || !p.rate) continue;
    const row = byCurrency.get(p.currency);
    if (row) row.amountMinor += p.amountMinor;
    else byCurrency.set(p.currency, { amountMinor: p.amountMinor, rate: p.rate });
  }
  const out: PaidForeign[] = [];
  for (const [currency, row] of byCurrency) {
    const net =
      row.amountMinor - (sale.change && sale.change.currency === currency ? sale.change.amountMinor : 0);
    if (net <= 0) continue;
    out.push({
      currency,
      amountMinor: net,
      rate: row.rate,
      baseAmountMinor: convert(net, currency, sale.currency, row.rate),
    });
  }
  return out;
}

/**
 * The default split of a cash refund (round 36, decision 10): the same share in each foreign drawer as the
 * sale took, never more than what it took there. `refundTotalMinor` is the refund in the invoice currency.
 */
export function defaultForeignRefund(
  sale: SalePayload,
  refundTotalMinor: number,
): { currency: CurrencyCode; amountMinor: number }[] {
  const saleTotal = sale.totals.totalMinor;
  if (saleTotal <= 0 || refundTotalMinor <= 0) return [];
  const out: { currency: CurrencyCode; amountMinor: number }[] = [];
  let left = refundTotalMinor;
  for (const paid of paidForeign(sale)) {
    const shareBase = Math.min(
      left,
      Number(roundDiv(BigInt(paid.baseAmountMinor) * BigInt(refundTotalMinor), BigInt(saleTotal))),
    );
    // Whole foreign minor units, rounded down so the drawer never pays more than the share
    let amount = Math.min(paid.amountMinor, convert(shareBase, sale.currency, paid.currency, paid.rate));
    while (convert(amount, paid.currency, sale.currency, paid.rate) > shareBase) amount -= 1;
    if (amount <= 0) continue;
    left -= convert(amount, paid.currency, sale.currency, paid.rate);
    out.push({ currency: paid.currency, amountMinor: amount });
  }
  return out;
}

export interface ReturnRequest {
  sale: SalePayload;
  saleId: string;
  saleNumber: string;
  /** The shift the cash comes out of (the current one, not the sale's) */
  shiftId: string;
  cashierId: string;
  reason: string;
  picks: readonly { saleLineNo: number; qty: number }[];
  /** What earlier returns of this sale took, as far as this device knows */
  returned?: readonly ReturnedLine[];
  refundMethod?: RefundMethod;
  /** The approval code of a card, wallet or transfer refund */
  reference?: string | null;
  approval?: Approval | null;
  /** The goods are damaged: they go to the damaged stock, not back on the shelf (round 35, D7) */
  damaged?: boolean;
  /**
   * settings.cashRoundingSteps for the sale's currency (0 or missing = none). A cash refund is
   * rounded to it like a cash sale: the drawer pays the rounded amount and the difference is the
   * rounding (6400). Other methods are never rounded.
   */
  cashStepMinor?: number;
  /**
   * Round 36 (decision 10): what of a cash refund leaves a foreign drawer (the dollar's), in that
   * currency. Only for a currency the sale was paid in cash, and never more than it took there.
   * Missing or empty: the whole refund leaves the invoice currency's drawer, as before.
   */
  foreignRefund?: readonly { currency: CurrencyCode; amountMinor: number }[];
}

export function buildReturnPayload(request: ReturnRequest): ReturnPayload {
  const { sale } = request;
  const picks = request.picks.filter((p) => p.qty > 0);
  if (picks.length === 0) throw new Error('choose at least one line to return');
  const lines: ReturnLine[] = picks.map((pick, i) => {
    const line = sale.lines.find((l) => l.lineNo === pick.saleLineNo);
    if (!line) throw new Error(`the sale has no line ${pick.saleLineNo}`);
    return {
      lineNo: i + 1,
      saleLineNo: line.lineNo,
      productId: line.productId,
      variantId: line.variantId,
      name: line.name,
      qty: pick.qty,
      baseQty: Number(roundDiv(BigInt(pick.qty) * BigInt(line.packQty), BigInt(QTY_SCALE))),
      taxRateId: line.taxRateId,
      refund: returnAmounts(line, pick.qty, request.returned ?? []),
    };
  });
  const totals = lines.reduce<ReturnAmounts>(
    (acc, l) => ({
      grossExTaxMinor: acc.grossExTaxMinor + l.refund.grossExTaxMinor,
      discountExTaxMinor: acc.discountExTaxMinor + l.refund.discountExTaxMinor,
      taxMinor: acc.taxMinor + l.refund.taxMinor,
      totalMinor: acc.totalMinor + l.refund.totalMinor,
    }),
    ZERO,
  );
  const method = request.refundMethod ?? defaultRefundMethod(sale);
  if (method === 'account' && !sale.customerId)
    throw new Error('only a sale of a named customer can be refunded to an account');
  // Round 36: the part of a cash refund that goes back to a foreign drawer, valued at the rate the sale took it at
  const foreign: NonNullable<Refund['foreign']> = [];
  if (method === 'cash') {
    const paid = paidForeign(sale);
    for (const want of request.foreignRefund ?? []) {
      if (want.amountMinor <= 0) continue;
      const source = paid.find((p) => p.currency === want.currency);
      if (!source) throw new Error(`the sale was not paid in ${want.currency} cash`);
      if (want.amountMinor > source.amountMinor)
        throw new Error(`more than the ${want.currency} the sale took`);
      const baseAmountMinor = convert(want.amountMinor, want.currency, sale.currency, source.rate);
      foreign.push({
        currency: want.currency,
        amountMinor: want.amountMinor,
        baseAmountMinor,
        rate: source.rate,
      });
    }
  }
  const foreignBase = foreign.reduce((n, f) => n + f.baseAmountMinor, 0);
  if (foreignBase > totals.totalMinor) throw new Error('the foreign refund is more than the goods came to');
  // A cash refund is rounded to the cash step (half away from zero, like a sale). A refund that
  // would round down to nothing stays exact: a refund of zero is no refund. With a foreign part,
  // only what the invoice currency's drawer pays is rounded.
  const rounded =
    method === 'cash' && (request.cashStepMinor ?? 0) > 0
      ? roundCashDue(totals.totalMinor - foreignBase, request.cashStepMinor!)
      : null;
  const cashRounding = rounded && rounded.dueMinor > 0 ? rounded.roundingMinor : 0;
  const refund: Refund = {
    method,
    currency: sale.currency,
    amountMinor: totals.totalMinor + cashRounding,
    ...(cashRounding !== 0 ? { roundingMinor: cashRounding } : {}),
    // A voucher's code is the return's own number, given when it is saved
    reference:
      method === 'cash' || method === 'voucher' || method === 'account' ? null : (request.reference ?? null),
    ...(foreign.length > 0 ? { foreign } : {}),
  };
  return {
    saleId: request.saleId,
    saleNumber: request.saleNumber,
    shiftId: request.shiftId,
    cashierId: request.cashierId,
    currency: sale.currency,
    reason: request.reason,
    lines,
    totals,
    // Goods that cost nothing on the sale come back with nothing paid out
    refunds: totals.totalMinor > 0 ? [refund] : [],
    approval: request.approval ?? null,
    // Only an account refund names the customer: every other return stays as it always was
    ...(method === 'account' && totals.totalMinor > 0 ? { customerId: sale.customerId } : {}),
    // Only a damaged return says so: every other return stays exactly as it was
    ...(request.damaged ? { damaged: true } : {}),
  };
}

/**
 * Round 37, decision 18: a return of an instalment sale takes the instalment fee back with it. The fee is
 * a line of the sale («رسم التقسيط»), so it goes back through the ordinary return and the ordinary credit
 * to the customer's account: the plan and the customer's balance both come down by the goods and their fee.
 *
 *   - the whole sale returned (every goods line back in full, counting earlier returns): the fee in full;
 *   - anything less: the fee in proportion to the value of the goods returned so far, never more than is left.
 *
 * `picks` are the goods lines the cashier chose; any pick of the fee line itself is replaced by what
 * this works out. A return that picks only the fee line, or a sale with no plan, is left as it is.
 */
export function withInstalmentFee(
  sale: SalePayload,
  picks: readonly { saleLineNo: number; qty: number }[],
  returned: readonly ReturnedLine[] = [],
): { saleLineNo: number; qty: number }[] {
  const fee = sale.installmentPlan
    ? sale.lines.find((l) => l.variantId === INSTALMENT_FEE_VARIANT_ID)
    : undefined;
  if (!fee) return [...picks];
  const goodsPicks = picks.filter((p) => p.saleLineNo !== fee.lineNo && p.qty > 0);
  if (goodsPicks.length === 0) return [...picks];
  const feeLeft = fee.qty - returnedOf(returned, fee.lineNo).qty;
  if (feeLeft <= 0) return goodsPicks;

  const goods = sale.lines.filter((l) => l.lineNo !== fee.lineNo);
  let whole = true;
  let valueSold = 0;
  let valueBack = 0;
  for (const line of goods) {
    const before = returnedOf(returned, line.lineNo);
    const pick = goodsPicks.find((p) => p.saleLineNo === line.lineNo)?.qty ?? 0;
    if (before.qty + pick < line.qty) whole = false;
    valueSold += line.priced.totalMinor;
    valueBack += before.totalMinor + (pick > 0 ? returnAmounts(line, pick, returned).totalMinor : 0);
  }
  const target = whole
    ? fee.qty
    : valueSold > 0
      ? Number(roundDiv(BigInt(fee.qty) * BigInt(valueBack), BigInt(valueSold)))
      : 0;
  const qty = Math.max(0, Math.min(feeLeft, target - returnedOf(returned, fee.lineNo).qty));
  return qty > 0 ? [...goodsPicks, { saleLineNo: fee.lineNo, qty }] : goodsPicks;
}
