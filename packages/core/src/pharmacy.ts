import type { Prescription } from './contracts/documents';
import type { MedicineReturnPolicy, PharmacySettings, ShelfBatch } from './contracts/pharmacy';

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
