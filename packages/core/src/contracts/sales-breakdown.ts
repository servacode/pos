import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, uuidSchema } from './common';

/**
 * «تقرير المبيعات» (report.view): what sold in a period, grouped by product, category, an option of
 * the pieces (المقاس، اللون…) or seller, each row against the period of the same length just before.
 *
 *   GET /v1/reports/sales-breakdown?from&to&by[&option][&branchId]   SalesBreakdown
 *
 * Net of what came back. A seller's row is the base of a commission; the rate is not kept in the
 * system, so no commission amount is computed here.
 */
export const SALES_GROUPS = ['product', 'category', 'option', 'seller'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];

export const SALES_GROUP_LABEL: Record<SalesGroup, string> = {
  product: 'المنتج',
  category: 'التصنيف',
  option: 'الخيار (المقاس، اللون…)',
  seller: 'البائع',
};

export const salesBreakdownQuery = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    by: z.enum(SALES_GROUPS, 'اختر التجميع'),
    /** For `by=option`: «المقاس» or «اللون» */
    option: z.string().trim().min(1).max(60).optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'نهاية المدة قبل بدايتها' })
  .refine((q) => q.by !== 'option' || !!q.option, { path: ['option'], message: 'اختر الخيار' });

export interface SalesBreakdownRow {
  key: string;
  name: string;
  /** Pieces sold less pieces returned, thousandths of the base unit */
  qty: number;
  /** Sales total less returns, tax included, base currency */
  totalMinor: number;
  returnedMinor: number;
  invoiceCount: number;
  /** The same row in the previous period; zero when it did not sell then */
  previousQty: number;
  previousTotalMinor: number;
}

export interface SalesBreakdown {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  by: SalesGroup;
  option: string | null;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  rows: SalesBreakdownRow[];
  totalMinor: number;
  previousTotalMinor: number;
  /** The option names the store's pieces have, for the picker of `by=option` */
  optionNames: string[];
}
