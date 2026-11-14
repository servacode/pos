import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { priceInvoice, type Discount, type PricedInvoice } from '../pricing';
import {
  bpSchema,
  isoDateSchema,
  nonNegativeMinorSchema,
  qtySchema,
  uuidSchema,
  versionSchema,
} from './common';

/**
 * «عروض الأسعار» (03 › الجملة: عرض السعر): a price offer to a customer, numbered per store and year
 * (QUO-2026-000001), with its lines, a validity date, notes and terms. It is not a financial
 * document: nothing posts and no stock moves. «حوّل إلى فاتورة» opens the till's cart with its lines;
 * the sale itself is the till's ordinary sale document.
 *
 *   GET  /v1/quotations?status=&q=             customers.manage → { items: QuotationListItem[] }
 *   GET  /v1/quotations/{id}                   customers.manage → Quotation
 *   POST /v1/quotations                        quotationInput → Quotation (201)
 *   PUT  /v1/quotations/{id}                   quotationUpdateInput → Quotation
 *   POST /v1/quotations/{id}/status            quotationStatusInput → Quotation
 *   GET  /v1/device/quotations                 → { items: Quotation[] } (open ones, for the till)
 *   GET  /v1/device/quotations/{id}            → Quotation
 *   POST /v1/device/quotations                 quotationInput → Quotation (201, status sent)
 *   POST /v1/device/quotations/{id}/convert    { version } → Quotation (status converted)
 *   (the device routes use Authorization: Device; the till needs the server for them)
 */

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'مسودة',
  sent: 'أُرسل للزبون',
  accepted: 'مقبول',
  expired: 'منتهي',
  converted: 'حُوّل إلى فاتورة',
};

/** Where each status may go by hand: «منتهي» comes by itself when the validity date passes */
export const QUOTATION_NEXT: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ['sent', 'accepted', 'expired', 'converted'],
  sent: ['draft', 'accepted', 'expired', 'converted'],
  accepted: ['sent', 'expired', 'converted'],
  expired: ['sent'],
  converted: ['sent'],
};

/** Days a quotation stands when no date is chosen */
export const QUOTATION_DEFAULT_DAYS = 15;

const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), bp: bpSchema }),
  z.object({ type: z.literal('amount'), minor: nonNegativeMinorSchema }),
]);

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const quotationLineInput = z.object({
  productId: uuidSchema.nullable().default(null),
  variantId: uuidSchema.nullable().default(null),
  name: z.string().trim().min(1, 'اكتب اسم الصنف').max(200),
  unitName: z.string().trim().min(1).max(20).nullable().default(null),
  /** «علبة 100»; null for a piece */
  packName: z.string().trim().min(1).max(40).nullable().default(null),
  /** Base units in one pack, thousandths (1000 = one piece) */
  packQty: qtySchema.default(1000),
  /** Packs, thousandths */
  qty: qtySchema,
  /** One pack, in the quotation's currency */
  unitPriceMinor: nonNegativeMinorSchema,
  discount: discountSchema.nullable().default(null),
  taxRateId: uuidSchema.nullable().default(null),
  taxRateBp: bpSchema.default(0),
});
export type QuotationLineInput = z.input<typeof quotationLineInput>;
export type QuotationLineData = z.output<typeof quotationLineInput>;

const quotationFields = {
  /** The status a new quotation starts in (the admin's default is a draft, the till's is sent); ignored when editing */
  status: z.enum(['draft', 'sent']).optional(),
  customerId: uuidSchema.nullable().optional(),
  customerName: optionalText(120),
  customerPhone: optionalText(40),
  customerTaxNumber: optionalText(40),
  customerAddress: optionalText(200),
  /** The last day the prices stand; 15 days from today when left out */
  validUntil: isoDateSchema.optional(),
  notes: optionalText(1000),
  terms: optionalText(2000),
  invoiceDiscount: discountSchema.nullable().optional(),
  lines: z.array(quotationLineInput).min(1, 'أضف صنفاً واحداً على الأقل').max(500),
};

export const quotationInput = z.object(quotationFields);
export type QuotationInput = z.input<typeof quotationInput>;
export type QuotationData = z.output<typeof quotationInput>;

export const quotationUpdateInput = z.object({ ...quotationFields, version: versionSchema });
export type QuotationUpdateInput = z.input<typeof quotationUpdateInput>;

export const quotationStatusInput = z.object({
  status: z.enum(QUOTATION_STATUSES),
  version: versionSchema,
});

export const quotationConvertInput = z.object({ version: versionSchema });

export const quotationListQuery = z.object({
  /** open: waiting for an answer (not expired, not converted) */
  status: z.enum(['open', 'all', ...QUOTATION_STATUSES]).default('all'),
  q: z.string().trim().max(60).optional(),
});

export interface QuotationLinePriced {
  grossMinor: number;
  lineDiscountMinor: number;
  netMinor: number;
  taxMinor: number;
  netExTaxMinor: number;
  totalMinor: number;
}

export interface QuotationLine extends Omit<QuotationLineData, 'discount'> {
  lineNo: number;
  discount: QuotationLineData['discount'];
  priced: QuotationLinePriced;
}

export interface QuotationTotals {
  grossMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountMinor: number;
  discountMinor: number;
  netExTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface QuotationListItem {
  id: string;
  number: string;
  /** What the quotation is today: «منتهي» once its date has passed while it waited */
  status: QuotationStatus;
  customerName: string | null;
  issueDate: string;
  validUntil: string;
  currency: CurrencyCode;
  totalMinor: number;
  version: number;
}

export interface Quotation extends QuotationListItem {
  customerId: string | null;
  customerPhone: string | null;
  customerTaxNumber: string | null;
  customerAddress: string | null;
  taxInclusive: boolean;
  notes: string | null;
  terms: string | null;
  lines: QuotationLine[];
  invoiceDiscount: QuotationData['invoiceDiscount'];
  totals: QuotationTotals;
  convertedAt: string | null;
  createdByName: string | null;
  branchName: string | null;
  createdAt: string;
}

/** What a quotation is today: a waiting one past its date reads «منتهي» */
export function effectiveQuotationStatus(
  stored: QuotationStatus,
  validUntil: string,
  today: string,
): QuotationStatus {
  const waiting = stored === 'draft' || stored === 'sent' || stored === 'accepted';
  return waiting && validUntil < today ? 'expired' : stored;
}

/** `days` after an ISO day, as an ISO day (calendar arithmetic in UTC, so no zone shifts it) */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const discountOf = (d: QuotationLineData['discount'] | undefined): Discount | undefined => d ?? undefined;

/**
 * Prices the lines with the till's own engine (pricing.ts › priceInvoice), so a quotation shows the
 * same totals the sale will. Throws RangeError for a discount larger than what it applies to.
 */
export function priceQuotation(
  lines: readonly QuotationLineData[],
  invoiceDiscount: QuotationData['invoiceDiscount'],
  taxInclusive: boolean,
): { lines: QuotationLine[]; totals: QuotationTotals } {
  const priced: PricedInvoice = priceInvoice({
    taxInclusive,
    ...(invoiceDiscount ? { invoiceDiscount } : {}),
    lines: lines.map((l, i) => {
      const discount = discountOf(l.discount);
      return {
        lineNo: i + 1,
        unitPriceMinor: l.unitPriceMinor,
        qty: l.qty,
        taxRateBp: l.taxRateBp,
        ...(discount ? { discount } : {}),
      };
    }),
  });
  const t = priced.totals;
  return {
    lines: lines.map((l, i) => {
      const p = priced.lines[i]!;
      return {
        ...l,
        lineNo: i + 1,
        priced: {
          grossMinor: p.grossMinor,
          lineDiscountMinor: p.lineDiscountMinor,
          netMinor: p.netMinor,
          taxMinor: p.taxMinor,
          netExTaxMinor: p.netExTaxMinor,
          totalMinor: p.totalMinor,
        },
      };
    }),
    totals: {
      grossMinor: t.grossMinor,
      lineDiscountMinor: t.lineDiscountMinor,
      invoiceDiscountMinor: t.invoiceDiscountMinor,
      discountMinor: t.discountMinor,
      netExTaxMinor: t.netExTaxMinor,
      taxMinor: t.taxMinor,
      totalMinor: t.totalMinor,
    },
  };
}
