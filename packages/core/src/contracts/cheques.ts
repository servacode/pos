import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Cheques (03 › الجملة: الآجل والشيكات): a sale or a customer's payment taken by cheque waits in
 * 1160 «شيكات تحت التحصيل» under its customer. The owner marks it once: cashed (Dr 1130 البنك, Cr
 * 1160) or bounced (Dr 1200, the customer owes it again, Cr 1160).
 *
 *   GET  /v1/cheques?status=        customers.view    → { items: Cheque[]; baseCurrency }
 *   POST /v1/cheques/actions        customers.manage  chequeActionInput → Cheque
 */

export const CHEQUE_STATUSES = ['pending', 'cleared', 'bounced'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

export const CHEQUE_SOURCES = ['sale', 'receipt'] as const;
export type ChequeSource = (typeof CHEQUE_SOURCES)[number];

/**
 * A cheque's details as the till takes them (and a payment to a supplier): the bank, the cheque's
 * number, the day it falls due and, when it is not the customer's own, whose cheque it is.
 */
export const chequeDetailsSchema = z.object({
  bank: z.string().trim().min(1).max(60),
  number: z.string().trim().min(1).max(40),
  dueDate: isoDateSchema,
  drawer: z.string().trim().min(1).max(80).nullable().optional(),
});
export type ChequeDetails = z.output<typeof chequeDetailsSchema>;

/** The reference line a cheque's details make: «بنك سورية · 000123 · 2026-12-01» */
export function chequeReference(d: Pick<ChequeDetails, 'bank' | 'number' | 'dueDate'>): string {
  return `${d.bank} · ${d.number} · ${d.dueDate}`.slice(0, 64);
}

/** A cheque falling due within this many days is on the owner's attention list */
export const CHEQUE_DUE_SOON_DAYS = 7;

export const chequeListQuery = z.object({ status: z.enum(CHEQUE_STATUSES).optional() });

export const chequeActionInput = z.object({
  sourceType: z.enum(CHEQUE_SOURCES),
  sourceId: uuidSchema,
  paymentNo: z.int().min(1),
  action: z.enum(['cleared', 'bounced']),
  /** The day the bank cashed or returned it: the entry's date */
  date: isoDateSchema,
  note: z.string().trim().max(200).nullable().optional(),
});
export type ChequeActionInput = z.input<typeof chequeActionInput>;

export interface Cheque {
  sourceType: ChequeSource | 'supplier_payment';
  sourceId: string;
  paymentNo: number;
  /** The invoice or receipt number */
  documentNumber: string;
  /** The day it was taken */
  date: string;
  customerId: string | null;
  customerName: string | null;
  /** The cheque's number as the cashier typed it */
  reference: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  status: ChequeStatus;
  actionDate: string | null;
  note: string | null;
  /** «وارد» (taken from a customer) or «صادر» (given to a supplier); the latter are only listed */
  direction?: 'in' | 'out';
  /** The bank, the due day and the drawer as structured; null on a cheque typed as free text */
  bank?: string | null;
  dueDate?: string | null;
  drawer?: string | null;
  /** The supplier an outgoing cheque was given to */
  supplierName?: string | null;
}
