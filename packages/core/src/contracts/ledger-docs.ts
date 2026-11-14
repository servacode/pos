import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import {
  currencyCodeSchema,
  exchangeRateSchema,
  isoDateSchema,
  listPageQuery,
  positiveMinorSchema,
  shortTextSchema,
  uuidSchema,
  type TradeRate,
} from './common';

/**
 * Statements, expenses, manual journal entries and the profit and loss (29 › المحاسبة المتقدمة).
 * Everything here is read from the one ledger (the journal) or posts a balanced entry into it
 * through the same posting mechanism the documents use; a posted entry is never changed, a
 * correction is a reversing entry.
 *
 *   GET  /v1/customers/{id}/statement?from&to  PartyStatement   (customers.view)
 *   GET  /v1/suppliers/{id}/statement?from&to  PartyStatement   (purchases.manage)
 *   GET  /v1/expenses?from&to&branchId&accountCode  ExpenseListResponse (expenses.manage)
 *   POST /v1/expenses                          expenseInput → ExpenseRow (expenses.manage)
 *   POST /v1/expenses/{id}/void                voidInput → ExpenseRow    (expenses.manage)
 *   POST /v1/journal/manual                    manualEntryInput → ManualEntryRow (accounting.post)
 *   POST /v1/journal/{id}/reverse              voidInput → ManualEntryRow (accounting.post)
 *   GET  /v1/reports/profit-loss?from&to&branchId  ProfitLoss   (accounting.view)
 */

// ─── Statements (كشف حساب) ────────────────────────────────────────────────────

export const statementRangeQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
});

/** One movement on the party's account, from the journal line that names the party. */
export interface PartyStatementLine {
  date: string;
  /** sale, receipt, cheque, purchase, supplier_payment, supplier_return, … */
  sourceType: string;
  sourceId: string;
  number: string | null;
  memo: string;
  debitMinor: number;
  creditMinor: number;
  /** After this line, on the account's side (a customer: owes; a supplier: is owed) */
  balanceMinor: number;
}

export interface PartyStatement {
  type: 'customer' | 'supplier';
  party: { id: string; name: string; phone: string | null };
  from: string;
  to: string;
  /** Before `from`; positive: the customer owes the store, the store owes the supplier */
  openingMinor: number;
  lines: PartyStatementLine[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  closingMinor: number;
  baseCurrency: CurrencyCode;
}

// ─── Expenses (مصاريف) ────────────────────────────────────────────────────────

/** Where an expense was paid from; each is a fixed account of the chart. */
export const EXPENSE_PAY_FROM = ['safe', 'bank', 'wallet', 'card'] as const;
export type ExpensePayFrom = (typeof EXPENSE_PAY_FROM)[number];

export const EXPENSE_PAY_FROM_LABEL: Record<ExpensePayFrom, string> = {
  safe: 'الخزنة',
  bank: 'البنك',
  wallet: 'محفظة إلكترونية',
  card: 'حساب البطاقات',
};

export const expenseInput = z.object({
  date: isoDateSchema,
  branchId: uuidSchema,
  /** A non-group expense account of the chart (6101 الإيجار, 6102 الكهرباء, …) */
  accountCode: z.string().regex(/^6\d{3,5}$/, 'اختر حساب المصروف'),
  amountMinor: positiveMinorSchema,
  currency: currencyCodeSchema,
  /** The dollar's rate for a foreign amount; the store's current rate when absent */
  rate: exchangeRateSchema.nullable().optional(),
  payFrom: z.enum(EXPENSE_PAY_FROM),
  note: shortTextSchema(200).nullable().optional(),
  /** Sent again after a lost answer, it posts once (the same id answers the same expense) */
  id: uuidSchema.optional(),
});
export type ExpenseInput = z.output<typeof expenseInput>;

export const voidInput = z.object({ reason: shortTextSchema(200) });

export interface ExpenseRow {
  id: string;
  number: string;
  date: string;
  branchId: string;
  accountCode: string;
  accountName: string;
  currency: CurrencyCode;
  amountMinor: number;
  baseAmountMinor: number;
  rate: TradeRate | null;
  payFrom: ExpensePayFrom;
  note: string | null;
  entryNumber: string | null;
  /** Reversed: shown struck out and left out of the totals */
  voided: boolean;
  voidReason: string | null;
}

export const expenseListQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  branchId: uuidSchema.optional(),
  accountCode: z.string().max(10).optional(),
  ...listPageQuery,
});

export interface ExpenseListResponse {
  items: ExpenseRow[];
  nextCursor: string | null;
  /** Of the whole filter (every page), not the voided; base currency */
  totalMinor: number;
  byAccount: { accountCode: string; accountName: string; totalMinor: number; count: number }[];
  baseCurrency: CurrencyCode;
}

// ─── Manual journal entries (قيد يدوي) ────────────────────────────────────────

export const manualLineInput = z
  .object({
    accountCode: z.string().regex(/^\d{3,8}$/, 'اختر الحساب'),
    debitMinor: z.int().nonnegative().default(0),
    creditMinor: z.int().nonnegative().default(0),
    currency: currencyCodeSchema.optional(),
    /** For a foreign line when the store's current rate is not the one wanted */
    rate: exchangeRateSchema.nullable().optional(),
    memo: shortTextSchema(200).nullable().optional(),
  })
  .refine((l) => l.debitMinor > 0 !== l.creditMinor > 0, {
    message: 'السطر مدين أو دائن، لا الاثنان ولا فارغ',
    path: ['debitMinor'],
  });

export const manualEntryInput = z.object({
  date: isoDateSchema,
  branchId: uuidSchema,
  memo: shortTextSchema(300),
  lines: z.array(manualLineInput).min(2, 'القيد سطران على الأقل').max(100),
  id: uuidSchema.optional(),
});
export type ManualEntryInput = z.output<typeof manualEntryInput>;

export interface ManualEntryRow {
  id: string;
  number: string;
  date: string;
  kind: 'manual' | 'reversal';
  memo: string;
  totalMinor: number;
  reversesId: string | null;
}

// ─── Profit and loss (قائمة الدخل) ────────────────────────────────────────────

export const profitLossQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  branchId: uuidSchema.optional(),
});

export interface PnlAccount {
  accountCode: string;
  accountName: string;
  /** Positive: adds to profit for revenue, takes from it for cost and expenses */
  amountMinor: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  branchId: string | null;
  baseCurrency: CurrencyCode;
  /** Sales and service revenue less discounts and returns */
  revenue: { accounts: PnlAccount[]; totalMinor: number };
  costOfSales: { accounts: PnlAccount[]; totalMinor: number };
  grossProfitMinor: number;
  otherIncome: { accounts: PnlAccount[]; totalMinor: number };
  expenses: {
    groups: { code: string; name: string; accounts: PnlAccount[]; totalMinor: number }[];
    totalMinor: number;
  };
  netProfitMinor: number;
}
