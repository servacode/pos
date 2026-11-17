import { z } from 'zod';
import { INSTALMENT_FREQUENCIES } from '../installments';
import { bpSchema, isoDateSchema, nonNegativeMinorSchema, positiveMinorSchema, uuidSchema } from './common';

/**
 * Instalments (الأقساط, docs: D:\serva-work\instalments-design.md): a schedule laid over the
 * customer's receivable. The sale that finances goods carries its plan in an optional field and the
 * customer's payment toward it carries an optional list of what it settles; both documents post what
 * they post without them (posting.ts is untouched), the plan tables are a projection of them.
 *
 *   GET  /v1/installment-plans?status=&q=&overdue=     installments.view   → { items: PlanListItem[] }
 *   GET  /v1/installment-plans/{id}                    installments.view   → PlanDetail
 *   POST /v1/installment-plans/{id}/collect            installments.create + receipt.create → PlanDetail
 *   POST /v1/installment-plans/{id}/cancel             installments.manage → PlanDetail
 *   GET  /v1/installments/worklist?bucket=             installments.view   → { items: WorklistRow[] }
 *   GET  /v1/installments/summary                      installments.view   → InstalmentSummary
 *   POST /v1/installments/{planId}/{no}/reminders      installments.view   → { ok: true }
 *   GET/PUT /v1/store/installments-settings            settings.manage
 *   GET  /v1/device/installments/customer/{id}         device              → CustomerInstalments
 */

/** The status of a plan: stored (a late plan is still «active»: lateness is derived from dates) */
export const PLAN_STATUSES = ['active', 'completed', 'cancelled', 'defaulted'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  defaulted: 'متعثرة',
};

export const NOTES_MODES = ['none', 'each', 'single'] as const;

/** The guarantor (كفيل): the shop's usual details of a person who answers for the customer */
export const guarantorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nationalId: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  relation: z.string().trim().max(60).nullable().optional(),
});
export type Guarantor = z.output<typeof guarantorSchema>;

/** The customer's papers as the shop took them for this plan */
export const borrowerSchema = z.object({
  nationalId: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  phone2: z.string().trim().max(30).nullable().optional(),
});
export type Borrower = z.output<typeof borrowerSchema>;

export const scheduledInstalmentSchema = z.object({
  no: z.int().min(1).max(60),
  dueDate: isoDateSchema,
  amountMinor: positiveMinorSchema,
});

/**
 * The plan a sale carries (`salePayload.installmentPlan`). `id` is minted on the device so a
 * re-sent sale cannot make two plans. The server checks the schedule against the sale and, when it
 * does not hold, keeps the sale and drops the plan with a flag (a printed sale is never refused).
 */
export const installmentPlanInputSchema = z.object({
  id: uuidSchema,
  count: z.int().min(1).max(60),
  frequency: z.enum(INSTALMENT_FREQUENCIES),
  firstDueDate: isoDateSchema,
  downPaymentMinor: nonNegativeMinorSchema,
  principalMinor: positiveMinorSchema,
  markupMinor: nonNegativeMinorSchema,
  financedMinor: positiveMinorSchema,
  /** The markup rate this plan was priced at, for the record */
  markupBp: bpSchema,
  guarantor: guarantorSchema.nullable().optional(),
  borrower: borrowerSchema.nullable().optional(),
  notesMode: z.enum(NOTES_MODES).optional(),
  schedule: z.array(scheduledInstalmentSchema).min(1).max(60),
});
export type InstalmentPlanInput = z.output<typeof installmentPlanInputSchema>;

/** What a customer's receipt settles: instalment `no` of plan `planId`, this much of it */
export const receiptAllocationSchema = z.object({
  planId: uuidSchema,
  no: z.int().min(1).max(60),
  amountMinor: positiveMinorSchema,
});
export type ReceiptAllocation = z.output<typeof receiptAllocationSchema>;

// ─── Settings (admin › إعدادات التقسيط) ──────────────────────────────────────

export const instalmentSettingsInput = z
  .object({
    enabled: z.boolean(),
    minDownBp: z.int().min(0, 'الدفعة الأولى من 0 إلى 100%').max(10_000, 'الدفعة الأولى من 0 إلى 100%'),
    maxCount: z.int().min(1).max(60, 'أقصى عدد 60 قسطاً'),
    markupBands: z
      .array(
        z.object({
          upToCount: z.int().min(1).max(60),
          bp: z.int().min(0).max(10_000, 'النسبة من 0 إلى 100%'),
        }),
      )
      .max(8),
    roundingStepMinor: nonNegativeMinorSchema,
    guarantorOverMinor: nonNegativeMinorSchema.nullable(),
    reminderBeforeDays: z.int().min(0).max(30),
    reminderAfterDays: z.int().min(0).max(60),
    notesMode: z.enum(NOTES_MODES),
    noteText: z.string().trim().max(600).nullable(),
    notePlace: z.string().trim().max(60).nullable(),
  })
  .refine((s) => new Set(s.markupBands.map((b) => b.upToCount)).size === s.markupBands.length, {
    path: ['markupBands'],
    message: 'عدد أقساط مكرر في النسب',
  });
export type InstalmentSettingsInput = z.input<typeof instalmentSettingsInput>;

// ─── Views ───────────────────────────────────────────────────────────────────

export type InstalmentRowState = 'paid' | 'partial' | 'due_today' | 'late' | 'upcoming' | 'cancelled';

export interface PlanInstalment {
  no: number;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
  state: InstalmentRowState;
  daysLate: number;
}

export interface PlanListItem {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  status: PlanStatus;
  financedMinor: number;
  paidMinor: number;
  remainingMinor: number;
  count: number;
  createdAt: string;
  nextDueDate: string | null;
  nextDueMinor: number;
  lateMinor: number;
  lateCount: number;
}

export interface PlanPayment {
  receiptNumber: string | null;
  date: string;
  no: number;
  amountMinor: number;
}

export const NOTE_STATUSES = ['issued', 'paid', 'protested', 'cancelled'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];
export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  issued: 'قائمة',
  paid: 'مسددة',
  protested: 'محتجّ عليها',
  cancelled: 'ملغاة',
};

/** A promissory note (كمبيالة) of a plan: one per instalment, or one for all of it (no = null) */
export interface PlanNote {
  id: string;
  number: string;
  no: number | null;
  amountMinor: number;
  issueDate: string;
  dueDate: string;
  status: NoteStatus;
  statusDate: string | null;
  printedCount: number;
}

export const noteActionInput = z.object({
  action: z.enum(['paid', 'protested', 'cancelled']),
  note: z.string().trim().max(200).nullable().optional(),
});

export interface PlanDetail extends PlanListItem {
  /** The notes' wording and place from the store's settings (null: the shipped wording) */
  noteText: string | null;
  notePlace: string | null;
  notes: PlanNote[];
  saleNumber: string | null;
  saleId: string | null;
  customerPhone: string | null;
  principalMinor: number;
  downPaymentMinor: number;
  markupMinor: number;
  markupBp: number;
  frequency: (typeof INSTALMENT_FREQUENCIES)[number];
  guarantor: Guarantor | null;
  borrower: Borrower | null;
  closeReason: string | null;
  instalments: PlanInstalment[];
  payments: PlanPayment[];
  storeName: string;
}

export const planListQuery = z.object({
  status: z.enum(PLAN_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  customerId: uuidSchema.optional(),
  overdue: z
    .enum(['1', 'true'])
    .optional()
    .transform((v) => v !== undefined),
});

/** remind: what the store's reminder days pick today (the day before, the day itself, the days after it); the others are by due day */
export const WORKLIST_BUCKETS = ['remind', 'today', 'week', 'late'] as const;
export type WorklistBucket = (typeof WORKLIST_BUCKETS)[number];
export const worklistQuery = z.object({ bucket: z.enum(WORKLIST_BUCKETS).default('remind') });

export interface WorklistRow {
  planId: string;
  planNumber: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  no: number;
  of: number;
  dueDate: string;
  remainingMinor: number;
  daysLate: number;
  lastReminderAt: string | null;
}

export interface InstalmentSummary {
  dueTodayCount: number;
  dueTodayMinor: number;
  lateCount: number;
  lateMinor: number;
  activePlans: number;
  outstandingMinor: number;
}

/** What the till shows about one customer's open plans (online) */
export interface CustomerInstalments {
  today: string;
  plans: {
    id: string;
    number: string;
    financedMinor: number;
    remainingMinor: number;
    instalments: PlanInstalment[];
  }[];
}

export const collectInput = z
  .object({
    amountMinor: positiveMinorSchema.max(1_000_000_000_000, 'المبلغ كبير جداً'),
    method: z.enum(['cash', 'card', 'wallet', 'transfer']).default('cash'),
    reference: z.string().trim().min(1).max(64).nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    date: isoDateSchema.optional(),
  })
  .refine((p) => p.method === 'cash' || !!p.reference, {
    path: ['reference'],
    message: 'اكتب رقم الحوالة أو العملية',
  });
export type CollectInput = z.input<typeof collectInput>;

export const cancelPlanInput = z.object({ reason: z.string().trim().min(1, 'اكتب السبب').max(200) });

export const reminderInput = z.object({ kind: z.enum(['before', 'due', 'late']) });
