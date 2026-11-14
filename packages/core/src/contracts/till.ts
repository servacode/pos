import { z } from 'zod';
import { CURRENCY_CODES } from '../currencies';
import type { SectorKey } from '../sectors';

/** One currency's note values: whole units from 1 to 1,000,000, at most 20, none twice. */
export const CASH_NOTE_MAX = 1_000_000;
export const CASH_NOTES_PER_CURRENCY = 20;
const cashNoteList = z
  .array(z.number().int().min(1).max(CASH_NOTE_MAX))
  .min(1)
  .max(CASH_NOTES_PER_CURRENCY)
  .refine((list) => new Set(list).size === list.length, 'الفئة مكررة');

/**
 * «الصندوق»: the store's rules at the till (03 › الملابس: المرتجع والاستبدال، 08 › مرتجع مبيعات).
 *
 *   PUT /v1/store/till   tillSettingsSchema → StoreResponse (settings.manage)
 *
 * returnWindowDays: how many days back an invoice may be returned from; null = the default of the
 * business type (30 for clothing and medical supplies, 7 for the rest). cardApprovalRequired: whether a card payment
 * needs the terminal's approval number (off by default).
 */
export const tillSettingsSchema = z.object({
  returnWindowDays: z.number().int().min(1).max(365).nullable(),
  cardApprovalRequired: z.boolean(),
  /** «امنع البيع فوق المخزون»: the till refuses a sale of more than it has on hand (off: it warns) */
  blockNegativeStock: z.boolean().optional(),
  /**
   * «تجاوز حد الدين»: what the till does when a sale on account would take a customer over their
   * limit: ask a manager's code (default) or refuse. Within the limit a cashier sells on account
   * without a code.
   */
  creditOverLimit: z.enum(['approve', 'block']).optional(),
  /** «البيع بأقل من التكلفة»: ask a manager's code before a line sold under its average cost */
  belowCostApproval: z.boolean().optional(),
  /** «اطلب اسم الزبون وجواله لبيع جهاز بكفالة»; left out (or null): on for electronics and medical supplies */
  warrantyAskCustomer: z.boolean().nullable().optional(),
  /** The terms printed on the warranty certificate */
  warrantyTerms: z.string().trim().max(600).nullable().optional(),
  /**
   * «فئات النقد»: the banknote values the till's cash count offers, per currency, in whole units
   * (500 = 500 pounds), in any order. A currency left out (or the whole field) keeps the till's
   * built-in list. Additive and optional: an older till ignores it.
   */
  cashNotes: z.partialRecord(z.enum(CURRENCY_CODES), cashNoteList).optional(),
});
export type TillSettings = z.output<typeof tillSettingsSchema>;

/** The till's built-in note values (whole units, high to low) for the currencies it counts by note. */
export const DEFAULT_CASH_NOTES: Readonly<Record<string, readonly number[]>> = {
  SYP: [500, 200, 100, 50, 25, 10],
  USD: [100, 50, 20, 10, 5, 1],
};

/** The banknote values the till counts, sorted high to low; null for a currency the store did not set. */
export function cashNotesOf(
  till: Pick<TillSettings, 'cashNotes'> | null | undefined,
  currency: string,
): number[] | null {
  const list = (till?.cashNotes as Record<string, number[] | undefined> | undefined)?.[currency];
  return list && list.length > 0 ? [...list].sort((a, b) => b - a) : null;
}

export const DEFAULT_TILL_SETTINGS: TillSettings = { returnWindowDays: null, cardApprovalRequired: false };

/** Whether the till asks for the customer before it sells a device with a warranty */
export function warrantyAsksCustomer(
  till: Pick<TillSettings, 'warrantyAskCustomer'> | null | undefined,
  sectors: readonly SectorKey[] | undefined,
): boolean {
  if (till?.warrantyAskCustomer !== null && till?.warrantyAskCustomer !== undefined) {
    return till.warrantyAskCustomer;
  }
  return Boolean(sectors?.includes('electronics') || sectors?.includes('medical_supplies'));
}

export const DEFAULT_RETURN_DAYS = 7;
export const CLOTHING_RETURN_DAYS = 30;

/** The days an invoice may be returned from: the store's own number, else by business type. */
export function returnWindowDays(
  till: Pick<TillSettings, 'returnWindowDays'> | null | undefined,
  sectors: readonly SectorKey[] | undefined,
): number {
  if (till?.returnWindowDays) return till.returnWindowDays;
  return sectors?.includes('clothing') || sectors?.includes('medical_supplies')
    ? CLOTHING_RETURN_DAYS
    : DEFAULT_RETURN_DAYS;
}

/**
 * An invoice of the store as a till asks for it to return from (any till, any branch):
 *
 *   GET /v1/device/invoices/lookup?q=…   invoiceLookupQuery → InvoiceLookup (404 not_found)
 *
 * `q` is the invoice number as printed, the barcode of the receipt (the same text), or the last
 * digits of the number when only one invoice ends with them.
 */
export const invoiceLookupQuery = z.object({ q: z.string().trim().min(1).max(64) });

export interface InvoiceLookup {
  id: string;
  number: string;
  deviceTime: string;
  /** The sale document as it was saved (contracts/documents.ts SalePayload) */
  payload: unknown;
  /** What returns saved on any till already took back, per sale line */
  returned: {
    saleLineNo: number;
    qty: number;
    grossExTaxMinor: number;
    discountExTaxMinor: number;
    taxMinor: number;
    totalMinor: number;
  }[];
}
