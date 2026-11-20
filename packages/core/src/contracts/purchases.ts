import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { contactPhoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, positiveMinorSchema, uuidSchema } from './common';
import { chequeDetailsSchema } from './cheques';
import { rateSchema } from './store';

/**
 * Suppliers, purchases, payments to suppliers, stock value and counts (08 › فاتورة شراء، سند دفع،
 * الجرد; 10 › الكلفة والربح). All of it is entered on the dashboard, never on a till: tills never
 * see a cost (17 › الكلفة لا تصل جهاز الكاشير أبداً).
 *
 *   GET  /v1/suppliers                 SupplierListResponse          (purchases.manage)
 *   POST /v1/suppliers                 supplierInput → SupplierRow
 *   PUT  /v1/suppliers/{id}            supplierInput → SupplierRow
 *   GET  /v1/purchases?from&to         PurchaseListResponse          (purchases.manage)
 *   POST /v1/purchases                 purchaseInput → PurchaseDetail
 *   GET  /v1/purchases/{id}            PurchaseDetail
 *   POST /v1/supplier-payments         supplierPaymentInput → SupplierPaymentRow
 *   GET  /v1/inventory?branchId        InventoryResponse             (cost.view)
 *   POST /v1/stocktakes                stocktakeInput → StocktakeDetail (inventory.adjust)
 *   GET  /v1/inventory/count-sheet     countSheetQuery → CountSheet  (inventory.adjust; the phone's count, round 38)
 *   GET  /v1/reports/waste?from&to     wasteReportQuery → WasteReport (inventory.adjust or reports.financial)
 *   GET  /v1/reports/profit?from&to    ProfitReport                  (reports.financial)
 *   GET  /v1/inventory/expiry?days     ExpiryResponse                (purchases.manage)
 */

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const supplierInput = z.object({
  name: z.string('اسم المورد مطلوب').trim().min(2, 'اكتب اسم المورد').max(120, 'الاسم طويل'),
  phone: contactPhoneSchema,
  notes: optionalText(500, 'الملاحظات طويلة'),
  archived: z.boolean().optional(),
});
export type SupplierInput = z.output<typeof supplierInput>;

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  /** What the store owes the supplier, base currency (a dollar debt at the rate it was booked at) */
  balanceMinor: number;
  archived: boolean;
  /** The date of the latest purchase invoice (yyyy-mm-dd), null with none; absent from older servers */
  lastPurchaseOn?: string | null;
  /** All the supplier's purchase invoices together, base currency; absent from older servers */
  purchasesTotalMinor?: number;
  /**
   * Round 36 (decision 11): what the store owes the supplier in dollars, cents (negative: the supplier
   * owes the store, an advance); 0 for a supplier with no dollar debt. Absent from older servers.
   */
  usdBalanceMinor?: number;
  /** The base-currency value the books give that dollar debt (at the rates of its invoices); part of balanceMinor */
  usdBookMinor?: number;
}

export interface SupplierListResponse {
  items: SupplierRow[];
  totalOwedMinor: number;
  baseCurrency: CurrencyCode;
}

/** How a purchase is paid: on the supplier's account, from the safe, or from the bank */
export const PURCHASE_PAYMENTS = ['credit', 'cash', 'bank'] as const;
export type PurchasePayment = (typeof PURCHASE_PAYMENTS)[number];

/** A serial number or IMEI as scanned: spaces dropped, Latin letters and digits */
export const serialSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().min(3, 'الرقم قصير').max(40, 'الرقم طويل'));

/** A line's identity in a document: the item and its batch (the same item twice needs different batches) */
export const batchKey = (l: {
  variantId: string;
  batchNo?: string | null;
  expiryDate?: string | null;
}): string => `${l.variantId}|${l.batchNo ?? ''}|${l.expiryDate ?? ''}`;

/**
 * The currency of a purchase invoice (round 36, decision 11). `SYP` (or left out) is the store's base
 * currency, as always; `USD` is a dollar invoice: its lines' costs are dollars, converted at the rate of
 * the day into the base currency for the stock and the cost, and the supplier's debt is kept in dollars.
 */
export const PURCHASE_CURRENCY_CODES = ['SYP', 'USD'] as const;
export type PurchaseCurrencyCode = (typeof PURCHASE_CURRENCY_CODES)[number];

export const purchaseLineInput = z.object({
  variantId: uuidSchema,
  /** Base units bought, thousandths (12.5 kg is 12500) */
  qty: z.int('الكمية مطلوبة').positive('الكمية أكبر من صفر').max(1_000_000_000, 'الكمية كبيرة'),
  /** What the line cost in all, minor units of the invoice's currency (the base currency unless `currency` is USD) */
  costMinor: nonNegativeMinorSchema,
  /** «رقم الدفعة» (03 › الصيدليات) */
  batchNo: optionalText(40, 'رقم الدفعة طويل'),
  /** «تاريخ الانتهاء» of what came in */
  expiryDate: isoDateSchema.nullable().optional(),
  /** The pieces' serial numbers or IMEIs (03 › الإلكترونيات): one per piece of a product that tracks them */
  serials: z.array(serialSchema).max(1000).optional(),
});

export const purchaseInput = z
  .object({
    /** Round 44: the document's own id, made by the form when it opens. The same id again answers the document already made and posts nothing twice (a retry after a dropped connection) */
    id: uuidSchema.optional(),
    supplierId: uuidSchema,
    branchId: uuidSchema.optional(),
    date: isoDateSchema,
    payment: z.enum(PURCHASE_PAYMENTS),
    /** The invoice's currency; left out it is the base currency */
    currency: z.enum(PURCHASE_CURRENCY_CODES).optional(),
    /** Pounds for one dollar on the day of a dollar invoice; left out, the store's rate */
    rate: rateSchema.optional(),
    /** The supplier's invoice number */
    reference: optionalText(64, 'الرقم طويل'),
    notes: optionalText(500, 'الملاحظات طويلة'),
    lines: z.array(purchaseLineInput).min(1, 'أضف صنفاً واحداً على الأقل').max(500),
    /** The purchase order this receives (طلبية شراء): its received quantities grow by these lines */
    purchaseOrderId: uuidSchema.optional(),
  })
  .refine((p) => new Set(p.lines.map(batchKey)).size === p.lines.length, {
    path: ['lines'],
    message: 'كل صنف مرة واحدة في الفاتورة إلا إن اختلفت الدفعة',
  });
export type PurchaseInput = z.output<typeof purchaseInput>;

export interface PurchaseLineRow {
  lineNo: number;
  variantId: string;
  /** The variant's product, for printing the line's labels */
  productId: string;
  name: string;
  qty: number;
  /** What the line cost, always in the base currency (a dollar line converted at the invoice's rate) */
  costMinor: number;
  /** A dollar invoice: what the line cost in dollars, cents; absent or null otherwise */
  foreignCostMinor?: number | null;
  batchNo: string | null;
  expiryDate: string | null;
  serials: string[];
}

export interface PurchaseRow {
  id: string;
  number: string;
  date: string;
  supplierId: string;
  supplierName: string;
  payment: PurchasePayment;
  reference: string | null;
  /** The invoice in the base currency */
  totalMinor: number;
  /** Round 36: a dollar invoice names its currency, its dollars (cents) and the rate it was booked at; absent otherwise */
  currency?: PurchaseCurrencyCode | null;
  foreignTotalMinor?: number | null;
  rate?: string | null;
  /** Round 36 (decision 12): the document that corrected this invoice, once it has been; absent otherwise */
  correctedBy?: { id: string; number: string; date: string } | null;
}

export interface PurchaseDetail extends PurchaseRow {
  branchId: string;
  notes: string | null;
  lines: PurchaseLineRow[];
  /** The purchase order this invoice received, if any */
  purchaseOrderId?: string | null;
  baseCurrency: CurrencyCode;
}

/**
 *   POST /v1/purchases/{id}/correct   purchases.manage   purchaseCorrectionInput → PurchaseCorrection (201)
 *
 * «صحّح الفاتورة» (round 36, decision 12): a posted purchase is never edited. The correction posts a full
 * reversal document (the stock out at the cost it came in at, the supplier's debt or the cash back through
 * the reversing entry of the invoice's own entry) and answers a pre-filled draft of a new invoice to fix and
 * save. Refused with 409 when part of what the invoice received was sold and the rest on hand cannot cover
 * it: the answer says so and points to a return to the supplier instead.
 */
export const purchaseCorrectionInput = z.object({
  /** The day of the reversal; left out, today */
  date: isoDateSchema.optional(),
  reason: optionalText(200, 'السبب طويل'),
});
export type PurchaseCorrectionInput = z.output<typeof purchaseCorrectionInput>;

export interface PurchaseDraft {
  supplierId: string;
  branchId: string;
  date: string;
  payment: PurchasePayment;
  reference: string | null;
  notes: string | null;
  currency: PurchaseCurrencyCode;
  rate: string | null;
  purchaseOrderId: string | null;
  /** costMinor is in the draft's currency, the way the form takes it */
  lines: (PurchaseInput['lines'][number] & { name: string; productId: string })[];
}

export interface PurchaseCorrection {
  reversal: { id: string; number: string; date: string; valueOutMinor: number };
  draft: PurchaseDraft;
}

export interface PurchaseListResponse {
  items: PurchaseRow[];
  baseCurrency: CurrencyCode;
  /** Round 44: the cursor of the next page when the request asked for pages (`limit`); null on the last page. Absent from older servers */
  nextCursor?: string | null;
  /** Round 44: what the filters match in all (corrected invoices left out): how many and their total. Absent from older servers */
  summary?: { count: number; totalMinor: number };
}

export const purchaseListQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  supplierId: uuidSchema.optional(),
  /** Round 44: pages. Without `limit` the list is the newest 500, as before */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(80).optional(),
  /** Round 44: a number, a supplier's name or the supplier's own invoice number */
  q: z.string().trim().max(80).optional(),
  payment: z.enum(PURCHASE_PAYMENTS).optional(),
});

/** The largest single payment to a supplier, minor units (100 billion pounds): above it is a typing slip */
export const MAX_PAYMENT_MINOR = 10_000_000_000_000;

export const supplierPaymentInput = z.object({
  /** Round 44: the document's own id, made by the form when it opens. The same id again answers the document already made and posts nothing twice (a retry after a dropped connection) */
  id: uuidSchema.optional(),
  supplierId: uuidSchema,
  date: isoDateSchema,
  amountMinor: positiveMinorSchema.max(MAX_PAYMENT_MINOR, 'المبلغ كبير جداً. تحقّق من الأصفار'),
  method: z.enum(['cash', 'bank']),
  /** A payment by cheque goes out of the bank account; its bank, number and due date are kept with it */
  cheque: chequeDetailsSchema.optional(),
  note: optionalText(200, 'الملاحظة طويلة'),
  /** The owner confirmed the payment is more than what is owed: it stays as an advance with the supplier */
  advance: z.boolean().optional(),
  /**
   * Round 36 (decision 11): `USD` pays a dollar debt from the dollar safe (or the bank): `amountMinor` is then
   * dollars (cents), at `rate` (left out, the store's rate). The difference between that rate and the one the
   * debt was booked at is posted to «فروقات صرف محققة» (6510). SYP or left out: the base currency, as always.
   */
  currency: z.enum(PURCHASE_CURRENCY_CODES).optional(),
  rate: rateSchema.optional(),
});
export type SupplierPaymentInput = z.output<typeof supplierPaymentInput>;

export interface SupplierPaymentRow {
  id: string;
  number: string;
  supplierId: string;
  date: string;
  /** In the currency of the payment: the base currency, or dollars (cents) when `currency` is USD */
  amountMinor: number;
  method: 'cash' | 'bank';
  /** Round 36: a dollar payment: its currency, rate, the base-currency cost and the exchange difference (positive: a loss) */
  currency?: PurchaseCurrencyCode;
  rate?: string | null;
  baseMinor?: number;
  fxMinor?: number;
}

export const inventoryQuery = z.object({ branchId: uuidSchema.optional() });

export interface InventoryRow {
  variantId: string;
  name: string;
  /** The piece's options (المقاس، اللون…) and its model, for laying a model out as a grid; absent from older servers */
  attributes?: { name: string; value: string }[];
  productId?: string;
  productName?: string;
  /** The unit takes fractions (a weighed item); false for pieces. Absent from older servers */
  allowsFraction?: boolean;
  branchId: string;
  /** The branch's name and kind (store, van), so a van's stock is told apart from a store's; absent from older servers */
  branchName?: string;
  branchKind?: string;
  /** Base units, thousandths */
  qty: number;
  valueMinor: number;
  /** What can be sold: the stock without the expired and blocked batches, never below zero; absent from older servers */
  sellableQty?: number;
  /** The last known average (what a count's difference is valued at when the stock is at or below zero); absent from older servers */
  refQty?: number;
  refValueMinor?: number;
  /** For display: value of one base unit, four decimals of the minor unit at most */
  unitCostMinor: number | null;
  /** What one piece cost on its latest purchase (minor units); null when never bought. Absent from older servers */
  lastCostMinor?: number | null;
  /** The middle cost of one piece over its latest five purchases; one wrong purchase cannot move it. Absent from older servers */
  typicalCostMinor?: number | null;
}

export interface InventoryResponse {
  items: InventoryRow[];
  totalValueMinor: number;
  baseCurrency: CurrencyCode;
  /** The reasons «سجّل هدراً» offers: the store's own, or the built-in ones; absent from older servers */
  wasteReasons?: string[];
  /** The database clock when the list was read: a write-off made from it counts what moved since (round 44) */
  asOf?: string;
}

export const stocktakeInput = z.object({
  /**
   * Round 38: the document's own id, made by the device that counted (a phone counting offline, a till's
   * waste). A second post of the same id answers the document already made and posts nothing again.
   */
  id: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  date: isoDateSchema,
  /**
   * When the sheet the count was made against was downloaded (a phone counts against a sheet it keeps). The
   * server then counts what the stock has moved by since that moment (a sale after the download) as already
   * gone from the shelf, so the count does not bring those pieces back. Without it the counts are taken as of now.
   */
  countedAt: z.iso.datetime({ offset: true }).optional(),
  note: optionalText(200, 'الملاحظة طويلة'),
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        /** What was counted on the shelf, base units, thousandths */
        countedQty: z.int().nonnegative('العدد لا يكون سالباً'),
        /**
         * A count of one batch (or a write-off of it): `countedQty` is what is left of THAT batch,
         * and the item's stock moves by the difference. Without it the count is of the whole item.
         */
        batchNo: optionalText(40, 'رقم الدفعة طويل'),
        expiryDate: isoDateSchema.nullable().optional(),
        /**
         * Round 38: the line is a waste («تالف / هدر») and this is why («انتهت صلاحيتو»…). It only labels the
         * line for the waste report; the posting is the count's own.
         */
        wasteReason: optionalText(40, 'السبب طويل'),
      }),
    )
    .min(1, 'عدّ صنفاً واحداً على الأقل')
    .max(5000),
});
export type StocktakeInput = z.output<typeof stocktakeInput>;

export interface StocktakeLineRow {
  variantId: string;
  name: string;
  expectedQty: number;
  countedQty: number;
  /** counted − expected */
  diffQty: number;
  /** Value of the difference: negative is a loss */
  diffValueMinor: number;
  /** Round 38: the reason of a waste line; absent on a count line and on older documents */
  reason?: string;
}

/** The reasons a store starts with at the till's «تالف / هدر» until the owner writes its own */
export const DEFAULT_WASTE_REASONS: readonly string[] = ['انتهت صلاحيتو', 'انكسر', 'خربان', 'عينة'];

/** The reasons the till offers: the store's own list, or the defaults when it never set one */
export function wasteReasonsOf(stored: readonly string[] | null | undefined): string[] {
  const own = (stored ?? []).map((r) => r.trim()).filter(Boolean);
  return own.length > 0 ? own : [...DEFAULT_WASTE_REASONS];
}

/** The note an old waste (before reasons) carries; the report reads such documents as «بلا سبب» */
export const LEGACY_WASTE_NOTE = 'هدر';

export interface StocktakeDetail {
  id: string;
  number: string;
  date: string;
  branchId: string;
  lines: StocktakeLineRow[];
  /** Sum of the differences' value */
  diffValueMinor: number;
  baseCurrency: CurrencyCode;
}

/**
 *   GET /v1/stocktakes?limit&cursor   inventory.adjust   → StocktakeListResponse
 * The counts already made, newest first (round 44): who counted, in which branch, and what the difference cost.
 */
export const stocktakeListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(40).optional(),
});
export interface StocktakeListRow {
  id: string;
  number: string;
  date: string;
  branchId: string;
  branchName: string;
  /** Who made the count (the person's name); empty when unknown */
  by: string;
  /** What kind of document it was: a shelf count, a waste, a shortage on a transfer */
  kind: 'count' | 'waste' | 'shortage';
  items: number;
  diffValueMinor: number;
  note: string | null;
}
export interface StocktakeListResponse {
  items: StocktakeListRow[];
  nextCursor: string | null;
}

/** Batches still on the shelf that end within `days` (90 by default), or already have. */
export const expiryQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(90),
  /** One item's batches, whatever their dates (the supplier return and the count pick from them) */
  variantId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  /**
   * `1`: also list the «بلا دفعة» row (what no batch holds, even below zero) so the batches add up to the
   * stock; always on with `variantId`
   */
  unbatched: z.enum(['1']).optional(),
});

/**
 * A batch the store holds (03 › الصيدليات: الصلاحية): the real balance per branch, from the batch
 * ledger (received − sold − returned to the supplier − written off ± transfers). An expired batch
 * stays listed with what is left of it until it is written off.
 */
export interface ExpiryRow {
  variantId: string;
  name: string;
  branchId: string;
  branchName: string;
  batchNo: string | null;
  expiryDate: string | null;
  /** The receipt this batch came in on (the earliest) and its supplier, for the supplier return */
  purchaseNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  receivedOn: string | null;
  /** The one purchase invoice this batch came on; null when none, or when it came on more than one (round 39) */
  purchaseId?: string | null;
  /** What is left of the batch in this branch, base units, thousandths */
  qty: number;
  /** Days from today; negative when it has expired; null when it has no date */
  daysLeft: number | null;
  /** Blocked by hand (a recall): no till sells it */
  blocked: boolean;
  blockReason: string | null;
}

export interface ExpiryResponse {
  items: ExpiryRow[];
  today: string;
}

/** POST /v1/batches/block and /unblock (purchases.manage): stops (or lets) every till sell a batch */
export const batchBlockInput = z.object({
  batchNo: z.string().trim().min(1, 'اكتب رقم الدفعة').max(60),
  /** One product's batch; left out, every product that holds this batch number */
  variantId: uuidSchema.optional(),
  reason: optionalText(200, 'السبب طويل'),
});
export type BatchBlockInput = z.output<typeof batchBlockInput>;

export interface BatchBlockResult {
  /** How many products' batches changed */
  count: number;
}

/** GET /v1/batches/recall?batchNo= (purchases.manage): who has a batch, for a recall (سحب دفعة) */
export const recallQuery = z.object({ batchNo: z.string().trim().min(1, 'اكتب رقم الدفعة').max(60) });

export interface RecallBatch {
  variantId: string;
  name: string;
  batchNo: string;
  expiryDate: string | null;
  blocked: boolean;
  blockReason: string | null;
  /** The receipts it came in on, with the supplier */
  receipts: { purchaseNumber: string; supplierName: string; receivedOn: string; qty: number }[];
  /** What is left in each branch, base units */
  branches: { branchId: string; branchName: string; qty: number }[];
  /** Sold in all, base units */
  soldQty: number;
  /** Of those, taken back in a customer return, base units (absent from an older server) */
  returnedQty?: number;
}

export interface RecallSale {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  branchName: string;
  variantId: string;
  name: string;
  qty: number;
  customerName: string | null;
  customerPhone: string | null;
}

export interface RecallResponse {
  batchNo: string;
  batches: RecallBatch[];
  sales: RecallSale[];
}

// ─── Serial numbers ───────────────────────────────────────────────────────────

/** GET /v1/serials?q= (catalog.manage): a piece by its number, or the last ones received */
export const serialQuery = z.object({
  q: z.string().trim().max(40).optional(),
  /** The pieces one sale sold (the invoice page's claim button) */
  saleId: uuidSchema.optional(),
  /** The pieces sold to one customer (the customer page's claim button) */
  customerId: uuidSchema.optional(),
  /** Only the numbers the owner has to look at (sold unknown, twice, or out of stock under another product) */
  flagged: z.enum(['1']).optional(),
});

/** Why a serial needs the owner's look: never received, sold more than once, or another product's number */
export const SERIAL_FLAG_LABELS = {
  unknown: 'لم يُستلم في المحل',
  duplicate: 'بيع أكثر من مرة',
  other_product: 'رقم صنف آخر',
  override: 'سمح المدير به عند البيع',
} as const;
export type SerialFlag = keyof typeof SERIAL_FLAG_LABELS;

/** One sale of a serial (the latest is on the row; the rest are its history) */
export interface SerialSaleRow {
  saleId?: string | null;
  saleNumber: string | null;
  soldOn: string;
  flag: SerialFlag | null;
  customerName: string | null;
}

/** `POST /v1/serials/fix` (inventory.adjust): put a drifted row right, with the reason */
export const serialFixInput = z.object({
  serial: z.string().trim().min(3).max(40),
  /** in_stock: back in the branch's stock; sold: sold by its latest sale in the history */
  status: z.enum(['in_stock', 'sold']),
  /** With status sold: the sale that went out without this piece's number (picked from «بيعات بلا رقم») */
  saleId: uuidSchema.optional(),
  /** A number sold by two sales: the sale that keeps it (the other stays in the history, flagged) */
  keepSaleId: uuidSchema.optional(),
});
export type SerialFixInput = z.input<typeof serialFixInput>;

/** A sale of a serial-tracked product that went out with fewer numbers than pieces (flag serial_missing) */
export interface UnassignedSerialSale {
  saleId: string;
  saleNumber: string;
  soldOn: string;
  variantId: string;
  name: string;
  /** Pieces that left without a number */
  missing: number;
  /** The variant's serials still «في المحل», to pick the one that left */
  candidates: string[];
}

/** A product sold under its cost in the period (sold net of tax and returns, cost from the ledger) */
export interface BelowCostItem {
  productId: string;
  name: string;
  /** Base units sold less returned (x1000, like every quantity) */
  qty: number;
  soldMinor: number;
  costMinor: number;
  lossMinor: number;
}

/**
 * `serials` pulled to the tills (03 › الإلكترونيات): the branch's in-stock pieces of products that
 * track them, and those sold lately, so the till refuses a number that is not in stock.
 */
export interface SerialStockRow {
  id: string;
  variantId: string;
  serial: string;
  /** rented: out with a customer on a rental (03 › الأدوات الطبية: التأجير), not for sale */
  status: 'in_stock' | 'sold' | 'rented' | 'returned' | 'in_transit' | 'lost';
  /** The invoice that sold it, for «هذا الرقم مباع في الفاتورة …» */
  saleNumber: string | null;
  version: number;
}

export interface SerialRow {
  serial: string;
  variantId: string;
  name: string;
  status: 'in_stock' | 'sold' | 'rented' | 'returned' | 'in_transit' | 'lost';
  purchaseNumber: string | null;
  receivedOn: string | null;
  saleNumber: string | null;
  soldOn: string | null;
  warrantyUntil: string | null;
  /** The owner's look: what went wrong with this number (empty for a clean one) */
  flags: SerialFlag[];
  /** Every sale of the number, the newest first */
  sales: SerialSaleRow[];
  /** The latest buyer */
  customerName: string | null;
  saleId: string | null;
}

export const profitQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export interface ProfitReport {
  from: string;
  to: string;
  /** Sales less discounts and returns, tax excluded (4100 − 4200 − 4300) */
  netSalesMinor: number;
  /** 5100 */
  costOfSalesMinor: number;
  grossProfitMinor: number;
  /** 6300: what counts found missing, less what they found over */
  stockLossMinor: number;
  /** Products that sold for less than they cost in the period (net of tax and returns) */
  belowCostCount?: number;
  /** Those products, the biggest loss first (up to 100): what the margin hint's link lists */
  belowCost?: BelowCostItem[];
  baseCurrency: CurrencyCode;
}

// ─── Transfers between branches (09 › transfers) ──────────────────────────────

/**
 *   GET  /v1/transfers    inventory.adjust   → { items: TransferRow[] }
 *   POST /v1/transfers    inventory.adjust   transferInput → TransferDetail (201)
 *
 * Goods sent from one branch to another, in one step: out of the sending branch at its average
 * cost, into the receiving one at that same value. Each branch's books move with its stock: the
 * sender Dr 1900 (جاري الفروع) / Cr 1300, the receiver Dr 1300 / Cr 1900.
 */
export const transferInput = z
  .object({
    fromBranchId: uuidSchema,
    toBranchId: uuidSchema,
    date: isoDateSchema,
    note: optionalText(200, 'الملاحظة طويلة'),
    /** Round 37: send it in one step or «بالطريق»; left out, the store's setting decides (TransferMode) */
    mode: z.enum(['instant', 'transit']).optional(),
    /** Round 44: refuse more than the sending branch holds (the screen sets it; left out, stock may go below nothing as at the till) */
    strictStock: z.boolean().optional(),
    lines: z
      .array(
        z.object({
          variantId: uuidSchema,
          qty: z.int().positive('الكمية أكبر من الصفر'),
          /** The batch sent; left out, the earliest expiry goes first */
          batchNo: optionalText(40, 'رقم الدفعة طويل'),
          expiryDate: isoDateSchema.nullable().optional(),
          /** The pieces' serial numbers, one per piece, for a product that tracks them */
          serials: z.array(serialSchema).max(1000).optional(),
        }),
      )
      .min(1, 'أضف صنفاً واحداً على الأقل')
      .max(2000),
  })
  .refine((t) => t.fromBranchId !== t.toBranchId, { path: ['toBranchId'], message: 'اختر فرعاً آخر' });
export type TransferInput = z.input<typeof transferInput>;

/**
 * Round 37, decision 16: a transfer is «بالطريق» (in transit) or instant.
 *   in_transit  the goods left the sender; the receiving branch has not confirmed them yet
 *   received    the goods are in the receiver (every older transfer, and an instant one, is this)
 *   cancelled   round 44: the sender cancelled it on the way and the goods came back to it
 */
export type TransferStatus = 'in_transit' | 'received' | 'cancelled';

/** How a store sends goods between its branches. auto: in transit when the store has more than one branch. */
export const TRANSFER_MODES = ['auto', 'instant', 'transit'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

/**
 *   GET /v1/transfers/settings   inventory.adjust   → TransferSettings
 *   PUT /v1/transfers/settings   settings.manage    transferSettingsInput → TransferSettings
 */
export const transferSettingsInput = z.object({ mode: z.enum(TRANSFER_MODES) });
export type TransferSettingsInput = z.input<typeof transferSettingsInput>;
export interface TransferSettings {
  mode: TransferMode;
  /** What a new transfer does now: auto resolved against the store's branches */
  effective: 'instant' | 'transit';
}

export interface TransferDetail {
  id: string;
  number: string;
  date: string;
  fromBranchId: string;
  toBranchId: string;
  lines: { variantId: string; name: string; qty: number; valueMinor: number; serials?: string[] }[];
  valueMinor: number;
  baseCurrency: CurrencyCode;
  /** Absent: received (an answer from before round 37) */
  status?: TransferStatus;
}

export interface TransferRow {
  id: string;
  number: string;
  date: string;
  fromBranch: string;
  toBranch: string;
  pieces: number;
  valueMinor: number;
  /** Absent: received */
  status?: TransferStatus;
  fromBranchId?: string;
  toBranchId?: string;
  /** Pieces that did not arrive (thousandths), when the receiver confirmed less than was sent */
  shortPieces?: number;
  /** Round 44: this user may confirm / cancel it (the right is per branch); absent from older servers */
  canReceive?: boolean;
  canCancel?: boolean;
}

/**
 *   GET /v1/transfers?limit&cursor   inventory.adjust   → { items, nextCursor?, inTransit? }
 * Every transfer still on the way is always in the list (on the first page); the rest are paged newest first.
 */
export const transferListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(80).optional(),
});
export interface TransferListResponse {
  items: TransferRow[];
  nextCursor?: string | null;
  /** How many are on the way now (all of them, not only this page) */
  inTransit?: number;
}

/**
 *   POST /v1/transfers/:id/cancel   inventory.adjust (at the sending branch)   transferCancelInput → TransferFull
 * A transfer still on the way is cancelled by the sender: the goods come back to it at the value they left with.
 */
export const transferCancelInput = z.object({
  date: isoDateSchema.optional(),
  reason: optionalText(200, 'السبب طويل'),
});
export type TransferCancelInput = z.input<typeof transferCancelInput>;

/**
 *   POST /v1/transfers/:id/receive   inventory.adjust (at the receiving branch)   transferReceiveInput → TransferFull
 *   GET  /v1/transfers/:id           inventory.adjust   → TransferFull
 *
 * The receiving branch confirms what arrived. Left out, `lines` means everything arrived. A line that arrived
 * short is written off through a stocktake, so a reason is required; more than was sent is refused (count
 * the surplus as a stocktake).
 */
export const transferReceiveInput = z.object({
  date: isoDateSchema.optional(),
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        receivedQty: z.int().min(0, 'الكمية لا تكون أقل من الصفر'),
        /** The serial numbers that arrived, for a product that tracks them */
        serials: z.array(serialSchema).max(1000).optional(),
      }),
    )
    .max(2000)
    .optional(),
  reason: optionalText(200, 'السبب طويل'),
});
export type TransferReceiveInput = z.input<typeof transferReceiveInput>;

export interface TransferFullLine {
  variantId: string;
  name: string;
  /** Sent, then what arrived (null while in transit) and what is short */
  qty: number;
  valueMinor: number;
  receivedQty: number | null;
  shortQty: number;
  serials?: string[];
}

export interface TransferFull {
  id: string;
  number: string;
  date: string;
  fromBranchId: string;
  toBranchId: string;
  fromBranch: string;
  toBranch: string;
  status: TransferStatus;
  note: string | null;
  lines: TransferFullLine[];
  valueMinor: number;
  baseCurrency: CurrencyCode;
  receipt: null | {
    date: string;
    shortPieces: number;
    shortValueMinor: number;
    reason: string | null;
    /** The stocktake that wrote the shortage off, when there was one */
    stocktakeNumber: string | null;
  };
}

// ─── Returns to the supplier (09 › purchase returns) ──────────────────────────

/**
 *   GET  /v1/supplier-returns   purchases.manage   → { items: SupplierReturnRow[] }
 *   POST /v1/supplier-returns   purchases.manage   supplierReturnInput → SupplierReturnDetail (201)
 *
 * Pieces sent back to their supplier (a fault, a wrong size, what did not sell): out of the branch
 * at its average cost, and the supplier owes the store what it credits for them, off its balance
 * (credit) or paid back in cash or by bank. What the supplier credits above or below the pieces'
 * cost goes to cost of sales: Dr 2100 (or the cash or bank) / Cr 1300 / ±5100.
 */
export const supplierReturnInput = z
  .object({
    /** Round 44: the document's own id, made by the form when it opens. The same id again answers the document already made and posts nothing twice (a retry after a dropped connection) */
    id: uuidSchema.optional(),
    supplierId: uuidSchema,
    branchId: uuidSchema.optional(),
    date: isoDateSchema,
    refund: z.enum(PURCHASE_PAYMENTS),
    /**
     * Round 36 (decision 13): the purchase invoice the pieces came on. The supplier then credits each line at
     * that invoice's cost (a dollar invoice, in dollars at its rate) instead of at the branch's average;
     * the stock still leaves at the current average and the difference goes to cost of sales (5100). Left
     * out, the return works as it always did.
     */
    purchaseId: uuidSchema.optional(),
    /** The supplier's credit note number */
    reference: optionalText(64, 'الرقم طويل'),
    note: optionalText(200, 'الملاحظة طويلة'),
    lines: z
      .array(
        z.object({
          variantId: uuidSchema,
          qty: z.int('الكمية مطلوبة').positive('الكمية أكبر من الصفر').max(1_000_000_000, 'الكمية كبيرة'),
          /**
           * What the supplier credits for the whole line; left out, the pieces' average cost, or their cost on
           * the invoice when `purchaseId` names one (then in the invoice's currency)
           */
          amountMinor: nonNegativeMinorSchema.nullable().optional(),
          /** The batch sent back; its balance goes down by `qty` (03 › الصيدليات). Left out: earliest expiry first */
          batchNo: optionalText(40, 'رقم الدفعة طويل'),
          expiryDate: isoDateSchema.nullable().optional(),
          /** The pieces' serial numbers, one per piece, for a product that tracks them */
          serials: z.array(serialSchema).max(1000).optional(),
        }),
      )
      .min(1, 'أضف صنفاً واحداً على الأقل')
      .max(500),
  })
  .refine((r) => new Set(r.lines.map(batchKey)).size === r.lines.length, {
    path: ['lines'],
    message: 'كل صنف مرة واحدة في المرتجع إلا إن اختلفت الدفعة',
  });
export type SupplierReturnInput = z.input<typeof supplierReturnInput>;

export interface SupplierReturnDetail {
  id: string;
  number: string;
  date: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  refund: PurchasePayment;
  reference: string | null;
  lines: {
    variantId: string;
    name: string;
    qty: number;
    amountMinor: number;
    costMinor: number;
    /** Round 36: the line's cost on the invoice named, base currency; absent without one */
    invoiceCostMinor?: number | null;
    /** On a dollar invoice, what the supplier credits for the line in dollars (cents) */
    foreignAmountMinor?: number | null;
    /** The batch the line took back, when it named one (so a later return against the invoice can count it) */
    batchNo?: string | null;
    expiryDate?: string | null;
  }[];
  /** What the supplier credits, base currency */
  amountMinor: number;
  /** Round 36: the invoice named, and on a dollar invoice the dollars credited at its rate */
  purchaseId?: string | null;
  purchaseNumber?: string | null;
  currency?: PurchaseCurrencyCode | null;
  rate?: string | null;
  foreignAmountMinor?: number | null;
  /** What the pieces cost, at the branch's average */
  costMinor: number;
  baseCurrency: CurrencyCode;
}

export interface SupplierReturnRow {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  refund: PurchasePayment;
  pieces: number;
  amountMinor: number;
}

// ─── Round 38: the count sheet (the phone's stocktake) and the waste report ────────────────────────

/** The sheet a phone downloads to count by: one branch, all of it or one category (with its sub-categories) */
export const countSheetQuery = z.object({
  branchId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
});

export interface CountSheetItem {
  variantId: string;
  name: string;
  categoryId: string | null;
  /** The pieces fraction is allowed (a weighed item); false: counted in whole pieces */
  allowsFraction: boolean;
  /** What the books say is on the shelf, thousandths (shown only after the count) */
  qty: number;
  /** Every barcode of the item, with the pieces one scan stands for (thousandths) */
  barcodes: { code: string; packQty: number }[];
}

export interface CountSheet {
  branchId: string;
  categoryId: string | null;
  /** When the server made it (ISO), so a draft says how old its books are */
  at: string;
  items: CountSheetItem[];
  categories: { id: string; name: string; parentId: string | null }[];
}

export const wasteReportQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export interface WasteRow {
  date: string;
  number: string;
  branchId: string;
  variantId: string;
  name: string;
  /** «بلا سبب» when the document never named one (an old waste) */
  reason: string;
  /** Thousandths that left the stock */
  qty: number;
  /** What it cost, minor units of the base currency (positive) */
  costMinor: number;
}

export interface WasteReport {
  from: string;
  to: string;
  rows: WasteRow[];
  byReason: { reason: string; qty: number; costMinor: number; count: number }[];
  byProduct: { variantId: string; name: string; qty: number; costMinor: number; count: number }[];
  totalCostMinor: number;
  baseCurrency: CurrencyCode;
  /** More lines matched than the 5000 returned: the totals cover those only (round 44) */
  truncated?: boolean;
}
