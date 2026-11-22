import { z } from 'zod';
import type { Ageing } from '../ageing';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, uuidSchema } from './common';
import type { AccountType } from './accounting';

/**
 * The financial statements (19 › التقارير المالية; 29 › المحاسبة المتقدمة): all read-only, all from
 * the one ledger (the journal) in the store's base currency, and each one proves itself against
 * another: the balance sheet balances, the cash flow ends on the cash accounts' balances, the tax
 * report adds up the tax lines of the invoices and agrees with the tax accounts.
 *
 *   GET /v1/reports/balance-sheet?asOf&compareTo&branchId   BalanceSheet   (accounting.view)
 *   GET /v1/reports/cash-flow?from&to&branchId              CashFlow       (accounting.view)
 *   GET /v1/reports/account-ledger?code&from&to&branchId    AccountLedger  (accounting.view)
 *   GET /v1/reports/tax?from&to&branchId                    TaxReport      (accounting.view)
 *   GET /v1/reports/supplier-ageing?asOf                    SupplierAgeingReport (purchases.manage)
 */

// ─── Balance sheet (الميزانية العمومية) ────────────────────────────────────────

export const balanceSheetQuery = z.object({
  asOf: isoDateSchema,
  /** A second date to compare with; its amounts come back beside each line */
  compareTo: isoDateSchema.optional(),
  branchId: uuidSchema.optional(),
});

export interface BalanceSheetAccount {
  /** The chart number; empty for a computed line (the period's profit), which has no ledger to open */
  accountCode: string;
  accountName: string;
  /** Assets: debit minus credit. Liabilities and equity: credit minus debit (drawings come out negative) */
  amountMinor: number;
  /** The same on `compareTo`; null when no comparison was asked for */
  previousMinor: number | null;
}

export interface BalanceSheetGroup {
  code: string;
  name: string;
  accounts: BalanceSheetAccount[];
  totalMinor: number;
  previousTotalMinor: number | null;
}

export interface BalanceSheetSection {
  groups: BalanceSheetGroup[];
  totalMinor: number;
  previousTotalMinor: number | null;
}

export interface BalanceSheet {
  asOf: string;
  compareTo: string | null;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  /** The first day of the year `asOf` falls in: profit before it is carried over, profit since it is this year's */
  yearStart: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  /** Includes the profit not yet carried to the retained earnings, as two lines of its own group */
  equity: BalanceSheetSection;
  /** liabilities + equity */
  liabilitiesAndEquityMinor: number;
  previousLiabilitiesAndEquityMinor: number | null;
  /** Assets − (liabilities + equity); zero when the books balance */
  differenceMinor: number;
  balanced: boolean;
}

// ─── Cash flow (التدفق النقدي، الطريقة المباشرة) ───────────────────────────────

export const cashFlowQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export const CASH_FLOW_CATEGORIES = [
  'sales',
  'customer_receipts',
  'supplier_payments',
  'expenses',
  'owner',
  'other',
  'transfer',
] as const;
export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];

export const CASH_FLOW_LABEL: Record<CashFlowCategory, string> = {
  sales: 'المبيعات',
  customer_receipts: 'تحصيل من الزبائن',
  supplier_payments: 'دفعات الموردين',
  expenses: 'المصاريف',
  owner: 'رأس المال والمسحوبات',
  other: 'حركات أخرى',
  transfer: 'تحويل بين الصندوق والخزنة والبنك',
};

export interface CashFlowAccount {
  accountCode: string;
  accountName: string;
  openingMinor: number;
  inMinor: number;
  outMinor: number;
  closingMinor: number;
}

export interface CashFlowCategoryRow {
  category: CashFlowCategory;
  inMinor: number;
  outMinor: number;
  netMinor: number;
}

export interface CashFlow {
  from: string;
  to: string;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  /** Cash drawers, reps' cash, the safe, banks and wallets: one row each, sub-accounts by currency */
  accounts: CashFlowAccount[];
  categories: CashFlowCategoryRow[];
  totals: { openingMinor: number; inMinor: number; outMinor: number; closingMinor: number };
  /** closing = opening + receipts − payments, by account and by category alike */
  balanced: boolean;
}

// ─── Account ledger (دفتر الأستاذ) ─────────────────────────────────────────────

export const accountLedgerQuery = z.object({
  code: z.string().regex(/^\d{1,8}$/),
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

/** The most movements one answer carries; a longer range says so and asks for a shorter one. */
export const ACCOUNT_LEDGER_LIMIT = 3000;

export interface AccountLedgerLine {
  date: string;
  entryId: string;
  entryNumber: string;
  /** The sub-account the line is on, when the asked account is a group of them */
  accountCode: string;
  accountName: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  memo: string;
  debitMinor: number;
  creditMinor: number;
  /** After this line, on the account's normal side */
  balanceMinor: number;
}

export interface AccountLedger {
  account: { code: string; name: string; type: AccountType; isGroup: boolean };
  from: string;
  to: string;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  openingMinor: number;
  lines: AccountLedgerLine[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  closingMinor: number;
  /** True when the range held more movements than the answer carries: the lines stop early */
  truncated: boolean;
}

// ─── Tax report (تقرير الضريبة) ────────────────────────────────────────────────

export const taxReportQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export interface TaxReportRow {
  rateId: string | null;
  name: string;
  kind: 'sales' | 'consumption' | 'stamp' | null;
  rateBp: number;
  /** Invoice lines: what was sold at this rate, without the tax, and the tax on it */
  salesTaxableMinor: number;
  salesTaxMinor: number;
  /** The same for what customers returned */
  returnsTaxableMinor: number;
  returnsTaxMinor: number;
  netTaxableMinor: number;
  netTaxMinor: number;
}

export interface TaxReport {
  from: string;
  to: string;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  rows: TaxReportRow[];
  totals: {
    salesTaxableMinor: number;
    salesTaxMinor: number;
    returnsTaxableMinor: number;
    returnsTaxMinor: number;
    netTaxableMinor: number;
    netTaxMinor: number;
  };
  /** Input tax booked on purchases in the period (account 1400), for the net the store owes */
  inputTaxMinor: number;
  netPayableMinor: number;
  /** What the sale and return entries put on the tax accounts 2200/2210/2220: must equal netTaxMinor */
  ledgerOutputTaxMinor: number;
  reconciled: boolean;
}

// ─── Supplier ageing (أعمار ديون الموردين) ─────────────────────────────────────

export const supplierAgeingQuery = z.object({ asOf: isoDateSchema.optional() });

export interface SupplierAgeingRow {
  supplierId: string;
  name: string;
  phone: string | null;
  /** What the store owes the supplier: the sum of the four buckets */
  balanceMinor: number;
  buckets: Ageing;
}

export interface SupplierAgeingReport {
  asOf: string;
  baseCurrency: CurrencyCode;
  items: SupplierAgeingRow[];
  totals: Ageing & { balanceMinor: number };
}
