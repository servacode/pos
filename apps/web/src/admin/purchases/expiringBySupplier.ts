import type { ExpiryRow } from '@serva/core';
import type { ReturnPrefill } from './returnPrefill';

/**
 * «بينتهي خلال N شهر» (round 38, pharmacy): the batches that are gone or end within the window, grouped by the
 * supplier they came from (and the branch that holds them, since a return leaves one branch), the nearest
 * expiry first. A batch that came on no purchase has no supplier: it is listed but cannot be sent back from here.
 */
export interface ExpiringGroup {
  key: string;
  supplierId: string | null;
  supplierName: string;
  branchId: string;
  branchName: string;
  rows: ExpiryRow[];
  /** Base units, thousandths */
  totalQty: number;
  /** Days to the earliest expiry (negative: already gone) */
  earliestDays: number;
  /** How many of the rows are already past their date */
  expired: number;
}

export const UNKNOWN_SUPPLIER = 'مورد غير معروف';

export function groupExpiring(items: readonly ExpiryRow[], windowDays: number): ExpiringGroup[] {
  const groups = new Map<string, ExpiringGroup>();
  for (const row of items) {
    // The «بلا دفعة» row and a batch with no date are not an expiry
    if (row.expiryDate === null || row.daysLeft === null || row.qty <= 0 || row.daysLeft > windowDays)
      continue;
    const key = `${row.supplierId ?? ''}|${row.branchId}`;
    const group = groups.get(key) ?? {
      key,
      supplierId: row.supplierId,
      supplierName: row.supplierName ?? UNKNOWN_SUPPLIER,
      branchId: row.branchId,
      branchName: row.branchName,
      rows: [],
      totalQty: 0,
      earliestDays: Number.POSITIVE_INFINITY,
      expired: 0,
    };
    group.rows.push(row);
    group.totalQty += row.qty;
    group.earliestDays = Math.min(group.earliestDays, row.daysLeft);
    if (row.daysLeft < 0) group.expired += 1;
    groups.set(key, group);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  return [...groups.values()].sort(
    (a, b) => a.earliestDays - b.earliestDays || a.supplierName.localeCompare(b.supplierName, 'ar'),
  );
}

/** The supplier return a group's batches fill in: every batch with what is left of it */
export function prefillOfGroup(group: ExpiringGroup, months: number): ReturnPrefill | null {
  if (!group.supplierId) return null;
  return {
    supplierId: group.supplierId,
    branchId: group.branchId,
    note: `منتهية أو تنتهي خلال ${months} ${months === 1 ? 'شهر' : months === 2 ? 'شهرين' : 'أشهر'}`,
    lines: group.rows.map((r) => ({
      variantId: r.variantId,
      name: r.name,
      qty: r.qty,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate,
      purchaseId: r.purchaseId ?? null,
    })),
  };
}
