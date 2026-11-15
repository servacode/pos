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

/** What one piece of an item cost before, three ways (minor units per piece); each may be unknown */
export interface CostReference {
  /** Over the shelf now */
  average?: number | null;
  /** On its latest purchase */
  last?: number | null;
  /** The middle of its latest five purchases (one wrong purchase cannot move it) */
  typical?: number | null;
}

/** The three references of every item, from the inventory rows (the server sends the last and typical ones) */
export function referenceCosts(rows: readonly InventoryRow[]): Map<string, CostReference> {
  const out = new Map<string, CostReference>();
  for (const [id, average] of averageCosts(rows)) out.set(id, { average });
  for (const r of rows) {
    if (r.lastCostMinor === undefined && r.typicalCostMinor === undefined) continue;
    const seen = out.get(r.variantId) ?? {};
    seen.last = r.lastCostMinor ?? seen.last ?? null;
    seen.typical = r.typicalCostMinor ?? seen.typical ?? null;
    out.set(r.variantId, seen);
  }
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
  references: ReadonlyMap<string, number | CostReference>,
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
    const known = references.get(l.variantId);
    const ref: CostReference = typeof known === 'number' ? { average: known } : (known ?? {});
    if (l.qty && l.qty > 0) {
      const perPiece = (l.costMinor * 1000) / l.qty;
      // Either jump asks: against the shelf average, the last purchase, or the middle of the last five; the smallest one that is passed is told
      const candidates: { value: number | null | undefined; words: string }[] = [
        { value: ref.average, words: 'كلفتها المعتادة' },
        { value: ref.typical, words: 'كلفتها المعتادة' },
        { value: ref.last, words: 'كلفتها في آخر شراء' },
      ];
      const passed = candidates
        .filter((x): x is { value: number; words: string } => !!x.value && perPiece > x.value * COST_JUMP)
        .sort((a, b) => a.value - b.value)[0];
      if (passed) {
        out.push(
          `«${l.name}»: كلفة القطعة ${group(perPiece / 100)} أكثر من ${COST_JUMP} أضعاف ${passed.words} ${group(passed.value / 100)}.`,
        );
      }
    }
  }
  return out;
}
