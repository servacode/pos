import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { phoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, positiveMinorSchema, uuidSchema } from './common';

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
  phone: z
    .union([z.literal('').transform(() => null), phoneSchema])
    .nullable()
    .optional(),
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
  .refine((p) => new Set(p.lines.map((l) => l.variantId)).size === p.lines.length, {
    path: ['lines'],
    message: 'كل صنف مرة واحدة في الفاتورة',
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

export const supplierPaymentInput = z.object({
  supplierId: uuidSchema,
  date: isoDateSchema,
  amountMinor: positiveMinorSchema,
  method: z.enum(['cash', 'bank']),
  note: optionalText(200, 'الملاحظة طويلة'),
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
export const expiryQuery = z.object({ days: z.coerce.number().int().min(1).max(730).default(90) });

/**
 * A batch on the shelf (03 › الصيدليات: الصلاحية). What is left of each receipt is an estimate:
 * the stock is taken from the newest receipts first, as the oldest sell first.
 */
export interface ExpiryRow {
  variantId: string;
  name: string;
  batchNo: string | null;
  expiryDate: string;
  purchaseNumber: string;
  receivedOn: string;
  /** What is left of the batch, base units, thousandths */
  qty: number;
  /** Days from today; negative when it has expired */
  daysLeft: number;
}

export interface ExpiryResponse {
  items: ExpiryRow[];
  today: string;
}

// ─── Serial numbers ───────────────────────────────────────────────────────────

/** GET /v1/serials?q= (catalog.manage): a piece by its number, or the last ones received */
export const serialQuery = z.object({ q: z.string().trim().max(40).optional() });

export interface SerialRow {
  serial: string;
  variantId: string;
  name: string;
  status: 'in_stock' | 'sold';
  purchaseNumber: string | null;
  receivedOn: string | null;
  saleNumber: string | null;
  soldOn: string | null;
  warrantyUntil: string | null;
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
      .array(z.object({ variantId: uuidSchema, qty: z.int().positive('الكمية أكبر من الصفر') }))
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
        }),
      )
      .min(1, 'أضف صنفاً واحداً على الأقل')
      .max(500),
  })
  .refine((r) => new Set(r.lines.map((l) => l.variantId)).size === r.lines.length, {
    path: ['lines'],
    message: 'كل صنف مرة واحدة في المرتجع',
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
