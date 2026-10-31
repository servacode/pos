import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import type { PaymentMethod } from './documents';
import { isoDateSchema, listPageQuery, uuidSchema, type TradeRate } from './common';

/**
 * The accounting and report routes of phase 1 (10 › القيود التلقائية; 17 › المحاسبة والتقارير;
 * 19 › تقرير الوردية ومبيعات اليوم; 23 › شاشة الدليل). The server answers exactly these shapes;
 * the admin screens read them.
 *
 * - GET /v1/accounts                      accounting.view          → AccountListResponse
 * - GET /v1/reports/day                   report.view              → DayReport
 * - GET /v1/shifts                        report.view              → ShiftListResponse
 * - GET /v1/shifts/{id}                   report.view              → ShiftReport
 *     (expectedMinor and differenceMinor are null without shift.view_difference)
 * - GET /v1/journal                       accounting.view          → JournalPage
 * - GET /v1/reports/trial-balance         accounting.view          → TrialBalance
 * - GET /v1/sync/evidence                 devices.view (owner, manager) → SyncEvidence
 *
 * Money is an integer of minor units. Every amount is in the store's base currency unless the
 * field sits next to its own `currency`.
 */

// ─── Chart of accounts ───────────────────────────────────────────────────────

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountRow {
  id: string;
  /** The fixed system number (10 › دليل الحسابات الافتراضي): «1110», a sub-account «111002» */
  code: string;
  name: string;
  nameEn: string | null;
  type: AccountType;
  /** The parent by an explicit field, not by the number's prefix (10 › بنية الدليل) */
  parentCode: string | null;
  /** A group only adds up its children; nothing is ever posted to it */
  isGroup: boolean;
  /** Created by the system; its number never changes */
  isSystem: boolean;
  /** A single-currency account (a cash drawer in dollars); null when it takes any currency */
  currency: CurrencyCode | null;
}

export interface AccountListResponse {
  items: AccountRow[];
}

// ─── Day report ──────────────────────────────────────────────────────────────

export const dayReportQuery = z.object({
  /** One branch, or every branch the caller may see when absent */
  branchId: uuidSchema.optional(),
  date: isoDateSchema,
});

export interface DayReport {
  date: string;
  branchId: string | null;
  invoiceCount: number;
  grossMinor: number;
  discountMinor: number;
  netExTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
  tipsMinor: number;
  /** Cash rounding at payment; positive is a gain for the store (10 › حساب الفاتورة, step 6) */
  cashRoundingMinor: number;
  byMethod: {
    method: PaymentMethod;
    currency: CurrencyCode;
    /** In `currency`; cash is net of the change given in that currency */
    amountMinor: number;
    baseAmountMinor: number;
    /** Invoices paid with this method in this currency */
    count: number;
  }[];
  byCashier: { userId: string; fullName: string; invoiceCount: number; totalMinor: number }[];
  baseCurrency: CurrencyCode;
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export const shiftListQuery = z.object({
  branchId: uuidSchema.optional(),
  date: isoDateSchema.optional(),
});

export interface ShiftSummary {
  id: string;
  /** SFT number */
  number: string;
  branchId: string;
  deviceCode: string;
  /** null while only the close has arrived (a close can reach the server before its opening) */
  openedBy: { id: string; fullName: string } | null;
  openedAt: string | null;
  closedAt: string | null;
  status: 'open' | 'closed';
  salesCount: number;
  salesTotalMinor: number;
}

export interface ShiftListResponse {
  items: ShiftSummary[];
}

/** Every term of the drawer formula of 10 › مطابقة الصندوق, per currency, in that currency. */
export interface ShiftCurrencyReport {
  currency: CurrencyCode;
  openingMinor: number;
  cashSalesMinor: number;
  changeGivenMinor: number;
  payInMinor: number;
  payOutMinor: number;
  dropsMinor: number;
  /** null without shift.view_difference */
  expectedMinor: number | null;
  /** null while the shift is open */
  countedMinor: number | null;
  /** counted − expected; null without shift.view_difference or while open */
  differenceMinor: number | null;
}

export interface ShiftReport extends ShiftSummary {
  byCurrency: ShiftCurrencyReport[];
  byMethod: { method: PaymentMethod; currency: CurrencyCode; amountMinor: number; count: number }[];
  movements: {
    id: string;
    kind: 'pay_in' | 'pay_out' | 'expense' | 'safe_drop';
    currency: CurrencyCode;
    amountMinor: number;
    reason: string;
    approvedBy: { id: string; fullName: string } | null;
    at: string;
  }[];
}

// ─── Journal ─────────────────────────────────────────────────────────────────

export const journalQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  branchId: uuidSchema.optional(),
  ...listPageQuery,
});

/** What an entry was posted from; every automatic entry has its document (10: لا قيد آلي بلا مستند). */
export const JOURNAL_SOURCE_TYPES = ['sale', 'shift_close', 'cash_movement', 'manual', 'reversal'] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

export interface JournalLine {
  accountCode: string;
  accountName: string;
  /** Base currency; exactly one of the two is non-zero */
  debitMinor: number;
  creditMinor: number;
  /** The line's own currency and amount (a dollar cash line: USD 900 for 1,170.00 ل.س) */
  currency: CurrencyCode;
  amountMinor: number;
  /** The rate that turned amountMinor into the base amount; null in the base currency */
  rate: TradeRate | null;
}

export interface JournalEntry {
  id: string;
  /** Sequential per year with no gaps, given at posting (10 › رقم القيد) */
  number: string;
  /** The event's date (the document's business date) */
  date: string;
  source: { type: JournalSourceType; id: string; number: string | null };
  memo: string;
  lines: JournalLine[];
  /** Σ debits = Σ credits, in the base currency */
  totalMinor: number;
}

export interface JournalPage {
  items: JournalEntry[];
  nextCursor: string | null;
}

// ─── Trial balance ───────────────────────────────────────────────────────────

export const trialBalanceQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  type: AccountType;
  /**
   * Balances are signed by the account's normal side (10 › الطبيعة): positive is a debit balance
   * for a debit account (cash, expenses, 4200 discounts) and a credit balance for a credit account
   * (sales, tax payable, 1290); negative is the other side.
   */
  openingMinor: number;
  /** Movements between from and to */
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: { debitMinor: number; creditMinor: number };
  balanced: boolean;
}

// ─── Evidence screen (23 › شاشة الدليل) ──────────────────────────────────────

export const syncEvidenceQuery = z.object({
  deviceId: uuidSchema,
  /** The documents' business date; every date when absent */
  date: isoDateSchema.optional(),
});

export interface SyncEvidence {
  deviceId: string;
  deviceName: string;
  /** Distinct documents received */
  sent: number;
  accepted: number;
  /** Copies of documents already received (resent after a lost answer) */
  duplicate: number;
  rejected: number;
  quarantined: number;
  /** Per series (INV, SFT, CSH…): the full number, e.g. INV-001-002-0000154 */
  lastAnnouncedNumber: Record<string, string | null>;
  lastReceivedNumber: Record<string, string | null>;
}
