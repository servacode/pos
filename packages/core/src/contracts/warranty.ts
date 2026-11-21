import { z } from 'zod';
import { isoDateSchema, versionSchema } from './common';

/**
 * Warranty and maintenance claims (03 › الإلكترونيات والأدوات الطبية): a piece sold by its serial
 * number or IMEI that comes back for a fault. The serial gives its sale, its customer and the end of
 * its warranty; the claim is followed from received, to sent (to the supplier or a workshop), to
 * ready, to delivered, each step with its day and note. A claim posts nothing and moves no stock.
 *
 *   GET  /v1/warranty/lookup?serial=        → WarrantyLookup (catalog.manage); 404 for an unknown number
 *   GET  /v1/warranty/claims?status=open|all → { items: WarrantyClaim[] }
 *   POST /v1/warranty/claims                warrantyClaimInput → WarrantyClaim (201)
 *   POST /v1/warranty/claims/{id}/status    warrantyStatusInput → WarrantyClaim
 */

export const WARRANTY_STATUSES = ['received', 'sent', 'ready', 'delivered'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const WARRANTY_STATUS_LABELS: Record<WarrantyStatus, string> = {
  received: 'مستلم',
  sent: 'عند المورد أو الصيانة',
  ready: 'جاهز',
  delivered: 'سُلّم للزبون',
};

/** Where each status may go next: a claim never goes back */
export const WARRANTY_NEXT: Record<WarrantyStatus, readonly WarrantyStatus[]> = {
  received: ['sent', 'ready', 'delivered'],
  sent: ['ready', 'delivered'],
  ready: ['delivered'],
  delivered: [],
};

export const warrantyLookupQuery = z.object({
  serial: z.string().trim().min(3, 'اكتب الرقم التسلسلي').max(40),
});

/** The repair's own details, set when the claim opens or at any step */
const repairDetails = {
  /** What the repair cost the store, base currency minor units */
  costMinor: z.int().nonnegative().nullable().optional(),
  technician: z.string().trim().max(80).nullable().optional(),
  /** The unit lent to the customer meanwhile */
  loanItem: z.string().trim().max(120).nullable().optional(),
  /** A repair after the warranty, charged by a till sale of a «صيانة» line */
  paidRepair: z.boolean().optional(),
  repairSaleNumber: z.string().trim().max(40).nullable().optional(),
};

export const warrantyClaimInput = z.object({
  ...repairDetails,
  serial: z.string().trim().min(3, 'اكتب الرقم التسلسلي').max(40),
  /** «الشاشة لا تعمل» */
  issue: z.string().trim().min(1, 'اكتب العطل').max(300),
  /** The day it came back; today when left out */
  receivedOn: isoDateSchema.optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
export type WarrantyClaimInput = z.input<typeof warrantyClaimInput>;

export const warrantyStatusInput = z
  .object({
    status: z.enum(['sent', 'ready', 'delivered']),
    version: versionSchema,
    /** The day of this step; today when left out */
    on: isoDateSchema.optional(),
    note: z.string().trim().max(300).nullable().optional(),
    /** The supplier or workshop it was sent to (with status `sent`) */
    sentTo: z.string().trim().max(120).nullable().optional(),
    ...repairDetails,
  })
  .refine((s) => s.status !== 'sent' || Boolean(s.sentTo), {
    path: ['sentTo'],
    message: 'اكتب المورد أو الورشة التي أُرسلت إليها',
  });
export type WarrantyStatusInput = z.input<typeof warrantyStatusInput>;

export const warrantyListQuery = z.object({
  status: z.enum(['open', 'all']).default('open'),
});

export interface WarrantyEvent {
  status: WarrantyStatus;
  on: string;
  note: string | null;
}

export interface WarrantyClaim {
  id: string;
  number: string;
  status: WarrantyStatus;
  serial: string;
  item: string;
  saleNumber: string | null;
  soldOn: string | null;
  warrantyUntil: string | null;
  /** The warranty still ran on the day the piece came back */
  underWarranty: boolean;
  customerName: string | null;
  customerPhone: string | null;
  issue: string;
  sentTo: string | null;
  costMinor: number | null;
  technician: string | null;
  loanItem: string | null;
  paidRepair: boolean;
  repairSaleNumber: string | null;
  events: WarrantyEvent[];
  createdAt: string;
  version: number;
}

/** A serial with the sale it left on, as the claim desk sees it */
export interface WarrantyLookup {
  serial: string;
  item: string;
  saleNumber: string;
  soldOn: string;
  warrantyUntil: string | null;
  /** The warranty runs today */
  underWarranty: boolean;
  customerName: string | null;
  customerPhone: string | null;
  claims: WarrantyClaim[];
}

/**
 * The day a warranty of `months` from `date` ends: the same day of the month `months` later, or the
 * last day of that month when it has no such day (the database does the same): 2026-01-31 + 1 →
 * 2026-02-28. The till shows it on the receipt, so it must match what the server stores.
 */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** «2027-10-30» as «30/10/2027» */
export function dmy(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** «الكفالة حتى 30/10/2027»: the line a receipt and a warranty slip carry */
export const warrantyUntilText = (until: string): string => `الكفالة حتى ${dmy(until)}`;

/** What a serial number is called: «IMEI» for phones (electronics), «الرقم التسلسلي» elsewhere */
export function serialLabel(sectors: readonly string[] | undefined): string {
  return sectors?.includes('electronics') ? 'IMEI' : 'الرقم التسلسلي';
}
