import { z } from 'zod';
import { isoDateSchema } from './common';

/**
 * Pharmacies (03 › الصيدليات): the store's prescription setting, the batches on a shelf as the
 * till gets them, and the controlled-drug register.
 *
 *   PUT /v1/store/pharmacy                  pharmacySettingsSchema → StoreResponse (settings.manage)
 *   GET /v1/pharmacy/controlled-register    controlledRegisterQuery → ControlledRegisterResponse
 *                                           (pharmacy.controlled)
 */

export const PRESCRIPTION_MODES = ['required', 'optional'] as const;

/**
 * «الوصفة»: whether a prescription medicine's number and doctor must be written before the sale
 * closes (`required`) or may be left empty (`optional`). A controlled drug always needs them.
 */
export const pharmacySettingsSchema = z.object({
  prescription: z.enum(PRESCRIPTION_MODES),
});
export type PharmacySettings = z.output<typeof pharmacySettingsSchema>;

/** What a pharmacy store gets before its owner chooses */
export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = { prescription: 'optional' };

/**
 * One batch still on an item's shelf (estimated from the receipts, services/expiry.ts), in the
 * order of the nearest expiry. No quantity: the set changes only when a batch runs out.
 */
export interface ShelfBatch {
  batchNo: string | null;
  expiry: string;
}

export const controlledRegisterQuery = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, { message: 'تاريخ البداية بعد تاريخ النهاية', path: ['from'] });
export type ControlledRegisterQuery = z.output<typeof controlledRegisterQuery>;

/** One movement of a controlled item: «سجل الأدوية المراقبة» */
export interface ControlledRegisterRow {
  date: string;
  variantId: string;
  item: string;
  batchNo: string | null;
  /** sale, return, purchase, stocktake, transfer, supplier_return */
  kind: string;
  /** The invoice, return or purchase number; null for a count or a transfer */
  document: string | null;
  prescriptionRef: string | null;
  doctor: string | null;
  patientName: string | null;
  patientId: string | null;
  /** Thousandths of the base unit */
  qtyIn: number;
  qtyOut: number;
  /** The item's balance after this movement, from the register's own start */
  balance: number;
}

/** The register's balance against the stock now, for each controlled item */
export interface ControlledRegisterBalance {
  variantId: string;
  item: string;
  registerQty: number;
  stockQty: number;
  matches: boolean;
}

export interface ControlledRegisterResponse {
  from: string;
  to: string;
  rows: ControlledRegisterRow[];
  balances: ControlledRegisterBalance[];
  /** false when any item's register balance differs from its stock */
  matches: boolean;
}
