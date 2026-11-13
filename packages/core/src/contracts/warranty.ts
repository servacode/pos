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

export const warrantyClaimInput = z.object({
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
