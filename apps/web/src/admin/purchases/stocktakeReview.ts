import type { InventoryRow } from '@serva/core';
import { qtyOf } from './api';

/** What is wrong with a counted quantity the owner typed, or null (an empty box is «not counted»). */
export function countProblem(text: string): string | null {
  const clean = text.trim();
  if (clean === '') return null;
  if (/^[-−–]/.test(clean)) return 'العدد لا يكون سالباً. اكتب ما وجدته على الرف، وصفراً إن لم يبقَ شيء.';
  if (qtyOf(clean) === null) return 'اكتب رقماً صحيحاً، بثلاث منازل عشرية على الأكثر.';
  return null;
}

export interface ReviewLine {
  variantId: string;
  name: string;
  branchId: string;
  countedQty: number;
  expectedQty: number;
  /** counted − expected, thousandths */
  diffQty: number;
  /** Value of the difference at the average cost: negative is a loss */
  diffValueMinor: number;
}

/**
 * The count before it is recorded: every counted item with what the system expects and the
 * difference in pieces and in value. Items left empty are not in it; unchanged ones stay in the list.
 */
export function reviewCount(items: InventoryRow[], counts: Record<string, string>): ReviewLine[] {
  const lines: ReviewLine[] = [];
  const seen = new Set<string>();
  for (const row of items) {
    if (seen.has(row.variantId)) continue;
    seen.add(row.variantId);
    const counted = qtyOf(counts[row.variantId] ?? '');
    if (counted === null) continue;
    const diffQty = counted - row.qty;
    const cost = row.unitCostMinor ?? 0;
    lines.push({
      variantId: row.variantId,
      name: row.name,
      branchId: row.branchId,
      countedQty: counted,
      expectedQty: row.qty,
      diffQty,
      diffValueMinor: Math.round((cost * diffQty) / 1000),
    });
  }
  return lines;
}

/** The kind of a difference, in words the owner uses: a gain, a loss or nothing. */
export function differenceKind(minorOrQty: number): 'gain' | 'loss' | 'none' {
  return minorOrQty > 0 ? 'gain' : minorOrQty < 0 ? 'loss' : 'none';
}

/** «زيادة» or «نقص» for a difference; empty when there is none. */
export const differenceWord = (value: number) =>
  ({ gain: 'زيادة', loss: 'نقص', none: 'مطابق' })[differenceKind(value)];
