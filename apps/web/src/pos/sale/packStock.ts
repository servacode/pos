import { displayNumber } from '@serva/ui';

const QTY_SCALE = 1000;

type Digits = 'latn' | 'arab';

/** «علبة»: one, «علبتان»: two, «علب»: three to ten, then the singular again (Arabic counting) */
function boxWord(count: number, name: string | null): string {
  if (name) return name;
  if (count === 1) return 'علبة';
  if (count === 2) return 'علبتان';
  return count <= 10 ? 'علب' : 'علبة';
}

/**
 * What is on hand, for a box that was scanned (03 › سعر صنف): «4 علب و80 قطعة (480 قطعة)». With
 * less than a box, or a quantity that is no whole count of pieces, it is the pieces alone.
 * Quantities in thousandths, as the catalog keeps them.
 */
export function stockInPacks(
  left: number,
  pack: { name: string | null; qty: number } | null | undefined,
  digits: Digits,
  pieces: (qty: number) => string,
): string {
  const total = `${pieces(left)} قطعة`;
  if (!pack || pack.qty <= QTY_SCALE || left < pack.qty) return total;
  const boxes = Math.floor(left / pack.qty);
  const rest = left - boxes * pack.qty;
  const count = displayNumber(String(boxes), digits);
  const head = boxes <= 2 && !pack.name ? boxWord(boxes, null) : `${count} ${boxWord(boxes, pack.name)}`;
  const rem = rest > 0 ? ` و${pieces(rest)} قطعة` : '';
  return `${head}${rem} (${total})`;
}
