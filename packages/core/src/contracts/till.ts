import { z } from 'zod';
import { barcodeCodeSchema, MAX_PRICE_MINOR } from './catalog';
import { isoDateSchema, uuidSchema } from './common';
import { CURRENCY_CODES, type CurrencyCode } from '../currencies';
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
  /**
   * «بالقديم»: a line under the total (and the change) that says the amount in old pounds; display only.
   * Left out (a store that never set it): ON until OLD_POUND_LINE_UNTIL, then off by itself. A store that
   * set it (true or false) keeps its setting: see showOldPoundOn.
   */
  showOldPound: z.boolean().optional(),
  /**
   * «مدة الحجز»: days a customer's hold keeps its pieces reserved before the reservation lapses (1 to 90);
   * left out: HOLD_EXPIRY_DAYS. Lapsing deletes nothing: its pieces are only available again.
   */
  holdExpiryDays: z.number().int().min(1).max(90).optional(),
  /** «مدة الفاتورة المعلّقة»: hours a cart put aside at this till keeps its pieces reserved (1 to 72); left out: HELD_CART_HOURS */
  heldCartHours: z.number().int().min(1).max(72).optional(),
  /** «صوت المسح»: the till beeps on a scan (a different sound for an unknown code); left out: on */
  scanBeep: z.boolean().optional(),
  /** «قفل الكاشير»: a cashier cannot leave the sale screen without a manager's PIN; off by default */
  cashierLock: z.boolean().optional(),
  /**
   * «اطلب الرقم التسلسلي عند الإتلاف» (round 66): writing off or expiring a serial-tracked item (damaged goods,
   * expiry, «سجّل هدراً») must name exactly one serial number per piece. Left out or false: the numbers may be put right later.
   */
  serialsOnWaste: z.boolean().optional(),
  /**
   * «أسباب التالف / الهدر» (round 38, #41): the reasons the till's «تالف / هدر» offers. Left out (or empty): the
   * built-in ones (wasteReasonsOf). Giving the list also turns the button on for a store of any type.
   */
  wasteReasons: z
    .array(z.string().trim().min(1, 'سبب فارغ').max(40, 'السبب طويل'))
    .max(12, '12 سبباً على الأكثر')
    .refine((r) => new Set(r).size === r.length, 'سبب مكرر')
    .optional(),
});
export type TillSettings = z.output<typeof tillSettingsSchema>;

/** The till's built-in note values (whole units, high to low) for the currencies it counts by note. */
export const DEFAULT_CASH_NOTES: Readonly<Record<string, readonly number[]>> = {
  SYP: [500, 200, 100, 50, 25, 10, 5],
  USD: [100, 50, 20, 10, 5, 1],
};

/** The last day (a business date, Damascus) the «بالقديم» line shows for a store that never set it */
export const OLD_POUND_LINE_UNTIL = '2027-07-31';

/**
 * Whether the «بالقديم» line shows (decision 8): a store that set it explicitly keeps its setting; a
 * store that never did gets it ON until the end of July 2027 and OFF after. `at` is the moment asked about
 * (the sale's own time when a receipt is printed, else now).
 */
export function showOldPoundOn(
  till: Pick<TillSettings, 'showOldPound'> | null | undefined,
  at: Date | number | string = Date.now(),
): boolean {
  if (typeof till?.showOldPound === 'boolean') return till.showOldPound;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return false;
  // Damascus is UTC+3 all year since 2022
  const day = new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
  return day <= OLD_POUND_LINE_UNTIL;
}

/** Days a customer's hold keeps its pieces reserved when the store did not set it */
export const HOLD_EXPIRY_DAYS = 7;
/** Hours a cart put aside at the till keeps its pieces reserved when the store did not set it */
export const HELD_CART_HOURS = 12;

export const holdExpiryDaysOf = (till: Pick<TillSettings, 'holdExpiryDays'> | null | undefined): number =>
  till?.holdExpiryDays ?? HOLD_EXPIRY_DAYS;
export const heldCartHoursOf = (till: Pick<TillSettings, 'heldCartHours'> | null | undefined): number =>
  till?.heldCartHours ?? HELD_CART_HOURS;

/**
 * An amount of new pounds as the old pounds it equals (100 old = 1 new): since the new pound keeps two
 * decimals the minor units are the old pounds themselves (125.00 new = 12,500 old). Display only.
 */
export function oldPoundText(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.round(minor))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

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

/**
 * The till searches the store's recent invoices (any till, any branch) by what the customer remembers:
 *
 *   GET /v1/device/invoices/search?q=…&days=…   invoiceSearchQuery → { invoices: InvoiceHit[] }
 *
 * `q` is part of the customer's name, their phone in any common form (0933…, +963 933…, 933…) or the
 * last digits of the invoice number; newest first, at most 20. `days` (default 30) is how far back.
 */
export const invoiceSearchQuery = z.object({
  // Empty = the newest invoices of the store (the return screen shows them when it opens)
  q: z.string().trim().max(64).default(''),
  days: z.coerce.number().int().min(1).max(3650).default(30),
});

export interface InvoiceHit {
  id: string;
  number: string;
  deviceTime: string;
  customerName: string | null;
  customerPhone: string | null;
  totalMinor: number;
  currency: CurrencyCode;
}

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

/**
 * «أضف صنف جديد» at the till (round 37, decision 15): a barcode the store does not know becomes a product
 * from the sale screen, through the product API's own write (createProduct), by someone who may manage the
 * catalog: the signed-in user who holds catalog.manage, or a manager whose code was typed on the till.
 *
 *   POST /v1/device/products   (Authorization: Device)   tillProductInput → TillProductPlaced (201)
 *
 * With no connection the till makes the product itself and queues it as a `temp_item` document
 * (contracts/till-products.ts, round 38), under ids it chose; the optional `productId` and `variantId` below are
 * those ids, so a request sent online and the document queued after a lost answer make one product. The product
 * is made «بانتظار المراجعة» (status temporary): the till sells it at once, the owner reviews it, and the
 * online shop shows it only once reviewed. The price is in the store's base currency. There is no cost
 * field: a product's cost comes from its purchases, never from the product.
 */
export const tillProductInput = z.object({
  /** The user who may add it: holds catalog.manage in this branch (the server checks) */
  actorId: uuidSchema,
  nameAr: z.string('اسم الصنف مطلوب').trim().min(1, 'اسم الصنف مطلوب').max(120, 'اسم الصنف طويل جداً'),
  priceMinor: z
    .number('اكتب السعر')
    .int()
    .min(1, 'اكتب سعراً أكبر من صفر')
    .max(MAX_PRICE_MINOR, 'السعر كبير جداً. تحقق من الأرقام.'),
  categoryId: uuidSchema.nullable().default(null),
  barcode: barcodeCodeSchema,
  /**
   * Round 38: the ids the till gave the product and its one variant before it asked, the same ones it queues (as a
   * `temp_item` document, contracts/till-products.ts) when it cannot reach the server. A repeat with the same
   * product id answers the product that exists and creates nothing twice.
   */
  productId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  /** Round 39, a pharmacy: the generic name, strength and form, all optional, so the product shows in the alternatives */
  genericName: z.string().trim().max(120, 'الاسم العلمي طويل جداً').nullable().optional(),
  strength: z.string().trim().max(40, 'التركيز طويل جداً').nullable().optional(),
  dosageForm: z.string().trim().max(40, 'الشكل الدوائي طويل جداً').nullable().optional(),
});
export type TillProductInput = z.input<typeof tillProductInput>;

export interface TillProductPlaced {
  productId: string;
  variantId: string;
  nameAr: string;
  barcode: string;
}

/**
 * «تالف / هدر» at the till (round 38, #41): a quick write-off of what spoiled, broke or was a sample. It is the
 * store's ordinary stock count (createStocktake: the same posting, Dr 6300 / Cr 1300, the same batch ledger)
 * for one or more items, each reduced BY the quantity written off (not counted to a total, so a sale made
 * a second earlier is never overwritten).
 *
 *   POST /v1/device/waste   (Authorization: Device)   tillWasteInput → StocktakeDetail (201)
 *
 * `actorId` is the user who holds inventory.adjust (the signed-in user, or the manager whose code was typed on
 * the till); `id` is made by the till once per write-off, so a retry after a lost answer posts nothing twice.
 * It needs the server, as «أضف صنف جديد» does.
 */
export const tillWasteInput = z.object({
  id: uuidSchema,
  actorId: uuidSchema,
  reason: z.string('اختر السبب').trim().min(1, 'اختر السبب').max(40, 'السبب طويل'),
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        /** Thousandths of the unit that go out, more than zero */
        qty: z.int('الكمية غير صحيحة').min(1, 'اكتب كمية أكبر من صفر').max(1_000_000_000),
        batchNo: z.string().trim().max(40).nullable().optional(),
        expiryDate: isoDateSchema.nullable().optional(),
      }),
    )
    .min(1, 'اختر صنفاً واحداً على الأقل')
    .max(50, 'حتى 50 صنفاً في المرة'),
});
export type TillWasteInput = z.input<typeof tillWasteInput>;
