import type { Prescription } from './contracts/documents';
import type { MedicineReturnPolicy, PharmacySettings, ShelfBatch, StockBatch } from './contracts/pharmacy';
import type { BatchAllocation } from './contracts/documents';

/**
 * The pharmacy rules the till and the server share (03 › الصيدليات): which batch a sale takes,
 * and which prescription fields an item asks for. Pure, so both sides give the same answer.
 */

export type BatchPick =
  /** Nothing is known about the item's batches: the sale goes as before */
  | { kind: 'none' }
  | { kind: 'ok'; batch: ShelfBatch }
  /** Every batch on the shelf is past its date: the line is refused */
  | { kind: 'expired'; latest: string };

/** First expiry first: the nearest batch that has not expired by `today` (good through its own date). */
export function pickBatch(batches: readonly ShelfBatch[] | null | undefined, today: string): BatchPick {
  if (!batches || batches.length === 0) return { kind: 'none' };
  const sorted = [...batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const good = sorted.find((b) => b.expiry >= today);
  if (good) return { kind: 'ok', batch: good };
  return { kind: 'expired', latest: sorted[sorted.length - 1]!.expiry };
}

export const PRESCRIPTION_FIELDS = ['ref', 'doctor', 'patientName', 'patientId'] as const;
export type PrescriptionField = (typeof PRESCRIPTION_FIELDS)[number];

export const PRESCRIPTION_FIELD_LABELS: Record<PrescriptionField, string> = {
  ref: 'رقم الوصفة',
  doctor: 'اسم الطبيب',
  patientName: 'اسم المريض',
  patientId: 'رقم هوية المريض',
};

export interface PrescriptionItemFlags {
  requiresPrescription?: boolean;
  controlled?: boolean;
}

export interface PrescriptionNeed {
  /** The till asks for the prescription before the sale closes */
  asks: boolean;
  /** The fields that must be filled; the others are asked but may stay empty */
  required: readonly PrescriptionField[];
  /** The fields to show */
  shown: readonly PrescriptionField[];
}

/**
 * What a cart's items ask for: a prescription medicine asks for the number and the doctor (they
 * must be filled when the store says `required`); a controlled drug asks for all four, always.
 */
export function prescriptionNeed(
  items: readonly PrescriptionItemFlags[],
  settings: PharmacySettings | null | undefined,
): PrescriptionNeed {
  const controlled = items.some((i) => i.controlled);
  if (controlled) return { asks: true, required: PRESCRIPTION_FIELDS, shown: PRESCRIPTION_FIELDS };
  if (items.some((i) => i.requiresPrescription)) {
    const shown: readonly PrescriptionField[] = ['ref', 'doctor'];
    return { asks: true, required: settings?.prescription === 'required' ? shown : [], shown };
  }
  return { asks: false, required: [], shown: [] };
}

/** The required fields still empty */
export function missingPrescription(
  need: PrescriptionNeed,
  prescription: Partial<Prescription> | null | undefined,
): PrescriptionField[] {
  return need.required.filter((field) => !prescription?.[field]?.trim());
}

/** Whether the till picks the batch and refuses an expired one: on unless the store turned it off */
export function usesAutoBatch(settings: PharmacySettings | null | undefined): boolean {
  return !!settings && settings.autoBatch !== false;
}

export function medicineReturnPolicy(settings: PharmacySettings | null | undefined): MedicineReturnPolicy {
  return settings?.returns ?? 'sealed';
}

export type MedicineReturnRule =
  /** Not a medicine, or the store takes it back as it is */
  | { kind: 'free' }
  /** The cashier confirms the box is sealed and unopened */
  | { kind: 'sealed' }
  | { kind: 'blocked'; reason: string };

/**
 * What the return screen does with a returned line. Only a store with pharmacy settings has a
 * rule, and only for a medicine. A controlled drug is never taken back unless the store says so
 * (and then still as a sealed box, unless the store takes everything back).
 */
export function medicineReturnRule(
  settings: PharmacySettings | null | undefined,
  item: { medicine: boolean; controlled: boolean },
): MedicineReturnRule {
  if (!settings || (!item.medicine && !item.controlled)) return { kind: 'free' };
  const policy = medicineReturnPolicy(settings);
  if (item.controlled) {
    if (!settings.controlledReturns) {
      return { kind: 'blocked', reason: 'دواء مراقَب: لا يُرجَع إلا إن سمح المحل بذلك من الإعدادات.' };
    }
    return policy === 'allowed' ? { kind: 'free' } : { kind: 'sealed' };
  }
  if (policy === 'none') return { kind: 'blocked', reason: 'المحل لا يقبل مرتجع الأدوية.' };
  return policy === 'sealed' ? { kind: 'sealed' } : { kind: 'free' };
}

// ─── Per-batch stock (FEFO) ───────────────────────────────────────────────────

export type BatchState = 'ok' | 'expired' | 'blocked' | 'empty';

/** Whether a batch can be sold from on `today` (good through its own date): empty, blocked, expired or fine. */
export function batchState(batch: StockBatch, today: string): BatchState {
  if (batch.qty <= 0) return 'empty';
  if (batch.blocked) return 'blocked';
  if (batch.expiry && batch.expiry < today) return 'expired';
  return 'ok';
}

/** First expiry first; a batch with no date last, then by number. */
const byExpiry = (a: StockBatch, b: StockBatch): number =>
  (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') ||
  (a.batchNo ?? '').localeCompare(b.batchNo ?? '');

export interface FefoResult {
  /** What to take from each batch, in the order taken (one line may span several batches) */
  allocations: BatchAllocation[];
  /** What no valid batch covered, base units; 0 when everything is allocated */
  uncovered: number;
  /** What sat in expired or blocked batches, so the till can say why it was left */
  expiredQty: number;
  blockedQty: number;
  /** The batches after the allocation: the next line of the cart takes from these */
  remaining: StockBatch[];
}

/**
 * First-expiry-first-out across the batches with something left that are neither expired (by
 * `today`) nor blocked. When one batch is short the line is split onto the next. Pure: the batches
 * given are not changed; `remaining` is what is left for the next line.
 */
export function allocateFefo(batches: readonly StockBatch[], qty: number, today: string): FefoResult {
  const remaining = batches.map((b) => ({ ...b }));
  let expiredQty = 0;
  let blockedQty = 0;
  for (const b of remaining) {
    const state = batchState(b, today);
    if (state === 'expired') expiredQty += b.qty;
    if (state === 'blocked') blockedQty += b.qty;
  }
  const allocations: BatchAllocation[] = [];
  let left = Math.max(0, qty);
  for (const b of [...remaining].sort(byExpiry)) {
    if (left === 0) break;
    if (batchState(b, today) !== 'ok') continue;
    const take = Math.min(left, b.qty);
    allocations.push({ batchNo: b.batchNo, expiry: b.expiry, qty: take });
    b.qty -= take;
    left -= take;
  }
  return { allocations, uncovered: left, expiredQty, blockedQty, remaining };
}

/** The same batch: number and expiry as received */
export const sameBatch = (
  a: { batchNo: string | null; expiry: string | null },
  b: { batchNo: string | null; expiry: string | null },
): boolean => (a.batchNo ?? '') === (b.batchNo ?? '') && (a.expiry ?? null) === (b.expiry ?? null);

/** Whether a sale of `wanted` base units goes past what is on hand (zero or negative on hand included) */
export function overStock(onHand: number | null | undefined, wanted: number): boolean {
  return onHand !== null && onHand !== undefined && wanted > Math.max(0, onHand);
}

/**
 * What the till does when no valid batch covers a line: `block` refuses (the store's setting),
 * `approve` asks a manager, `none` when the batches cover it or the item keeps no batches.
 */
export function uncoveredAction(
  settings: PharmacySettings | null | undefined,
  tracksBatches: boolean,
  uncovered: number,
): 'none' | 'block' | 'approve' {
  if (!tracksBatches || uncovered <= 0) return 'none';
  return settings?.blockNoBatch ? 'block' : 'approve';
}
