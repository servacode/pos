import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { contactPhoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, positiveMinorSchema, uuidSchema } from './common';
import { chequeDetailsSchema } from './cheques';

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
  /** What the store owes the supplier, base currency */
  balanceMinor: number;
  archived: boolean;
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

export const purchaseLineInput = z.object({
  variantId: uuidSchema,
  /** Base units bought, thousandths (12.5 kg is 12500) */
  qty: z.int('الكمية مطلوبة').positive('الكمية أكبر من صفر').max(1_000_000_000, 'الكمية كبيرة'),
  /** What the line cost in all, base currency minor units */
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
    supplierId: uuidSchema,
    branchId: uuidSchema.optional(),
    date: isoDateSchema,
    payment: z.enum(PURCHASE_PAYMENTS),
    /** The supplier's invoice number */
    reference: optionalText(64, 'الرقم طويل'),
    notes: optionalText(500, 'الملاحظات طويلة'),
    lines: z.array(purchaseLineInput).min(1, 'أضف صنفاً واحداً على الأقل').max(500),
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
  costMinor: number;
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
  totalMinor: number;
}

export interface PurchaseDetail extends PurchaseRow {
  branchId: string;
  notes: string | null;
  lines: PurchaseLineRow[];
  baseCurrency: CurrencyCode;
}

export interface PurchaseListResponse {
  items: PurchaseRow[];
  baseCurrency: CurrencyCode;
}

export const purchaseListQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  supplierId: uuidSchema.optional(),
});

/** The largest single payment to a supplier, minor units (100 billion pounds): above it is a typing slip */
export const MAX_PAYMENT_MINOR = 10_000_000_000_000;

export const supplierPaymentInput = z.object({
  supplierId: uuidSchema,
  date: isoDateSchema,
  amountMinor: positiveMinorSchema.max(MAX_PAYMENT_MINOR, 'المبلغ كبير جداً. تحقّق من الأصفار'),
  method: z.enum(['cash', 'bank']),
  /** A payment by cheque goes out of the bank account; its bank, number and due date are kept with it */
  cheque: chequeDetailsSchema.optional(),
  note: optionalText(200, 'الملاحظة طويلة'),
  /** The owner confirmed the payment is more than what is owed: it stays as an advance with the supplier */
  advance: z.boolean().optional(),
});
export type SupplierPaymentInput = z.output<typeof supplierPaymentInput>;

export interface SupplierPaymentRow {
  id: string;
  number: string;
  supplierId: string;
  date: string;
  amountMinor: number;
  method: 'cash' | 'bank';
}

export const inventoryQuery = z.object({ branchId: uuidSchema.optional() });

export interface InventoryRow {
  variantId: string;
  name: string;
  branchId: string;
  /** Base units, thousandths */
  qty: number;
  valueMinor: number;
  /** For display: value of one base unit, four decimals of the minor unit at most */
  unitCostMinor: number | null;
}

export interface InventoryResponse {
  items: InventoryRow[];
  totalValueMinor: number;
  baseCurrency: CurrencyCode;
}

export const stocktakeInput = z.object({
  branchId: uuidSchema.optional(),
  date: isoDateSchema,
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
}

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

/** Batches still on the shelf that end within `days` (90 by default), or already have. */
export const expiryQuery = z.object({
  days: z.coerce.number().int().min(1).max(730).default(90),
  /** One item's batches, whatever their dates (the supplier return and the count pick from them) */
  variantId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
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
});
export type SerialFixInput = z.input<typeof serialFixInput>;

/**
 * `serials` pulled to the tills (03 › الإلكترونيات): the branch's in-stock pieces of products that
 * track them, and those sold lately, so the till refuses a number that is not in stock.
 */
export interface SerialStockRow {
  id: string;
  variantId: string;
  serial: string;
  /** rented: out with a customer on a rental (03 › الأدوات الطبية: التأجير), not for sale */
  status: 'in_stock' | 'sold' | 'rented' | 'returned';
  /** The invoice that sold it, for «هذا الرقم مباع في الفاتورة …» */
  saleNumber: string | null;
  version: number;
}

export interface SerialRow {
  serial: string;
  variantId: string;
  name: string;
  status: 'in_stock' | 'sold' | 'rented' | 'returned';
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

export interface TransferDetail {
  id: string;
  number: string;
  date: string;
  fromBranchId: string;
  toBranchId: string;
  lines: { variantId: string; name: string; qty: number; valueMinor: number }[];
  valueMinor: number;
  baseCurrency: CurrencyCode;
}

export interface TransferRow {
  id: string;
  number: string;
  date: string;
  fromBranch: string;
  toBranch: string;
  pieces: number;
  valueMinor: number;
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
    supplierId: uuidSchema,
    branchId: uuidSchema.optional(),
    date: isoDateSchema,
    refund: z.enum(PURCHASE_PAYMENTS),
    /** The supplier's credit note number */
    reference: optionalText(64, 'الرقم طويل'),
    note: optionalText(200, 'الملاحظة طويلة'),
    lines: z
      .array(
        z.object({
          variantId: uuidSchema,
          qty: z.int('الكمية مطلوبة').positive('الكمية أكبر من الصفر').max(1_000_000_000, 'الكمية كبيرة'),
          /** What the supplier credits for the whole line; left out, the pieces' average cost */
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
  lines: { variantId: string; name: string; qty: number; amountMinor: number; costMinor: number }[];
  /** What the supplier credits */
  amountMinor: number;
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
