import { z } from 'zod';
import { isoDateSchema, listPageQuery, uuidSchema } from './common';
import type { CurrencyCode } from '../currencies';
import { PAYMENT_METHODS, type PaymentMethod, type SalePayload } from './documents';

/**
 * The store-wide invoice list (الفواتير), read-only, from the sales the tills synced:
 *
 * - GET /v1/sales        report.view (in the branches the role holds it)  → SaleListPage
 * - GET /v1/sales/{id}   report.view                                       → SaleDetail
 *
 * A sale is never edited nor voided once it is stored: the only way back is a return (RET), so the
 * status is derived from the returns that name the sale.
 */

export const SALE_STATUSES = ['paid', 'partly_returned', 'returned'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

const optionalMinor = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const saleListQuery = z
  .object({
    /** Business dates, inclusive */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    branchId: uuidSchema.optional(),
    deviceId: uuidSchema.optional(),
    cashierId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    status: z.enum(SALE_STATUSES).optional(),
    /** The invoice total, in minor units of the invoice's currency */
    minTotal: optionalMinor.optional(),
    maxTotal: optionalMinor.optional(),
    /** Part of the invoice number, or of the customer's name */
    q: z.string().trim().max(60).optional(),
    ...listPageQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'to is before from' })
  .refine((q) => q.minTotal === undefined || q.maxTotal === undefined || q.minTotal <= q.maxTotal, {
    path: ['maxTotal'],
    message: 'maxTotal is below minTotal',
  });

export interface SaleListItem {
  id: string;
  /** INV number */
  number: string;
  branchId: string;
  branchName: string;
  deviceId: string;
  deviceCode: string | null;
  businessDate: string;
  deviceTime: string;
  cashier: { id: string; fullName: string | null };
  customer: { id: string | null; name: string } | null;
  currency: CurrencyCode;
  totalMinor: number;
  discountMinor: number;
  taxMinor: number;
  methods: PaymentMethod[];
  /** What returns gave back, in the invoice's currency */
  returnedMinor: number;
  status: SaleStatus;
}

export interface SaleListPage {
  items: SaleListItem[];
  nextCursor: string | null;
}

export interface SaleReturnRef {
  id: string;
  number: string;
  businessDate: string;
  deviceTime: string;
  totalMinor: number;
  reason: string;
  refundMethod: string | null;
}

/** One sale with everything its receipt needs to be printed again, as the till printed it. */
export interface SaleDetail extends SaleListItem {
  /** The saved sale document: lines, discounts, tax, payments, change, rates */
  payload: SalePayload;
  salesperson: { id: string; fullName: string | null } | null;
  device: { id: string; name: string; code: string | null };
  flags: string[];
  returns: SaleReturnRef[];
  /** The store's side of the receipt: name, tax number, footer, branch details */
  receipt: {
    storeName: string;
    taxNumber: string | null;
    receiptFooter: string | null;
    branchName: string;
    branchAddress: string | null;
    branchPhone: string | null;
    deviceName: string;
    cashierName: string;
  };
}
