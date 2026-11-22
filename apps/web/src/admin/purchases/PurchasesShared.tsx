import { useState, type ReactNode } from 'react';
import {
  orderLineCost,
  orderLineRemaining,
  type PurchaseDraft,
  type PurchaseOrderDetail,
  type PurchasePayment,
  type SupplierRow,
} from '@serva/core';
import { BookIcon, CashIcon, ChequeIcon, type BadgeTone, type Icon } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { moneyText } from './packLines';
import { type PickedVariant } from './VariantPicker';

/**
 * Each way of paying as a card and as a state in the list (هوية 4 › Badge): on the supplier's
 * account is still owed, so it reads as a warning; paid from the safe or the bank, as settled.
 */
export const PAYMENT_LOOK: Record<PurchasePayment, { hint: string; icon: Icon; tone: BadgeTone }> = {
  credit: { hint: 'يُضاف إلى ما له عليك', icon: BookIcon, tone: 'warning' },
  cash: { hint: 'يُدفع الآن', icon: CashIcon, tone: 'success' },
  bank: { hint: 'يُحوَّل من حسابك', icon: ChequeIcon, tone: 'info' },
};

export interface Line extends PickedVariant {
  /** Pieces, or packs of `packQty` pieces (thousandths) when the item has packs */
  qty: string;
  packQty: number;
  /** What one pack (or piece) cost, as typed; the total follows it */
  unitCost?: string;
  cost: string;
  /** «رقم الدفعة» and «تاريخ الانتهاء» (03 › الصيدليات), both optional */
  batch?: string;
  expiry?: string;
  /** Serial numbers or IMEIs, one per line of text (03 › الإلكترونيات) */
  serials?: string;
}

export const pounds = (minor: number) => minor / 100;

export function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      return await work();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, fields, run, setFields };
}

/**
 * What a purchase order is still owed, as the lines of a purchase: the rest of each quantity at the
 * order's unit cost, which stays when the quantity is changed (the line's total follows it)
 */
export function linesOfOrder(order: PurchaseOrderDetail): Line[] {
  return order.lines
    .filter((l) => orderLineRemaining(l) > 0)
    .map((l) => {
      const left = orderLineRemaining(l);
      return {
        variantId: l.variantId,
        name: l.name,
        qty: String(left / 1000),
        packQty: 1000,
        unitCost: moneyText(l.unitCostMinor),
        cost: moneyText(orderLineCost(l.unitCostMinor, left)),
      };
    });
}

/** The invoice a correction gives back, as the lines of a new one to fix and save (costs in the invoice's currency) */
export function linesOfDraft(draft: PurchaseDraft): Line[] {
  return draft.lines.map((l) => ({
    variantId: l.variantId,
    productId: l.productId,
    name: l.name,
    qty: String(l.qty / 1000),
    packQty: 1000,
    cost: moneyText(l.costMinor),
    batch: l.batchNo ?? '',
    expiry: l.expiryDate ?? '',
    ...(l.serials && l.serials.length > 0 ? { serials: l.serials.join('\n') } : {}),
  }));
}

/** The grid of a purchase line: the item, its quantity, its cost and the bin. */
export const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_14rem_8rem_9rem_2.5rem]';

export function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 truncate text-end font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** A supplier the store owes in dollars and in nothing else: its payment starts in dollars */
export function dollarsOnly(supplier: SupplierRow | undefined): boolean {
  return (
    (supplier?.usdBalanceMinor ?? 0) > 0 && (supplier?.balanceMinor ?? 0) - (supplier?.usdBookMinor ?? 0) <= 0
  );
}
