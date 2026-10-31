/** The report and accounting shapes, from `@serva/core` (contracts/accounting). */
import type { ShiftCurrencyReport, ShiftReport } from '@serva/core';

export type {
  AccountListResponse,
  AccountRow,
  AccountType,
  DayReport,
  JournalEntry,
  JournalLine,
  JournalPage,
  JournalSourceType,
  ShiftListResponse,
  ShiftReport,
  ShiftSummary,
  SyncEvidence,
  TrialBalance,
  TrialBalanceRow,
} from '@serva/core';

export type ShiftCurrencyRow = ShiftCurrencyReport;
export type ShiftMovement = ShiftReport['movements'][number];
