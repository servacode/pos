import { convert } from '@serva/core/money';
import type { CurrencyCode as Code } from '@serva/core/currencies';
import type { TradeRate } from '@serva/core/contracts/common';
import type {
  Approval,
  CashCount,
  CashMovementKind,
  CashMovementPayload,
  PaymentMethod,
  GiftVoucherPayload,
  ReceiptPayload,
  ReturnPayload,
  SalePayload,
  ShiftClosePayload,
  ShiftCloseCash,
  ShiftMode,
  ShiftOpenPayload,
} from '@serva/core/contracts/documents';
import { rateFor } from '@serva/core/sale';
import type { OutboxEntry } from '@serva/sync';
import type { SyncStore } from '@serva/sync/client';
import type { LocalStore } from '../../offline/local';

/**
 * The shift (11 › الوردية; 10 › مطابقة الصندوق): opened with a counted drawer per cash currency
 * (shift_open, SFT), closed with a blind count (shift_close). Pay-ins and pay-outs between them are
 * cash_movement documents. The open shift is kept in the device's local state, so a reload or a
 * power cut finds it again; the expected cash is summed from the documents the device itself saved.
 */

export interface OpenShift {
  /** Where it is kept in the device's local state */
  key: string;
  /** The shift_open document's id: sales and movements refer to it */
  id: string;
  number: string;
  openedBy: string;
  openedByName: string;
  openedAt: number;
  mode: ShiftMode;
  opening: CashCount[];
}

/** One drawer per cash currency per shift; the device's key, or the cashier's own. */
export const shiftKey = (mode: ShiftMode, userId: string) =>
  mode === 'per_cashier' ? `shift:${userId}` : 'shift:device';
export const LAST_CLOSED_KEY = 'shift:lastClosed';

export function readShift(local: LocalStore, mode: ShiftMode, userId: string): Promise<OpenShift | null> {
  return local.get<OpenShift>(shiftKey(mode, userId));
}

/** Banknotes offered by the counter (the boards' denominations), in minor units. */
export const DENOMINATIONS: Partial<Record<Code, number[]>> = {
  SYP: [500, 200, 100, 50, 25, 10].map((v) => v * 100),
  USD: [100, 50, 20, 10, 5, 1].map((v) => v * 100),
};

/** A count typed by note (counts per denomination) or as a total. */
export interface DrawerCount {
  currency: Code;
  /** Count per denomination value; null when the cashier typed the total instead */
  notes: Record<number, number> | null;
  totalMinor: number;
}

export function countTotal(count: DrawerCount): number {
  if (!count.notes) return count.totalMinor;
  return Object.entries(count.notes).reduce((sum, [value, n]) => sum + Number(value) * n, 0);
}

export function toCashCount(count: DrawerCount): CashCount {
  const denominations = count.notes
    ? Object.entries(count.notes)
        .filter(([, n]) => n > 0)
        .map(([value, n]) => ({ valueMinor: Number(value), count: n }))
        .sort((a, b) => b.valueMinor - a.valueMinor)
    : null;
  return { currency: count.currency, amountMinor: countTotal(count), denominations };
}

export function shiftOpenPayload(
  openedBy: string,
  mode: ShiftMode,
  handoverFromShiftId: string | null,
  counts: DrawerCount[],
): ShiftOpenPayload {
  // A handover needs the shift it takes over; without one on this device it opens on its own.
  const effective: ShiftMode = mode === 'handover' && !handoverFromShiftId ? 'per_cashier' : mode;
  return {
    openedBy,
    mode: effective,
    handoverFromShiftId: effective === 'handover' ? handoverFromShiftId : null,
    opening: counts.map(toCashCount),
  };
}

export function cashMovementPayload(input: {
  shiftId: string;
  kind: CashMovementKind;
  currency: Code;
  amountMinor: number;
  baseCurrency: Code;
  rates: readonly TradeRate[];
  reason: string;
  reference: string | null;
  performedBy: string;
  approval: Approval | null;
}): CashMovementPayload {
  const rate = rateFor(input.rates, input.currency, input.baseCurrency) ?? null;
  return {
    shiftId: input.shiftId,
    kind: input.kind,
    currency: input.currency,
    amountMinor: input.amountMinor,
    baseCurrency: input.baseCurrency,
    rate: rate ? { unit: rate.unit, quote: rate.quote, rate: rate.rate } : null,
    baseAmountMinor: convert(input.amountMinor, input.currency, input.baseCurrency, rate ?? undefined),
    reason: input.reason.trim(),
    expenseAccountCode: null,
    reference: input.reference?.trim() || null,
    performedBy: input.performedBy,
    approval: input.approval,
  };
}

/** Every document this device still holds (pending, confirmed for 30 days, held). */
export async function deviceDocuments(store: SyncStore): Promise<OutboxEntry[]> {
  const lists = await Promise.all([
    store.listByStatus('pending'),
    store.listByStatus('confirmed'),
    store.listByStatus('held'),
  ]);
  return lists.flat().sort((a, b) => a.seq - b.seq);
}

type Terms = Pick<
  ShiftCloseCash,
  | 'cashInMinor'
  | 'changeOutMinor'
  | 'refundsMinor'
  | 'receiptsMinor'
  | 'payInMinor'
  | 'payOutMinor'
  | 'dropsMinor'
>;

const NO_TERMS: Terms = {
  cashInMinor: 0,
  changeOutMinor: 0,
  refundsMinor: 0,
  receiptsMinor: 0,
  payInMinor: 0,
  payOutMinor: 0,
  dropsMinor: 0,
};

export interface ShiftActivity {
  saleCount: number;
  /** Per drawer currency, the terms of the formula the device knows */
  terms: Map<Code, Terms>;
  byMethod: ShiftClosePayload['summary']['byMethod'];
  /** Returns saved in this shift, and what each paid back, per refund method and currency */
  returns: { count: number; byMethod: { method: string; currency: Code; amountMinor: number }[] };
  /** Gift vouchers sold in this shift, per currency */
  vouchers: { count: number; byCurrency: { currency: Code; amountMinor: number }[] };
  /** Drawer movements of this shift in the order they were made */
  movements: { kind: CashMovementKind; currency: Code; amountMinor: number; reason: string }[];
}

/** Sums the shift's sales and drawer movements (10 › مطابقة الصندوق) from its documents. */
export function shiftActivity(shiftId: string, entries: readonly OutboxEntry[]): ShiftActivity {
  const terms = new Map<Code, Terms>();
  const termsOf = (currency: Code) => {
    let t = terms.get(currency);
    if (!t) {
      t = { ...NO_TERMS };
      terms.set(currency, t);
    }
    return t;
  };
  const byMethod = new Map<
    string,
    { method: PaymentMethod; currency: Code; count: number; amountMinor: number }
  >();
  let saleCount = 0;
  const refunds = new Map<string, { method: string; currency: Code; amountMinor: number }>();
  let returnCount = 0;
  const gifts = new Map<Code, number>();
  let giftCount = 0;
  const movements: ShiftActivity['movements'] = [];
  for (const { doc } of entries) {
    const payload = doc.payload as Record<string, unknown>;
    if (payload.shiftId !== shiftId) continue;
    if (doc.type === 'sale') {
      const sale = payload as unknown as SalePayload;
      saleCount += 1;
      for (const p of sale.payments) {
        if (p.method === 'cash') termsOf(p.currency).cashInMinor += p.amountMinor;
        const key = `${p.method}:${p.currency}`;
        const row = byMethod.get(key) ?? { method: p.method, currency: p.currency, count: 0, amountMinor: 0 };
        row.count += 1;
        row.amountMinor += p.amountMinor;
        byMethod.set(key, row);
      }
      if (sale.change) {
        termsOf(sale.change.currency).changeOutMinor += sale.change.amountMinor;
        const key = `cash:${sale.change.currency}`;
        const row = byMethod.get(key) ?? {
          method: 'cash',
          currency: sale.change.currency,
          count: 0,
          amountMinor: 0,
        };
        row.amountMinor -= sale.change.amountMinor;
        byMethod.set(key, row);
      }
    } else if (doc.type === 'return') {
      // Cash paid back for goods returned comes out of this drawer
      returnCount += 1;
      for (const r of (payload as unknown as ReturnPayload).refunds) {
        if (r.method === 'cash') termsOf(r.currency).refundsMinor += r.amountMinor;
        const key = `${r.method}:${r.currency}`;
        const row = refunds.get(key) ?? { method: r.method, currency: r.currency, amountMinor: 0 };
        row.amountMinor += r.amountMinor;
        refunds.set(key, row);
      }
    } else if (doc.type === 'receipt') {
      // A customer's payment in cash goes into this drawer
      const r = payload as unknown as ReceiptPayload;
      if (r.method === 'cash') termsOf(r.currency).receiptsMinor += r.amountMinor;
    } else if (doc.type === 'gift_voucher') {
      // A gift voucher sold for cash goes into this drawer, as money received
      const g = payload as unknown as GiftVoucherPayload;
      if (g.method === 'cash') termsOf(g.currency).receiptsMinor += g.amountMinor;
      giftCount += 1;
      gifts.set(g.currency, (gifts.get(g.currency) ?? 0) + g.amountMinor);
    } else if (doc.type === 'cash_movement') {
      const move = payload as unknown as CashMovementPayload;
      const t = termsOf(move.currency);
      movements.push({
        kind: move.kind,
        currency: move.currency,
        amountMinor: move.amountMinor,
        reason: move.reason,
      });
      if (move.kind === 'pay_in') t.payInMinor += move.amountMinor;
      else if (move.kind === 'safe_drop') t.dropsMinor += move.amountMinor;
      else t.payOutMinor += move.amountMinor;
    }
  }
  return {
    saleCount,
    terms,
    byMethod: [...byMethod.values()],
    returns: { count: returnCount, byMethod: [...refunds.values()] },
    vouchers: {
      count: giftCount,
      byCurrency: [...gifts].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    },
    movements,
  };
}

/**
 * The summary's payment rows as the cashier reads them: cash rows less the cash paid back for returns
 * (a row is added when cash was only paid out). Display only: the saved summary and the drawer formula
 * never read it.
 */
export function netMethodRows(activity: ShiftActivity | null | undefined): ShiftActivity['byMethod'] {
  const rows = (activity?.byMethod ?? []).map((row) => ({ ...row }));
  for (const refund of activity?.returns.byMethod ?? []) {
    if (refund.method !== 'cash') continue;
    const row = rows.find((r) => r.method === 'cash' && r.currency === refund.currency);
    if (row) row.amountMinor -= refund.amountMinor;
    else rows.push({ method: 'cash', currency: refund.currency, count: 0, amountMinor: -refund.amountMinor });
  }
  return rows;
}

/** One drawer at close, with every term of the formula, the expected amount and the difference. */
export function closeDrawer(
  currency: Code,
  baseCurrency: Code,
  rates: readonly TradeRate[],
  openingMinor: number,
  terms: Terms | undefined,
  counted: DrawerCount,
): ShiftCloseCash {
  const t = terms ?? NO_TERMS;
  const expectedMinor =
    openingMinor +
    t.cashInMinor +
    t.payInMinor -
    t.changeOutMinor -
    t.refundsMinor +
    t.receiptsMinor -
    t.payOutMinor -
    t.dropsMinor;
  const countedMinor = countTotal(counted);
  const differenceMinor = countedMinor - expectedMinor;
  const rate = rateFor(rates, currency, baseCurrency) ?? null;
  const cash = toCashCount(counted);
  return {
    currency,
    rate: rate ? { unit: rate.unit, quote: rate.quote, rate: rate.rate } : null,
    openingMinor,
    cashInMinor: t.cashInMinor,
    changeOutMinor: t.changeOutMinor,
    refundsMinor: t.refundsMinor,
    receiptsMinor: t.receiptsMinor,
    payInMinor: t.payInMinor,
    fxInMinor: 0,
    payOutMinor: t.payOutMinor,
    fxOutMinor: 0,
    dropsMinor: t.dropsMinor,
    expectedMinor,
    countedMinor,
    denominations: cash.denominations,
    differenceMinor,
    differenceBaseMinor:
      currency === baseCurrency
        ? differenceMinor
        : convert(differenceMinor, currency, baseCurrency, rate ?? undefined),
  };
}

export function shiftClosePayload(input: {
  shift: OpenShift;
  closedBy: string;
  baseCurrency: Code;
  cash: ShiftCloseCash[];
  activity: ShiftActivity;
}): ShiftClosePayload {
  return {
    shiftId: input.shift.id,
    shiftNumber: input.shift.number,
    closedBy: input.closedBy,
    baseCurrency: input.baseCurrency,
    cash: input.cash,
    shortageTreatment: 'loss',
    approval: null,
    summary: { saleCount: input.activity.saleCount, byMethod: input.activity.byMethod },
    forced: false,
  };
}
