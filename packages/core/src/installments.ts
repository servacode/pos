import { applyBasisPoints } from './money';
import { daysBetween, plusDays, plusMonths } from './rentals';

/**
 * Instalments (الأقساط): a schedule laid over the customer's receivable. Pure functions, no I/O and
 * no clock: days are «YYYY-MM-DD» strings of the store's own calendar, money is integer minor units
 * (half away from zero through money.ts). The sale and the receipt that carry a plan post exactly
 * what they post without one; nothing here touches the ledger.
 */

export const INSTALMENT_FREQUENCIES = ['monthly', 'biweekly', 'weekly', 'custom'] as const;
export type InstalmentFrequency = (typeof INSTALMENT_FREQUENCIES)[number];

export const INSTALMENT_FREQUENCY_LABELS: Record<InstalmentFrequency, string> = {
  monthly: 'شهري',
  biweekly: 'كل أسبوعين',
  weekly: 'أسبوعي',
  custom: 'تواريخ أحددها',
};

/**
 * The service line «رسم التقسيط» on the invoice carries these ids: no product row stands behind it
 * (invoice lines keep no foreign key to the catalog), so no stock moves and nothing is created per store.
 */
export const INSTALMENT_FEE_PRODUCT_ID = '00000000-0000-7000-8000-0000000f1ee0';
export const INSTALMENT_FEE_VARIANT_ID = '00000000-0000-7000-8000-0000000f1ee1';
export const INSTALMENT_FEE_NAME = 'رسم التقسيط';

/** The markup for plans up to `upToCount` instalments, in basis points of the financed principal */
export interface MarkupBand {
  upToCount: number;
  bp: number;
}

/** What the owner chose for the store (tenant_settings.installments) and the defaults of a new one */
export interface InstalmentSettings {
  enabled: boolean;
  /** Smallest down payment as a share of the total; a manager may lower it */
  minDownBp: number;
  maxCount: number;
  markupBands: MarkupBand[];
  /** Instalments are rounded down to this step, the last one takes the difference; 0 = none */
  roundingStepMinor: number;
  /** A guarantor is required when the financed amount is at least this; null = never */
  guarantorOverMinor: number | null;
  /** The reminder goes this many days before the due day … */
  reminderBeforeDays: number;
  /** … and again this many days after it */
  reminderAfterDays: number;
  notesMode: 'none' | 'each' | 'single';
  /** The wording printed on each promissory note (a lawyer's text can replace it) */
  noteText: string | null;
  notePlace: string | null;
}

export const DEFAULT_INSTALMENT_SETTINGS: InstalmentSettings = {
  enabled: false,
  minDownBp: 2000,
  maxCount: 12,
  markupBands: [
    { upToCount: 3, bp: 500 },
    { upToCount: 6, bp: 1000 },
    { upToCount: 12, bp: 2000 },
  ],
  roundingStepMinor: 0,
  guarantorOverMinor: null,
  reminderBeforeDays: 1,
  reminderAfterDays: 3,
  notesMode: 'none',
  noteText: null,
  notePlace: null,
};

/** The stored settings with every missing field filled from the defaults (a store that never chose gets them) */
export function instalmentSettingsOf(
  stored: Partial<InstalmentSettings> | null | undefined,
): InstalmentSettings {
  return { ...DEFAULT_INSTALMENT_SETTINGS, ...(stored ?? {}) };
}

/** The band a count falls in: the first whose limit holds it, else the last (a count over every band pays the top rate) */
export function markupBpFor(count: number, bands: readonly MarkupBand[]): number {
  if (bands.length === 0) return 0;
  const sorted = [...bands].sort((a, b) => a.upToCount - b.upToCount);
  return (sorted.find((b) => count <= b.upToCount) ?? sorted[sorted.length - 1]!).bp;
}

/** رسم التقسيط on what is left after the down payment, whole minor units, half away from zero */
export function markupFor(principalMinor: number, count: number, settings: InstalmentSettings): number {
  return applyBasisPoints(Math.max(0, principalMinor), markupBpFor(count, settings.markupBands));
}

/** The smallest down payment the store asks for on this total (rounded up so the share is never below it) */
export function minDownPayment(totalMinor: number, settings: InstalmentSettings): number {
  return Math.min(totalMinor, Math.ceil((totalMinor * settings.minDownBp) / 10_000));
}

export interface InstalmentTerms {
  /** The goods total before the markup */
  totalMinor: number;
  downPaymentMinor: number;
  count: number;
  frequency: InstalmentFrequency;
  /** The first due day */
  firstDueDate: string;
  /** With `custom`: one ascending day per instalment */
  customDates?: readonly string[];
  /** The markup already worked out (markupFor) or typed by a manager */
  markupMinor: number;
  roundingStepMinor?: number;
}

export interface ScheduledInstalment {
  no: number;
  dueDate: string;
  amountMinor: number;
}

export interface InstalmentSchedule {
  principalMinor: number;
  markupMinor: number;
  financedMinor: number;
  instalments: ScheduledInstalment[];
}

/** The i-th due day (0 is the first) of a regular plan; monthly keeps the first day's number (31 Jan → 28 Feb → 31 Mar) */
export function dueDateOf(
  first: string,
  frequency: Exclude<InstalmentFrequency, 'custom'>,
  index: number,
): string {
  if (frequency === 'monthly') return plusMonths(first, index);
  return plusDays(first, index * (frequency === 'weekly' ? 7 : 14));
}

/**
 * The schedule: principal = total − down, financed = principal + markup, split into `count` equal
 * instalments (each rounded down to the step) and the last one takes the difference, so they add up
 * to the financed amount exactly. Throws an Arabic message the sheet shows when the terms do not hold.
 */
export function buildSchedule(terms: InstalmentTerms): InstalmentSchedule {
  const { totalMinor, downPaymentMinor, count, markupMinor } = terms;
  if (!Number.isInteger(count) || count < 1) throw new Error('عدد الأقساط واحد على الأقل.');
  if (downPaymentMinor < 0 || downPaymentMinor >= totalMinor) {
    throw new Error('الدفعة الأولى أقل من المبلغ كله.');
  }
  if (markupMinor < 0) throw new Error('رسم التقسيط لا يكون سالباً.');
  const principalMinor = totalMinor - downPaymentMinor;
  const financedMinor = principalMinor + markupMinor;
  const step = Math.max(1, terms.roundingStepMinor ?? 0);
  const base = Math.floor(Math.floor(financedMinor / count) / step) * step;
  if (base < 1) throw new Error('القسط أقل من أصغر مبلغ. قلّل عدد الأقساط.');

  let dates: string[];
  if (terms.frequency === 'custom') {
    dates = [...(terms.customDates ?? [])];
    if (dates.length !== count) throw new Error('اكتب تاريخاً لكل قسط.');
    for (let i = 1; i < dates.length; i += 1) {
      if (dates[i]! <= dates[i - 1]!) throw new Error('تواريخ الأقساط تتصاعد.');
    }
  } else {
    dates = Array.from({ length: count }, (_, i) =>
      dueDateOf(terms.firstDueDate, terms.frequency as 'monthly', i),
    );
  }

  const instalments: ScheduledInstalment[] = dates.map((dueDate, i) => ({
    no: i + 1,
    dueDate,
    amountMinor: i === count - 1 ? financedMinor - base * (count - 1) : base,
  }));
  return { principalMinor, markupMinor, financedMinor, instalments };
}

/** Checks the terms against the store's rules; the Arabic reasons a cashier can fix, [] when it holds */
export function checkTerms(
  terms: Pick<InstalmentTerms, 'totalMinor' | 'downPaymentMinor' | 'count' | 'firstDueDate'>,
  settings: InstalmentSettings,
  today: string,
  opts: { minDownWaived?: boolean } = {},
): string[] {
  const problems: string[] = [];
  if (terms.count > settings.maxCount) problems.push(`أكثر عدد للأقساط ${settings.maxCount}.`);
  if (!opts.minDownWaived && terms.downPaymentMinor < minDownPayment(terms.totalMinor, settings)) {
    problems.push('الدفعة الأولى أقل من الحد الأدنى.');
  }
  if (terms.firstDueDate < today) problems.push('تاريخ أول قسط مضى.');
  if (daysBetween(today, terms.firstDueDate) > 120) problems.push('أول قسط بعيد أكثر من اللازم.');
  return problems;
}

export interface OpenInstalment {
  id: string;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
}

export interface Allocation {
  installmentId: string;
  amountMinor: number;
}

/**
 * Where a payment goes: the oldest open instalment first (the one the customer owes soonest), each
 * filled before the next. What is left after every open instalment is `unallocatedMinor` (more than
 * the plan: the store's debt to the customer, as a receipt already allows).
 */
export function allocatePayment(
  open: readonly OpenInstalment[],
  amountMinor: number,
): { allocations: Allocation[]; unallocatedMinor: number } {
  let left = Math.max(0, amountMinor);
  const allocations: Allocation[] = [];
  const order = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const item of order) {
    if (left <= 0) break;
    const room = item.amountMinor - item.paidMinor;
    if (room <= 0) continue;
    const take = Math.min(room, left);
    allocations.push({ installmentId: item.id, amountMinor: take });
    left -= take;
  }
  return { allocations, unallocatedMinor: left };
}

/** What an instalment is on a given day, derived and never stored */
export type InstalmentState = 'paid' | 'partial' | 'due_today' | 'late' | 'upcoming';

export function instalmentState(
  item: { dueDate: string; amountMinor: number; paidMinor: number },
  today: string,
): InstalmentState {
  if (item.paidMinor >= item.amountMinor) return 'paid';
  if (item.dueDate < today) return 'late';
  if (item.dueDate === today) return 'due_today';
  return item.paidMinor > 0 ? 'partial' : 'upcoming';
}

export const INSTALMENT_STATE_LABELS: Record<InstalmentState, string> = {
  paid: 'مسدّد',
  partial: 'مدفوع جزئياً',
  due_today: 'مستحق اليوم',
  late: 'متأخر',
  upcoming: 'قادم',
};

/** Whole days an instalment is late on `today` (0 when it is not late) */
export function daysLate(dueDate: string, today: string): number {
  return Math.max(0, daysBetween(dueDate, today));
}

/** The reminder text: {name} {amount} {due} {no} {of} {remaining} {store} filled in; the wording is the owner's to change later */
export function reminderText(
  kind: 'before' | 'due' | 'late',
  v: { name: string; amount: string; due: string; no: number; of: number; store: string; daysLate?: number },
): string {
  const head = `السلام عليكم ${v.name}،`;
  const line =
    kind === 'late'
      ? `نذكّركم بأن القسط رقم ${v.no} من ${v.of} بقيمة ${v.amount} كان مستحقاً بتاريخ ${v.due}${
          v.daysLate ? ` (تأخر ${v.daysLate} يوماً)` : ''
        }.`
      : kind === 'due'
        ? `نذكّركم بأن القسط رقم ${v.no} من ${v.of} بقيمة ${v.amount} مستحق اليوم.`
        : `نذكّركم بأن القسط رقم ${v.no} من ${v.of} بقيمة ${v.amount} يستحق بتاريخ ${v.due}.`;
  return `${head}\n${line}\nنرجو التفضل بالدفع. شكراً — ${v.store}`;
}

// ─── Amounts in words (the promissory note) ──────────────────────────────────

const ONES = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

/** 0..999 in words */
function belowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]!);
    else {
      const unit = rest % 10;
      parts.push(unit > 0 ? `${ONES[unit]!} و${TENS[Math.floor(rest / 10)]!}` : TENS[rest / 10]!);
    }
  }
  return parts.join(' و');
}

/** A scale word with its count: «ألف، ألفان، ثلاثة آلاف، أحد عشر ألفاً، مئة ألف» */
function scaled(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  const last = count % 100;
  if (last <= 2) return `${belowThousand(count)} ${one}`;
  return `${belowThousand(count)} ${last <= 10 ? few : many}`;
}

/**
 * A whole number in Arabic words, up to the trillions: 1,250,000 → «مليون ومئتان وخمسون ألفاً». For
 * the amount line of a note, where the words must agree with the figures.
 */
export function numberToArabicWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('a whole number from 0');
  if (value === 0) return 'صفر';
  const billions = Math.floor(value / 1_000_000_000_000);
  const milliards = Math.floor((value % 1_000_000_000_000) / 1_000_000_000);
  const millions = Math.floor((value % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (billions > 0) parts.push(scaled(billions, 'تريليون', 'تريليونان', 'تريليونات', 'تريليوناً'));
  if (milliards > 0) parts.push(scaled(milliards, 'مليار', 'ملياران', 'مليارات', 'ملياراً'));
  if (millions > 0) parts.push(scaled(millions, 'مليون', 'مليونان', 'ملايين', 'مليوناً'));
  if (thousands > 0) parts.push(scaled(thousands, 'ألف', 'ألفان', 'آلاف', 'ألفاً'));
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' و');
}
