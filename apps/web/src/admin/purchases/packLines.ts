import { packLine, packsToBase, QTY_SCALE, type PackOption } from '@serva/core';
import { moneyOf, qtyOf } from './api';

/** The fields of a document line typed in a pack: «50» of the «علبة» (100 pieces) at 25 each. */
export interface PackFields {
  /** The packs (or pieces) as typed */
  qty: string;
  /** Base units of one chosen pack, thousandths; 1000 is the piece itself */
  packQty: number;
  /** What one chosen pack cost, as typed; empty: the line's total is typed instead */
  unitCost?: string;
  /** The line's whole cost, as typed */
  cost?: string;
}

/** Pieces (base units, thousandths) the line stands for; null while the quantity is unusable. */
export function baseQtyOf(l: Pick<PackFields, 'qty' | 'packQty'>): number | null {
  const packs = qtyOf(l.qty);
  return packs === null ? null : packsToBase(packs, l.packQty);
}

/** 125000 minor units as the text a cost field shows: «1250» or «1250.5». */
export function moneyText(minor: number): string {
  return String(minor / 100);
}

/**
 * The line after a change: when a unit cost is typed, the total follows it (unit cost of a pack
 * times the packs, rounded once), so «50 علبة × 25» gives the total without a calculator.
 */
export function withPackChange<T extends PackFields>(line: T, patch: Partial<PackFields>): T {
  const next = { ...line, ...patch };
  if (patch.cost !== undefined && patch.unitCost === undefined) return { ...next, unitCost: '' };
  const unit = next.unitCost?.trim() ? moneyOf(next.unitCost) : null;
  const packs = qtyOf(next.qty);
  if (unit === null || packs === null) return next;
  const done = packLine(packs, next.packQty, unit);
  return done === null || done.costMinor === null ? next : { ...next, cost: moneyText(done.costMinor) };
}

/** «2 علبة (200 قطعة)»: a line in packs with what it comes to in pieces; the plain number for a piece. */
export function packSummary(
  packs: number,
  pack: Pick<PackOption, 'name' | 'qty'> | null,
  fmt: (thousandths: number) => string,
): string {
  if (!pack || pack.qty <= QTY_SCALE) return fmt(packs);
  const base = packsToBase(packs, pack.qty);
  return base === null ? fmt(packs) : `${fmt(packs)} ${pack.name} (${fmt(base)} قطعة)`;
}
