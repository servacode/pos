import { z } from 'zod';
import { isoDateSchema } from './common';

/**
 * Pharmacies (03 › الصيدليات): the store's prescription setting, the batches on a shelf as the
 * till gets them, and the controlled-drug register.
 *
 *   PUT /v1/store/pharmacy                  pharmacySettingsSchema → StoreResponse (settings.manage)
 *   GET /v1/pharmacy/controlled-register    controlledRegisterQuery → ControlledRegisterResponse
 *                                           (pharmacy.controlled)
 *   POST /v1/device/shortages               shortageRequestInput → ShortageRequestPlaced (a till, round 38)
 *   GET  /v1/pharmacy/shortages             → ShortagesResponse (purchases.manage)
 *   POST /v1/pharmacy/shortages/resolve {ids}  → ShortagesResponse (purchases.manage)
 */

export const PRESCRIPTION_MODES = ['required', 'optional'] as const;

/**
 * «مرتجع الأدوية»: no medicine comes back (`none`), only a sealed box the cashier confirms is
 * unopened (`sealed`, the default), or any (`allowed`).
 */
export const MEDICINE_RETURN_POLICIES = ['none', 'sealed', 'allowed'] as const;
export type MedicineReturnPolicy = (typeof MEDICINE_RETURN_POLICIES)[number];

/**
 * «الوصفة»: whether a prescription medicine's number and doctor must be written before the sale
 * closes (`required`) or may be left empty (`optional`). A controlled drug always needs them.
 *
 * Also kept here, and used by pharmacies and medical-supply stores alike:
 *   returns            the medicine return policy (default `sealed`)
 *   controlledReturns  a controlled drug may be returned at all (default no)
 *   autoBatch          the till picks the nearest unexpired batch and refuses an expired one
 *                      (default on for a pharmacy; a store that is not one writes it explicitly)
 */
export const pharmacySettingsSchema = z.object({
  prescription: z.enum(PRESCRIPTION_MODES),
  returns: z.enum(MEDICINE_RETURN_POLICIES).optional(),
  controlledReturns: z.boolean().optional(),
  autoBatch: z.boolean().optional(),
  /** «امنع البيع بلا دفعة صالحة»: no sale when no valid batch covers it (off: a manager approves) */
  blockNoBatch: z.boolean().optional(),
  /**
   * «بيع المنتهي برمز المدير» (round 38, FEFO): an expired batch is never sold, unless the owner turns
   * this on: then the manager's code lets the cashier sell it, and the sale is audited. Off or absent:
   * an expired batch is refused (whatever `blockNoBatch` says); a batch blocked for a recall never sells.
   */
  allowExpiredWithCode: z.boolean().optional(),
});
export type PharmacySettings = z.output<typeof pharmacySettingsSchema>;

/** What a pharmacy store gets before its owner chooses */
export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = { prescription: 'optional' };

/**
 * One batch still on an item's shelf (estimated from the receipts, services/expiry.ts), in the
 * order of the nearest expiry. No quantity: the set changes only when a batch runs out.
 */
/**
 * A batch this branch holds, with what is left of it (real per-batch balance, services/batches.ts),
 * carried on the item's stock level row to the till. Expired batches stay listed until written off.
 */
export interface StockBatch {
  batchNo: string | null;
  expiry: string | null;
  /** Base units, thousandths */
  qty: number;
  /** Blocked by hand (a recall): the till refuses it */
  blocked?: boolean;
}

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

// ─── Shortages «النواقص» (round 38) ────────────────────────────────────────────

/**
 * «طلبو زبون وما كان موجود»: a customer asked for an item the shelf did not have. The till writes it
 * with its own id, so a retry creates nothing twice. `variantId` is null for an item the catalogue
 * does not know (then `name` is what the customer asked for).
 */
export const shortageRequestInput = z.object({
  id: z.uuid(),
  variantId: z.uuid().nullable(),
  name: z.string().trim().min(1, 'اكتب اسم الصنف').max(160),
  /** Base units, thousandths: how much was asked for (default one) */
  qty: z.int().min(1).max(1_000_000_000).default(1000),
  note: z.string().trim().min(1).max(200).nullable().default(null),
});
export type ShortageRequestInput = z.output<typeof shortageRequestInput>;

export interface ShortageRequestPlaced {
  id: string;
  /** false when the same id had already been written (a retry) */
  created: boolean;
}

export const SHORTAGE_REASONS = ['below_min', 'requested', 'both'] as const;
export type ShortageReason = (typeof SHORTAGE_REASONS)[number];

/** One line of «النواقص»: an item at or under its minimum, or one a customer asked for and the shelf lacked */
export interface ShortageRow {
  /** null for a request of an item the catalogue does not know */
  variantId: string | null;
  name: string;
  genericName: string | null;
  /** Base units, thousandths, over every branch but the damaged one; null for an unknown item */
  stockQty: number | null;
  minStockQty: number | null;
  /** How many times customers asked for it, and the total asked, while it is still unresolved */
  requestCount: number;
  requestedQty: number;
  lastRequestedAt: string | null;
  /** The open request ids: «تم توفيره» closes them */
  requestIds: string[];
  reason: ShortageReason;
  lastSupplierId: string | null;
  lastSupplierName: string | null;
}

export interface ShortagesResponse {
  items: ShortageRow[];
}
