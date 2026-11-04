import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { phoneSchema } from './auth';
import { isoDateSchema, nonNegativeMinorSchema, uuidSchema } from './common';

/**
 * Customers and what they owe (09 › customers، party_balances; 10 › الذمم): the owner adds and
 * edits them, every till pulls them (to sell on credit and to take a payment), and a till may
 * add one while offline (the `customer` document). A balance is never stored: it is the sum of
 * the journal lines of 1200 that name the customer.
 *
 *   GET  /v1/customers?q=          CustomerListResponse   (customer.view)
 *   POST /v1/customers             customerInput → CustomerDetail (customer.manage)
 *   PUT  /v1/customers/{id}        customerInput → CustomerDetail (customer.manage)
 *   GET  /v1/customers/{id}        CustomerDetail with its statement (customer.view)
 */

/** Which price a customer buys at */
export const PRICE_TIERS = ['retail', 'wholesale'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const customerInput = z.object({
  name: z.string('اسم الزبون مطلوب').trim().min(2, 'اكتب اسم الزبون').max(120, 'الاسم طويل'),
  phone: z
    .union([z.literal('').transform(() => null), phoneSchema])
    .nullable()
    .optional(),
  taxNumber: optionalText(40, 'الرقم الضريبي طويل'),
  address: optionalText(200, 'العنوان طويل'),
  notes: optionalText(500, 'الملاحظات طويلة'),
  /** Most the customer may owe, in the base currency; null is no limit */
  creditLimitMinor: nonNegativeMinorSchema.nullable().optional(),
  /** «زبون جملة»: the till sells to them at the wholesale price (03 › الجملة) */
  priceTier: z.enum(PRICE_TIERS).optional(),
  /** «لا يريد رسائل»: left out of every message to customers */
  noMessages: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type CustomerInput = z.output<typeof customerInput>;

export const customerListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  /** Only those who owe something */
  owing: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** `customers` pull set: what a till needs to find a customer and sell to them on credit */
export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  creditLimitMinor: number | null;
  priceTier: PriceTier;
  /** «نقاط الولاء» earned and not yet spent, as the server last counted them */
  loyaltyPoints: number;
  archived: boolean;
  version: number;
}

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  creditLimitMinor: number | null;
  /** What the customer owes the store, base currency (negative: the store owes them) */
  balanceMinor: number;
  priceTier: PriceTier;
  noMessages: boolean;
  archived: boolean;
}

export interface CustomerListResponse {
  items: CustomerListItem[];
  /** Sum of every positive balance */
  totalOwedMinor: number;
  baseCurrency: CurrencyCode;
}

export interface StatementLine {
  date: string;
  /** sale, return, receipt, … */
  sourceType: string;
  sourceId: string;
  number: string | null;
  memo: string;
  /** What the customer came to owe (debit) or paid (credit), base currency */
  debitMinor: number;
  creditMinor: number;
  /** After this line */
  balanceMinor: number;
}

export interface CustomerDetail extends CustomerListItem {
  taxNumber: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  statement: StatementLine[];
  baseCurrency: CurrencyCode;
}

export const statementQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ─── Documents a till sends ──────────────────────────────────────────────────

/** `customer`: a customer the cashier added on the till; its id is the document's */
export const customerPayloadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20).nullable(),
  createdBy: uuidSchema,
});
export type CustomerPayload = z.output<typeof customerPayloadSchema>;

// ─── What a customer bought (03 › الألبسة: سجل الزبون ومقاسه) ─────────────────

/**
 *   GET /v1/customers/{id}/purchases           customers.view          → CustomerPurchases
 *   GET /v1/device/customers/{id}/purchases    (Authorization: Device) → CustomerPurchases
 *
 * The sizes a customer buys most, and the latest invoices with their lines and what came back:
 * the cashier advises («ريم تلبس M») and finds a sale to exchange without its receipt.
 */
export interface CustomerPurchases {
  customerId: string;
  /** Per option other than colour (المقاس، النمرة، العمر…), the values bought most, the most first */
  sizes: { name: string; values: { value: string; qty: number }[] }[];
  /** The latest 20 invoices, newest first */
  invoices: {
    id: string;
    number: string;
    date: string;
    totalMinor: number;
    currency: CurrencyCode;
    lines: { name: string; qty: number; totalMinor: number; returnedQty: number }[];
  }[];
  /** Pieces bought in all, and what they came to, net of returns */
  pieces: number;
  spentMinor: number;
}
