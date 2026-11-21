import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { phoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, versionSchema } from './common';

/**
 * Alteration tickets (03 › الألبسة: التعديل والتقصير): a piece left at the till to be shortened or
 * altered, with its number on a slip for the customer, the work, the fee and the day it is ready;
 * followed until it is collected. The fee is sold at the till as any service when the piece is
 * collected (a «تقصير» product), so a ticket posts nothing itself.
 *
 *   GET  /v1/device/alterations?status=open|all       → { items: AlterationTicket[] }
 *   POST /v1/device/alterations                        alterationInput → AlterationTicket (201)
 *   POST /v1/device/alterations/{id}/status            alterationStatusInput → AlterationTicket
 *   (all with Authorization: Device; the till needs the server for them)
 */

export const ALTERATION_STATUSES = ['received', 'ready', 'delivered'] as const;
export type AlterationStatus = (typeof ALTERATION_STATUSES)[number];

export const alterationInput = z
  .object({
    customerName: z.string().trim().min(1, 'اكتب اسم الزبون').max(80),
    phone: phoneSchema,
    /** «بنطال جينز أسود» */
    item: z.string().trim().min(1, 'اكتب القطعة').max(120),
    /** «تقصير 3 سم» */
    work: z.string().trim().min(1, 'اكتب المطلوب').max(200),
    priceMinor: nonNegativeMinorSchema,
    dueDate: isoDateSchema,
    note: z.string().trim().max(300).nullable().optional(),
    /** A deposit taken now, as a gift voucher (its code) that pays part of the fee at delivery */
    depositMinor: nonNegativeMinorSchema.default(0),
    depositVoucher: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((t) => t.depositMinor <= t.priceMinor, {
    path: ['depositMinor'],
    message: 'العربون أكبر من الأجرة',
  })
  .refine((t) => t.depositMinor === 0 || Boolean(t.depositVoucher), {
    path: ['depositVoucher'],
    message: 'العربون يحتاج قسيمته',
  });
export type AlterationInput = z.input<typeof alterationInput>;

export const alterationStatusInput = z.object({
  status: z.enum(['ready', 'delivered']),
  version: versionSchema,
});

export const alterationListQuery = z.object({
  status: z.enum(['open', 'all']).default('open'),
});

export interface AlterationTicket {
  id: string;
  number: string;
  status: AlterationStatus;
  customerName: string;
  phone: string;
  item: string;
  work: string;
  currency: CurrencyCode;
  priceMinor: number;
  dueDate: string;
  note: string | null;
  /** What was paid as a deposit and the voucher it was taken on (spent at delivery); 0 and null for none */
  depositMinor: number;
  depositVoucher: string | null;
  createdAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
  version: number;
}
