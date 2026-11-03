import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, uuidSchema } from './common';

/**
 * What sells and what sleeps (03 › الألبسة: المبيعات حسب المقاس واللون، والقطع الراكدة):
 *
 *   GET /v1/reports/merchandise?from&to[&branchId][&idleDays]   report.view → MerchandiseReport
 *
 * Sales by each option of the pieces (size, colour, …), net of what came back, the best-selling
 * models with their pieces, and the pieces on the shelf that have not sold nor arrived for
 * `idleDays`. Their cost shows to a user with «التكلفة» only.
 */
export const merchandiseQuery = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    branchId: uuidSchema.optional(),
    /** One department (رجالي، نسائي، ولادي) and its sub-categories */
    categoryId: uuidSchema.optional(),
    idleDays: z.coerce.number().int().min(7).max(365).default(60),
  })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'نهاية المدة قبل بدايتها' });

export interface OptionSales {
  value: string;
  /** Pieces sold, thousandths of the base unit */
  soldQty: number;
  returnedQty: number;
  /** Sales total, tax included, before the returns */
  totalMinor: number;
}

export interface MerchandiseReport {
  from: string;
  to: string;
  branchId: string | null;
  idleDays: number;
  /** The store's business date today, which `idleDays` counts back from */
  today: string;
  baseCurrency: CurrencyCode;
  /** One entry per option name («المقاس», «اللون»), its values in the order the pieces have them */
  byOption: { name: string; values: OptionSales[] }[];
  /** The best-selling models with more than one piece, and how each piece sold */
  models: {
    productId: string;
    name: string;
    soldQty: number;
    totalMinor: number;
    pieces: { variantId: string; label: string; soldQty: number; stockQty: number }[];
  }[];
  /** On the shelf, not sold and not received for `idleDays`, the oldest first */
  slowMovers: {
    variantId: string;
    productId: string;
    name: string;
    stockQty: number;
    /** At cost, for a user with «التكلفة»; null otherwise */
    valueMinor: number | null;
    lastSoldOn: string | null;
    lastReceivedOn: string | null;
  }[];
  /** What the slow pieces cost, together; null without «التكلفة» */
  slowValueMinor: number | null;
  /**
   * Each seller's sales in the period (03 › عمولة البائع): the salesperson named on the sale, else
   * its cashier; net of what came back from those sales. Not narrowed by category.
   */
  /**
   * Each department's sales in the period (رجالي، نسائي، ولادي: the top-level categories, each with
   * its sub-categories), net of what came back; categoryId null for goods with no category. Not
   * narrowed by category. The biggest first.
   */
  byDepartment: {
    categoryId: string | null;
    name: string;
    soldQty: number;
    totalMinor: number;
    returnedQty: number;
    returnedMinor: number;
  }[];
  bySeller: {
    userId: string;
    fullName: string;
    invoiceCount: number;
    totalMinor: number;
    returnedMinor: number;
  }[];
}
