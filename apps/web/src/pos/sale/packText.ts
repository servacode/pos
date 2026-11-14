/**
 * A line sold by the pack reads «2 علبة (200 قطعة)»: the packs, the pack's name and what they come
 * to in pieces. A line of single units (or kilos) has nothing to add.
 */
interface PackedLine {
  /** Packs sold, thousandths */
  qty: number;
  /** Base units in one pack, thousandths; 1000 or missing: not a pack */
  packQty?: number | undefined;
}

/** The pieces a pack line comes to, thousandths: roundDiv(qty × packQty, 1000), as the sale stores it. */
export function pieceCount(line: Required<PackedLine>): number {
  return Math.round((line.qty * line.packQty) / 1000);
}

/** «(200 قطعة)» for a pack line, null for a line of single units. */
export function packPiecesNote(line: PackedLine, fmt: (thousandths: number) => string): string | null {
  if (line.packQty === undefined || line.packQty <= 1000) return null;
  return `(${fmt(pieceCount({ qty: line.qty, packQty: line.packQty }))} قطعة)`;
}

/** «2 علبة (200 قطعة)» for a pack line, null for a line of single units. */
export function packLineText(
  line: PackedLine & { packName?: string | null | undefined },
  fmt: (thousandths: number) => string,
): string | null {
  const note = packPiecesNote(line, fmt);
  return note === null ? null : `${fmt(line.qty)} ${line.packName?.trim() || 'عبوة'} ${note}`;
}
