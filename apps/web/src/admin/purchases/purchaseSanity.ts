import type { InventoryRow } from '@serva/core';

/** A cost this many times the usual one is asked about before it is saved */
export const COST_JUMP = 5;

/** One line of a purchase as the owner typed it: pieces (thousandths) and what the line cost (minor units) */
export interface SanityLine {
  variantId: string;
  name: string;
  qty: number | null;
  costMinor: number | null;
}

/**
 * What one piece of each item cost on average across the shelf (minor units per piece), from the
 * inventory rows: only a combination with stock and a value has an average to compare against.
 */
export function averageCosts(rows: readonly InventoryRow[]): Map<string, number> {
  const sums = new Map<string, { qty: number; value: number }>();
  for (const r of rows) {
    if (r.qty <= 0 || r.valueMinor <= 0) continue;
    const seen = sums.get(r.variantId) ?? { qty: 0, value: 0 };
    seen.qty += r.qty;
    seen.value += r.valueMinor;
    sums.set(r.variantId, seen);
  }
  const out = new Map<string, number>();
  for (const [id, s] of sums) out.set(id, (s.value * 1000) / s.qty);
  return out;
}

/** A date or a phone number pasted in the cost box reads as a huge round-looking number of digits */
export function looksLikeDateOrPhone(whole: number): boolean {
  if (!Number.isInteger(whole)) return false;
  const digits = String(whole);
  if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(digits)) return true;
  if (/^(0?[1-9]|[12]\d|3[01])(0?[1-9]|1[0-2])(19|20)\d{2}$/.test(digits)) return true;
  return /^(9639\d{8}|9\d{8})$/.test(digits);
}

const group = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Plain-words warnings for a purchase that looks wrong; empty when it looks fine. Warns only, never blocks. */
export function purchaseWarnings(
  lines: readonly SanityLine[],
  averages: ReadonlyMap<string, number>,
): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.costMinor === null || l.costMinor <= 0) continue;
    const whole = l.costMinor / 100;
    if (looksLikeDateOrPhone(whole)) {
      out.push(
        `«${l.name}»: مجموع الكلفة ${group(whole)} يشبه تاريخاً أو رقم هاتف. هل كتبته في الخانة الخطأ؟`,
      );
      continue;
    }
    const avg = averages.get(l.variantId);
    if (avg && l.qty && l.qty > 0) {
      const perPiece = (l.costMinor * 1000) / l.qty;
      if (perPiece > avg * COST_JUMP) {
        out.push(
          `«${l.name}»: كلفة القطعة ${group(perPiece / 100)} أكثر من ${COST_JUMP} أضعاف كلفتها المعتادة ${group(avg / 100)}.`,
        );
      }
    }
  }
  return out;
}
