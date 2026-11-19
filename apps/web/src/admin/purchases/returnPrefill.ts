/**
 * «رجّعو للمورد» from the expiring-soon report (round 38): the batches to send back, carried to the supplier
 * return page in the navigation state so it opens already filled (the person still checks the quantities).
 */
export interface ReturnPrefill {
  supplierId: string;
  branchId: string;
  note: string;
  lines: {
    variantId: string;
    name: string;
    /** Base units, thousandths */
    qty: number;
    batchNo: string | null;
    expiryDate: string | null;
  }[];
}

/** What a page reads from `location.state`, or null when it holds none */
export function prefillOf(state: unknown): ReturnPrefill | null {
  const value = (state as { prefill?: ReturnPrefill } | null)?.prefill;
  return value && typeof value.supplierId === 'string' && Array.isArray(value.lines) ? value : null;
}
