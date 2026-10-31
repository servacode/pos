import type { CashMovementKind, CurrencyCode, PaymentMethod } from '@serva/core';

// LOCAL COPY of the step-5 report shapes. The server package writes them into
// packages/core/src/contracts/accounting.ts; until that lands on this branch, the screens code
// against this copy. At merge, replace this file's body with
// `export type { … } from '@serva/core';` and delete the copy.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/** GET /v1/accounts → { items: AccountRow[] } */
export interface AccountRow {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  type: AccountType;
  parentCode: string | null;
  isGroup: boolean;
  isSystem: boolean;
  currency: CurrencyCode | null;
}

export interface AccountListResponse {
  items: AccountRow[];
}

/** GET /v1/reports/day?branchId=&date=YYYY-MM-DD. Amounts in the base currency unless named. */
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
  cashRoundingMinor: number;
  byMethod: {
    method: PaymentMethod;
    currency: CurrencyCode;
    /** In the payment's own currency */
    amountMinor: number;
    baseAmountMinor: number;
    count: number;
  }[];
  byCashier: { userId: string; fullName: string; invoiceCount: number; totalMinor: number }[];
  baseCurrency: CurrencyCode;
}

/** GET /v1/shifts?branchId=&date= → { items: ShiftSummary[] } */
export interface ShiftSummary {
  id: string;
  number: string;
  branchId: string;
  deviceCode: string;
  openedBy: { id: string; fullName: string };
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'closed';
  salesCount: number;
  salesTotalMinor: number;
}

export interface ShiftListResponse {
  items: ShiftSummary[];
}

export interface ShiftCurrencyRow {
  currency: CurrencyCode;
  openingMinor: number;
  cashSalesMinor: number;
  changeGivenMinor: number;
  payInMinor: number;
  payOutMinor: number;
  dropsMinor: number;
  /** null unless the caller holds shift.view_difference */
  expectedMinor: number | null;
  countedMinor: number | null;
  /** null unless the caller holds shift.view_difference */
  differenceMinor: number | null;
}

export interface ShiftMovement {
  id: string;
  kind: CashMovementKind;
  currency: CurrencyCode;
  amountMinor: number;
  reason: string | null;
  approvedBy: { id: string; fullName: string } | null;
  at: string;
}

/** GET /v1/shifts/{id} */
export interface ShiftReport extends ShiftSummary {
  byCurrency: ShiftCurrencyRow[];
  byMethod: { method: PaymentMethod; currency: CurrencyCode; amountMinor: number; count: number }[];
  movements: ShiftMovement[];
}

export type JournalSourceType = 'sale' | 'shift_close' | 'cash_movement' | 'manual' | (string & {});

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  currency: CurrencyCode;
  /** In the line's own currency */
  amountMinor: number;
  rate: string | null;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  source: { type: JournalSourceType; id: string; number: string | null };
  memo: string | null;
  lines: JournalLine[];
  totalMinor: number;
}

/** GET /v1/journal?from=&to=&branchId=&cursor= */
export interface JournalPage {
  items: JournalEntry[];
  nextCursor: string | null;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  type: AccountType;
  /** Signed on the account's normal side (10): positive is a debit balance for assets and expenses. */
  openingMinor: number;
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
}

/** GET /v1/reports/trial-balance?from=&to=&branchId= */
export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: { debitMinor: number; creditMinor: number };
  balanced: boolean;
}

/** GET /v1/sync/evidence?deviceId=&date= («شاشة الدليل», 23 › مصفوفة التتبّع) */
export interface SyncEvidence {
  deviceId: string;
  deviceName: string;
  sent: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  quarantined: number;
  lastAnnouncedNumber: Record<string, string | null>;
  lastReceivedNumber: Record<string, string | null>;
}
