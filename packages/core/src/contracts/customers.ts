import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { contactPhoneSchema } from './auth';
import {
  isoDateSchema,
  nonNegativeMinorSchema,
  positiveMinorSchema,
  shortTextSchema,
  uuidSchema,
} from './common';
import type { CustomerApproval } from './distribution';

/**
 * Customers and what they owe (09 › customers، party_balances; 10 › الذمم): the owner adds and
 * edits them, every till pulls them (to sell on credit and to take a payment), and a till may
 * add one while offline (the `customer` document). A balance is never stored: it is the sum of
 * the journal lines of 1200 that name the customer.
 *
 *   GET  /v1/customers?q=          CustomerListResponse   (customers.view)
 *   POST /v1/customers             customerInput → CustomerDetail (customers.manage)
 *   PUT  /v1/customers/{id}        customerInput → CustomerDetail (customers.manage)
 *   GET  /v1/customers/{id}        CustomerDetail with its statement (customers.view)
 */

/** Which price a customer buys at */
export const PRICE_TIERS = ['retail', 'wholesale'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

/**
 * What kind of customer: clinic, hospital, pharmacy, individual, government body; and the shops a
 * distributor sells to (grocery, mini-market, supermarket, restaurant, sub-wholesaler)
 */
export const CUSTOMER_KINDS = [
  'clinic',
  'hospital',
  'pharmacy',
  'individual',
  'government',
  'grocery',
  'minimarket',
  'supermarket',
  'restaurant',
  'sub_wholesaler',
] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];
export const CUSTOMER_KIND_LABELS: Record<CustomerKind, string> = {
  clinic: 'عيادة',
  hospital: 'مشفى',
  pharmacy: 'صيدلية',
  individual: 'فرد',
  government: 'جهة حكومية',
  grocery: 'بقالية',
  minimarket: 'ميني ماركت',
  supermarket: 'سوبرماركت',
  restaurant: 'مطعم',
  sub_wholesaler: 'جملة فرعي',
};

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
  phone: contactPhoneSchema,
  taxNumber: optionalText(40, 'الرقم الضريبي طويل'),
  address: optionalText(200, 'العنوان طويل'),
  notes: optionalText(500, 'الملاحظات طويلة'),
  /** Most the customer may owe, in the base currency; null is no limit */
  creditLimitMinor: nonNegativeMinorSchema.nullable().optional(),
  /** «زبون جملة»: the till sells to them at the wholesale price (03 › الجملة) */
  priceTier: z.enum(PRICE_TIERS).optional(),
  /** «لا يريد رسائل»: left out of every message to customers */
  noMessages: z.boolean().optional(),
  /** «نوع الزبون»; null clears it */
  kind: z.enum(CUSTOMER_KINDS).nullable().optional(),
  /** The person to ask for at a clinic, hospital or office, and their phone */
  contactName: optionalText(80, 'الاسم طويل'),
  contactPhone: optionalText(30, 'الرقم طويل'),
  /** «المنطقة» of the distribution module (regions); null clears it */
  regionId: uuidSchema.nullable().optional(),
  /** Where the shop is, for the rep's map; both or neither */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  archived: z.boolean().optional(),
  /** «المجموعة» (customer_groups); null clears it */
  groupId: uuidSchema.nullable().optional(),
  /** Birthday (YYYY-MM-DD; the year may be any); null clears it */
  birthDate: isoDateSchema.nullable().optional(),
  /** Another customer has this phone and the owner chose to save anyway */
  confirmDuplicate: z.boolean().optional(),
});
export type CustomerInput = z.output<typeof customerInput>;

export const customerListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  /** Only those who owe something */
  owing: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Only customers of one kind */
  kind: z.enum(CUSTOMER_KINDS).optional(),
  /** Only customers of one region */
  regionId: uuidSchema.optional(),
  /** Only customers with this approval: `pending` is the ones a rep added and the supervisor has not approved */
  approval: z.enum(['approved', 'pending', 'rejected']).optional(),
  /** One page of this many (balance high first), with the last purchase, spend and size of each; missing: every customer, as before but without those three */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** What the last page gave as `nextCursor` */
  cursor: z.string().max(64).optional(),
  /** Only those who bought before and not since this day: «لم يزر منذ 90 يوماً» */
  lastBefore: isoDateSchema.optional(),
  /** Order: balance (default, the most owing first), name, last purchase or spend; `dir` flips it */
  sort: z.enum(['balance', 'name', 'last', 'spent']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  /** Only customers of one group */
  groupId: uuidSchema.optional(),
  /** Only customers whose birthday is in this month (1-12) */
  birthMonth: z.coerce.number().int().min(1).max(12).optional(),
  /** With `limit`: name, phone and balance only; the last purchase, spend and size are left out. Alone: the best 50 */
  lite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Every customer of the filters in one answer (up to 50,000) for the Excel file: name, phone, balance, last purchase and spend; no totals */
  export: z
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
  /** Distribution: added by a rep and not approved yet means cash sales only; absent on older rows */
  approvalStatus?: CustomerApproval;
  regionId?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** grocery, supermarket…: what a trade promotion targets; absent on older rows */
  kind?: CustomerKind | null;
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
  kind: CustomerKind | null;
  contactName: string | null;
  contactPhone: string | null;
  /** Distribution (the server always sends these; optional so older fixtures stay valid) */
  regionId?: string | null;
  regionName?: string | null;
  /** approved, pending (a rep added it: cash only) or rejected */
  approvalStatus?: CustomerApproval;
  lat?: number | null;
  lng?: number | null;
  /** The list only: the day of the latest sale to this customer; null for none yet */
  lastPurchaseDate?: string | null;
  /** The list only: what they bought in all, net of returns, in the invoices' own money (as on their page) */
  spentMinor?: number;
  /** The list only: the size they bought most (colours are not sizes); null when none */
  favouriteSize?: string | null;
  /** Round 48: the group and its discount (hundredths of a percent), the birthday */
  groupId?: string | null;
  groupName?: string | null;
  groupDiscountBps?: number | null;
  birthDate?: string | null;
}

export interface CustomerListResponse {
  items: CustomerListItem[];
  /** Sum of every positive balance of the store (the search and «من عليه دين» do not narrow it) */
  totalOwedMinor: number;
  /** How many customers match the search and filters (all pages) */
  totalCount?: number;
  /** Customers of the kind/region/approval filters, and how many of them owe; every search leaves them out */
  allCount?: number;
  owingCount?: number;
  /** Customers a rep added that wait for approval, store-wide */
  pendingCount?: number;
  /** Of `totalOwedMinor`, what archived customers owe (a reminder never goes to them) */
  archivedOwedMinor?: number;
  /** The next page's cursor when `limit` was sent; null on the last page */
  nextCursor?: string | null;
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
  /** «نقاط الولاء» earned and not spent; absent from older answers */
  loyaltyPoints?: number;
  statement: StatementLine[];
  baseCurrency: CurrencyCode;
}

// ─── Money from the admin: a payment received, a debt opened ────────────────────

/** Where a payment received at the desk goes: the safe, the bank, a wallet, a card account. */
export const CUSTOMER_PAYMENT_METHODS = ['cash', 'transfer', 'wallet', 'card'] as const;
export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];

export const CUSTOMER_PAYMENT_LABEL: Record<CustomerPaymentMethod, string> = {
  cash: 'نقداً (الخزنة)',
  transfer: 'حوالة بنكية',
  wallet: 'محفظة إلكترونية',
  card: 'بطاقة',
};

/**
 *   POST /v1/customers/{id}/payments       customerPaymentInput → CustomerMoneyResult (receipt.create)
 *   POST /v1/customers/{id}/opening-debt   customerOpeningDebtInput → CustomerMoneyResult (accounting.post)
 *
 * A payment is the receipt of 08 › سند قبض taken from the admin: Dr the safe (or the bank, wallet,
 * card account), Cr 1200 for the customer. An opening debt is the opening balance of the import
 * (Dr 1200 against 3900 الأرصدة الافتتاحية). Neither changes a posted entry.
 */
export const customerPaymentInput = z
  .object({
    amountMinor: positiveMinorSchema.max(1_000_000_000_000, 'المبلغ كبير جداً'),
    method: z.enum(CUSTOMER_PAYMENT_METHODS, 'اختر طريقة الدفع'),
    reference: shortTextSchema(64).nullable().optional(),
    note: shortTextSchema(200).nullable().optional(),
    date: isoDateSchema.optional(),
    /** Sent again after a lost answer, it posts once */
    id: uuidSchema.optional(),
    /**
     * Round 36 (X1): the branch the money came to, so that branch's reports and its books include it.
     * Missing or null: the entry has no branch, as every payment made before.
     */
    branchId: uuidSchema.nullable().optional(),
  })
  .refine((p) => p.method === 'cash' || !!p.reference, {
    path: ['reference'],
    message: 'اكتب رقم الحوالة أو العملية',
  });
export type CustomerPaymentInput = z.output<typeof customerPaymentInput>;

export const customerOpeningDebtInput = z.object({
  amountMinor: positiveMinorSchema.max(1_000_000_000_000, 'المبلغ كبير جداً'),
  date: isoDateSchema.optional(),
  /** Sent again after a lost answer, it posts once */
  id: uuidSchema.optional(),
});
export type CustomerOpeningDebtInput = z.output<typeof customerOpeningDebtInput>;

/** What was posted, enough to print the voucher: «سند قبض» or «سند رصيد افتتاحي». */
export interface CustomerMoneyResult {
  kind: 'payment' | 'opening_debt';
  /** The voucher's number, RCA-2026-000001 or the journal entry's for an opening debt */
  number: string;
  date: string;
  customerId: string;
  customerName: string;
  amountMinor: number;
  method: CustomerPaymentMethod | null;
  reference: string | null;
  note: string | null;
  /** What the customer owed before and owes after, base currency */
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  baseCurrency: CurrencyCode;
  /** The branch a payment was taken at (round 36); absent or null on a payment with none */
  branchId?: string | null;
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
  /** What the customer owes the store now, base currency (negative: the store owes them) */
  balanceMinor?: number;
}

// ─── Vouchers (a liability the owner can see) ──────────────────────────────────

/**
 *   GET /v1/vouchers?status=open|all&cursor=&limit=   customers.view → VoucherList
 *
 * The exchange vouchers (a return refunded on a voucher) and the gift vouchers sold at the till,
 * with what is left on each: the owner reads here what the store still owes in 2310.
 */
export const voucherListQuery = z.object({
  status: z.enum(['open', 'all']).optional(),
  /** Gift, exchange or deposit only */
  kind: z.enum(['gift', 'exchange', 'deposit']).optional(),
  /** A code, or part of it */
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(64).optional(),
});

export interface VoucherListRow {
  code: string;
  /** Round 48: the day after which it is not honoured, and when the owner voided it */
  expiresOn?: string | null;
  voidedAt?: string | null;
  /** open, used (nothing left), expired or void */
  state?: 'open' | 'used' | 'expired' | 'void';
  /** exchange, gift or deposit */
  kind: string;
  currency: CurrencyCode;
  amountMinor: number;
  redeemedMinor: number;
  remainingMinor: number;
  createdAt: string;
  /** The customer an exchange voucher was issued to (from the sale it came back from); null for a gift voucher */
  customerName?: string | null;
  customerId?: string | null;
}

export interface VoucherList {
  items: VoucherListRow[];
  nextCursor: string | null;
  /** What all open vouchers still hold, per currency */
  outstanding: { currency: CurrencyCode; amountMinor: number; count: number }[];
}

/**
 *   PUT /v1/vouchers/{code}   voucherUpdateInput  (customers.manage): the expiry day, or void it
 */
export const voucherUpdateInput = z.object({
  /** The last day it is honoured; null: never expires */
  expiresOn: isoDateSchema.nullable().optional(),
  /** Cancel it: nothing left to spend. The reason is kept in the log. */
  void: z.boolean().optional(),
  reason: shortTextSchema(120).nullable().optional(),
});
export type VoucherUpdateInput = z.output<typeof voucherUpdateInput>;

// ─── Customer groups (a name and a discount) ───────────────────────────────────

/**
 *   GET  /v1/customer-groups        CustomerGroup[]   (customers.view)
 *   POST /v1/customer-groups        customerGroupInput (customers.manage)
 *   PUT  /v1/customer-groups/{id}   customerGroupInput (customers.manage; `archived` hides it)
 */
export const customerGroupInput = z.object({
  name: z.string('اسم المجموعة مطلوب').trim().min(2, 'اكتب اسم المجموعة').max(60, 'الاسم طويل'),
  /** The discount in hundredths of a percent: 500 is 5% */
  discountBps: z.number().int().min(0, 'الخصم لا يقل عن صفر').max(10000, 'الخصم لا يزيد على 100%'),
  archived: z.boolean().optional(),
});
export type CustomerGroupInput = z.output<typeof customerGroupInput>;

export interface CustomerGroup {
  id: string;
  name: string;
  discountBps: number;
  archived: boolean;
  /** How many customers are in it */
  customers: number;
}
