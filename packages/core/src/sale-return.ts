import type {
  Approval,
  Refund,
  RefundMethod,
  ReturnLine,
  ReturnPayload,
  SaleLine,
  SalePayload,
} from './contracts/documents';
import { QTY_SCALE, roundDiv } from './money';

/**
 * Returns (08 › مرتجع مبيعات، قواعد ثابتة 5): goods come back at the prices their sale charged,
 * never more than was sold, paid back in the sale's currency.
 *
 * A returned line takes its sale line's amounts in proportion to the quantity (half away from
 * zero). The last return of a line takes exactly what is left of it, so a sale returned in pieces
 * pays back, to the qirsh, what it took. Tips and cash rounding stay with the sale: they were not
 * the goods.
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

/** The method the money goes back by: the sale's own, when it was paid one way other than cash */
export function defaultRefundMethod(sale: SalePayload): RefundMethod {
  const methods = new Set(sale.payments.map((p) => p.method));
  if (methods.size === 1) {
    const [only] = [...methods];
    if (only === 'card' || only === 'wallet' || only === 'transfer' || only === 'voucher') return only;
  }
  return 'cash';
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
  const refund: Refund = {
    method,
    currency: sale.currency,
    amountMinor: totals.totalMinor,
    // A voucher's code is the return's own number, given when it is saved
    reference: method === 'cash' || method === 'voucher' ? null : (request.reference ?? null),
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
  };
}
