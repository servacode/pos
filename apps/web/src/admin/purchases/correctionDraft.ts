import type { PurchaseDetail, PurchaseDraft } from '@serva/core';

/*
 * «صحّح الفاتورة» turns the old invoice back at once and hands over a copy to fix. The copy used to live only
 * in the open page: close the tab and it was gone. It is kept here (this tab's session storage) until the new
 * invoice is saved, so the owner can pick it up again.
 */

const KEY = 'serva.purchaseCorrection';

export interface KeptCorrection {
  draft: PurchaseDraft;
  original: string;
  reversal: string;
}

export function keepCorrection(value: KeptCorrection): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage may be off: the draft then lives in the page only */
  }
}

export function keptCorrection(): KeptCorrection | null {
  try {
    const text = sessionStorage.getItem(KEY);
    if (!text) return null;
    const value = JSON.parse(text) as KeptCorrection;
    return value?.draft?.lines && value.original ? value : null;
  } catch {
    return null;
  }
}

export function dropCorrection(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to drop */
  }
}

/** The lines of an invoice that was corrected, as the draft of one to write again (costs in the invoice's currency) */
export function draftOfDetail(detail: PurchaseDetail): PurchaseDraft {
  const usd = detail.currency === 'USD';
  return {
    supplierId: detail.supplierId,
    branchId: detail.branchId,
    date: detail.date,
    payment: detail.payment,
    reference: detail.reference,
    notes: detail.notes,
    currency: usd ? 'USD' : 'SYP',
    rate: usd ? (detail.rate ?? null) : null,
    purchaseOrderId: null,
    lines: detail.lines.map((l) => ({
      variantId: l.variantId,
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      costMinor: usd && typeof l.foreignCostMinor === 'number' ? l.foreignCostMinor : l.costMinor,
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
      ...(l.serials.length > 0 ? { serials: l.serials } : {}),
    })),
  };
}
