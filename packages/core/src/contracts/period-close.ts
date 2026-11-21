import { z } from 'zod';
import { isoDateSchema } from './common';

/**
 * «إقفال الفترة» (round 37, decision 17; design in D:\serva-work\period-close-design.md).
 *
 *   GET  /v1/period-close           accounting.view   → PeriodCloseState
 *   POST /v1/period-close/close     period.lock       periodCloseInput  → PeriodCloseState
 *   POST /v1/period-close/reopen    period.unlock     periodReopenInput → PeriodCloseState
 *
 * One closing date for the whole store: every document dated on or before it is closed.
 *  - What a person writes on the dashboard (an expense, a hand-written entry, a purchase, a payment to a supplier,
 *    a count, a transfer, a return to the supplier) dated in the closed period is refused, in plain Arabic.
 *  - What a device sends later (a sale, a return, a receipt, a shift) is NEVER refused: the document keeps its own
 *    date and its entry is posted on the first open day (posting_date), flagged, and listed in `late` for the
 *    accountant. The books of the closed months (balance sheet, trial balance, ledger, cash flow, income
 *    statement) read posting_date, so a closed month never changes; the tax and day reports read entry_date.
 *  - Closing needs the integrity check green. Reopening needs a reason and is audited; it moves the date back
 *    (or clears it) and changes no entry already posted.
 */
export const periodCloseInput = z.object({
  /** Documents dated on or before this day are closed; it must be before today and after the current closing date */
  through: isoDateSchema,
  note: z.string().trim().max(200, 'الملاحظة طويلة').optional(),
});
export type PeriodCloseInput = z.input<typeof periodCloseInput>;

export const periodReopenInput = z.object({
  /** The new closing date, earlier than the current one; null opens everything */
  through: isoDateSchema.nullable(),
  reason: z.string('اكتب سبب الفتح').trim().min(3, 'اكتب سبب الفتح').max(200, 'السبب طويل'),
});
export type PeriodReopenInput = z.input<typeof periodReopenInput>;

export interface PeriodLockEvent {
  id: string;
  kind: 'close' | 'reopen';
  /** The closing date after this event; null: nothing closed */
  lockedThrough: string | null;
  previousThrough: string | null;
  reason: string | null;
  by: string;
  at: string;
}

/** An entry that landed in a closed period and was posted on the first open day */
export interface LatePostedEntry {
  entryId: string;
  number: string;
  /** The document's own day */
  entryDate: string;
  /** The day it was posted on */
  postingDate: string;
  sourceType: string;
  sourceNumber: string | null;
  memo: string;
  totalMinor: number;
}

export interface PeriodCheck {
  /** Integrity checks' names with what is wrong, empty when green */
  name: string;
  ok: boolean;
  problems: string[];
}

export interface PeriodCloseState {
  lockedThrough: string | null;
  /** The first day documents post on as of now (the day after the closing date) */
  firstOpenDay: string | null;
  /** The latest date a close may name: yesterday */
  latestCloseDate: string;
  history: PeriodLockEvent[];
  late: LatePostedEntry[];
  lateTotalMinor: number;
  baseCurrency: string;
  /** Filled when the page asks for them (the close buttons run them again) */
  checks: PeriodCheck[];
}
