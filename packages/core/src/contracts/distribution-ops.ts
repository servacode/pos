import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, nonNegativeMinorSchema, uuidSchema } from './common';
import {
  moneyByCurrencySchema,
  type CommissionPlanRow,
  type MoneyByCurrency,
  type SettlementStatus,
  type SettlementTreatment,
  type TargetMetric,
  type TargetScope,
} from './distribution';

/**
 * «تسوية المندوب» (RST), the day board, targets, commissions and the distribution reports, the
 * supervisor's evening and monthly side of docs/specs/32-sales-reps.md. Everything here is a record or a
 * report: a settlement posts nothing itself (the rep's cash is already in his shift drawer and the
 * safe drops), it only compares what he should hand over with what was counted, and — once the
 * supervisor approves — unloads the van through the ordinary van count (stocktake) and transfer.
 *
 *   GET  /v1/rep-settlements/preview?repId&date      SettlementPreview      (rep.settle)
 *   GET  /v1/rep-settlements                         RepSettlementRow[]
 *   POST /v1/rep-settlements                         repSettlementCreateInput → RepSettlementDetail
 *   GET  /v1/rep-settlements/{id}                    RepSettlementDetail
 *   POST /v1/rep-settlements/{id}/approve            { version } → RepSettlementDetail
 *   POST /v1/rep-settlements/{id}/cancel             { version, reason } → RepSettlementDetail
 *   POST /v1/device/rep/van-count                    repVanCountInput → { id }   (a rep_phone's blind count)
 *   GET  /v1/distribution/today?date                 TodayBoard              (report.view)
 *   GET/POST/PUT/DELETE /v1/rep-targets              RepTargetRow            (rep.targets)
 *   GET  /v1/distribution/reports/{kind}?from&to&repId   DistributionReport (report.view)
 */

// ─── The van count a phone sends ────────────────────────────────────────────

/** The blind count the rep typed at the end of the day: what was on the van's floor, never the book's figure */
export const repVanCountInput = z.object({
  businessDate: isoDateSchema,
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        /** Base units on the shelf, thousandths */
        counted: z.int().nonnegative().max(1_000_000_000),
      }),
    )
    .max(5000),
});
export type RepVanCountInput = z.output<typeof repVanCountInput>;

export interface VanCountRecord {
  at: string;
  lines: { variantId: string; counted: number }[];
}

// ─── The settlement ─────────────────────────────────────────────────────────

/** One currency of the rep's drawer for the day, by the formula of the shift report */
export interface SettlementCashLine {
  currency: CurrencyCode;
  openingMinor: number;
  cashSalesMinor: number;
  changeGivenMinor: number;
  refundsMinor: number;
  receiptsMinor: number;
  payInMinor: number;
  payOutMinor: number;
  /** Handed over already by a safe drop (the supervisor's PIN) */
  dropsMinor: number;
  /** What the rep counted when he closed his shift, when he did */
  closingCountedMinor: number | null;
  /** What he should hand over in all: the drawer before any drop */
  expectedMinor: number;
}

export interface SettlementCheque {
  sourceType: 'sale' | 'receipt';
  sourceId: string;
  number: string;
  customerName: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  reference: string | null;
  dueDate: string | null;
}

export interface SettlementItem {
  variantId: string;
  name: string;
  /** What the van's book holds now, thousandths */
  expectedQty: number;
  /** What was counted (the phone's count, or the supervisor's own); null: nobody counted it */
  countedQty: number | null;
  diffQty: number | null;
}

export interface SettlementShift {
  id: string;
  number: string | null;
  status: 'open' | 'closed';
  closedAt: string | null;
}

export interface SettlementPreview {
  repId: string;
  repName: string;
  businessDate: string;
  branchId: string;
  vanBranchId: string | null;
  vanName: string | null;
  /** Where the unloaded goods go */
  unloadBranchId: string | null;
  unloadBranchName: string | null;
  baseCurrency: CurrencyCode;
  shifts: SettlementShift[];
  cash: SettlementCashLine[];
  sales: {
    count: number;
    totalMinor: number;
    returnsCount: number;
    returnsTotalMinor: number;
    receiptsCount: number;
    visits: number;
  };
  cheques: SettlementCheque[];
  items: SettlementItem[];
  /** The phone sent its count at */
  vanCountAt: string | null;
  /** The phone's last report of documents it still held; 0 when unknown */
  pendingDocs: number;
  /** The day ends with the goods staying in the van: no unloading transfer */
  keepStockInVan: boolean;
  /** A settlement that already covers this rep and day */
  existing: { id: string; number: string; status: SettlementStatus } | null;
}

export const repSettlementCreateInput = z.object({
  repId: uuidSchema,
  businessDate: isoDateSchema,
  /** What the supervisor counted from the rep, per currency */
  countedCash: moneyByCurrencySchema,
  treatment: z.enum(['rep_debt', 'shop_loss']).nullable().optional(),
  note: z
    .string()
    .trim()
    .max(300, 'الملاحظة طويلة')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  /** The supervisor's own count of the van, when the phone sent none or he counted again: replaces the phone's */
  vanCount: z
    .array(z.object({ variantId: uuidSchema, countedQty: nonNegativeMinorSchema }))
    .max(5000)
    .optional(),
  /** The cheques he received from the rep (ids of the sale or receipt); the rest stay unmatched */
  receivedCheques: z.array(uuidSchema).max(2000).optional(),
});
export type RepSettlementCreateInput = z.output<typeof repSettlementCreateInput>;

export const settlementApproveInput = z.object({ version: z.int().min(1) });
export const settlementCancelInput = z.object({
  version: z.int().min(1),
  reason: z.string().trim().min(2, 'اكتب سبب الإلغاء').max(200, 'السبب طويل'),
});

export const settlementListQuery = z.object({
  repId: uuidSchema.optional(),
  status: z.enum(['draft', 'approved', 'cancelled']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type SettlementListQuery = z.output<typeof settlementListQuery>;

export const settlementPreviewQuery = z.object({ repId: uuidSchema, date: isoDateSchema });

export interface SettlementGoods {
  /** The count was made and the book was settled to it; false: no count, nothing moved */
  counted: boolean;
  stocktakeId: string | null;
  stocktakeNumber: string | null;
  transferId: string | null;
  transferNumber: string | null;
  lines: SettlementItem[];
}

export interface RepSettlementDetail {
  id: string;
  number: string;
  repId: string;
  repName: string;
  businessDate: string;
  status: SettlementStatus;
  expectedCash: MoneyByCurrency;
  countedCash: MoneyByCurrency;
  cashDifference: Record<string, number>;
  treatment: SettlementTreatment | null;
  pendingDocs: number;
  approvedAt: string | null;
  approvedByName: string | null;
  createdByName: string | null;
  note: string | null;
  version: number;
  /** What the settlement saw when it was made */
  preview: SettlementPreview;
  cheques: { received: string[]; unmatched: SettlementCheque[] };
  goods: SettlementGoods;
}

// ─── The day board ──────────────────────────────────────────────────────────

export type BoardStopStatus =
  'todo' | 'here' | 'sale' | 'order' | 'collection' | 'return' | 'no_sale' | 'none';

export interface BoardStop {
  customerId: string;
  name: string;
  status: BoardStopStatus;
  arrivedAt: string | null;
}

export interface BoardRep {
  repId: string;
  name: string;
  vanName: string | null;
  /** Not started, started, ended */
  day: 'none' | 'open' | 'closed';
  routeNames: string[];
  stops: BoardStop[];
  planned: number;
  /** Planned customers he has visited (never more than `planned`) */
  visited: number;
  /** Customers visited that are not on today's route */
  extraVisited: number;
  /** The customer he is with now, from a visit that has not ended */
  currentCustomer: string | null;
  lastVisitAt: string | null;
  sales: number;
  orders: number;
  collections: number;
  returns: number;
  noSales: number;
  salesTotalMinor: number;
  collectedMinor: number;
}

export interface TodayBoard {
  date: string;
  baseCurrency: CurrencyCode;
  reps: BoardRep[];
}

export const boardQuery = z.object({ date: isoDateSchema.optional() });

// ─── Targets ────────────────────────────────────────────────────────────────

export const repTargetUpdateInput = z.object({
  targetValue: nonNegativeMinorSchema,
  version: z.int().min(1),
});

export const repTargetListQuery = z.object({
  repId: uuidSchema.optional(),
  /** «2026-11»: the targets whose period touches this month */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

export interface RepTargetRow {
  id: string;
  repId: string;
  repName: string;
  periodStart: string;
  periodEnd: string;
  metric: TargetMetric;
  scope: TargetScope;
  productId: string | null;
  categoryId: string | null;
  /** The product's or category's name, for the screen */
  scopeName: string | null;
  targetValue: number;
  actualValue: number;
  /** actual over target, whole percent; null when the target is 0 */
  percent: number | null;
  version: number;
}

export const TARGET_METRIC_LABELS: Record<TargetMetric, string> = {
  net_sales: 'صافي المبيعات',
  collections: 'التحصيل',
  new_customers: 'زبائن جدد',
  qty: 'الكمية المباعة',
};

// ─── Commissions (report only) ──────────────────────────────────────────────

/**
 * What a rep earns under a plan for a period. `baseMinor` is what the plan counts (his sales or his
 * collections), `returnsMinor` what came back; a plan that deducts returns takes them off. A flat plan
 * pays its rate on the base. A tiered plan pays the rate of the highest tier the base reaches on the
 * whole base (not slice by slice). Nothing is posted: the owner pays it as he sees fit.
 */
export function commissionOf(
  plan: Pick<CommissionPlanRow, 'mode' | 'rateBp' | 'tiers' | 'returnsEffect'>,
  baseMinor: number,
  returnsMinor: number,
): { netMinor: number; rateBp: number; commissionMinor: number } {
  const netMinor = Math.max(0, plan.returnsEffect === 'deduct' ? baseMinor - returnsMinor : baseMinor);
  let rateBp = 0;
  if (plan.mode === 'flat') {
    rateBp = plan.rateBp ?? 0;
  } else {
    for (const tier of plan.tiers ?? []) {
      if (netMinor >= tier.fromMinor && tier.rateBp >= 0) rateBp = tier.rateBp;
    }
  }
  return { netMinor, rateBp, commissionMinor: Math.round((netMinor * rateBp) / 10_000) };
}

// ─── Reports ────────────────────────────────────────────────────────────────

export const DISTRIBUTION_REPORT_KINDS = [
  'sales_by_rep',
  'sales_by_route',
  'sales_by_customer',
  'sales_by_product',
  'collections',
  'overdue_by_rep',
  'van_stock',
  'returns_rate',
  'visits',
  'no_sale_reasons',
  'targets',
  'commissions',
] as const;
export type DistributionReportKind = (typeof DISTRIBUTION_REPORT_KINDS)[number];

export const DISTRIBUTION_REPORT_LABELS: Record<DistributionReportKind, string> = {
  sales_by_rep: 'المبيعات حسب المندوب',
  sales_by_route: 'المبيعات حسب الخط',
  sales_by_customer: 'المبيعات حسب الزبون',
  sales_by_product: 'المبيعات حسب المنتج',
  collections: 'التحصيل',
  overdue_by_rep: 'الذمم المتأخرة حسب المندوب',
  van_stock: 'مخزون السيارات',
  returns_rate: 'نسبة المرتجع',
  visits: 'الزيارات',
  no_sale_reasons: 'أسباب عدم البيع',
  targets: 'الأهداف والمحقق',
  commissions: 'العمولات',
};

export const distributionReportQuery = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  repId: uuidSchema.optional(),
});
export type DistributionReportQuery = z.output<typeof distributionReportQuery>;

/** How a column reads: money in the store's currency, a quantity in thousandths, a whole number, a percent, a date or words; `metric` reads as the row's own `metric` says (money, quantity or a count); a row with a `currency` shows its money in that currency */
export type ReportColumnKind = 'text' | 'money' | 'qty' | 'int' | 'percent' | 'date' | 'metric';

export interface DistributionReport {
  kind: DistributionReportKind;
  from: string;
  to: string;
  baseCurrency: CurrencyCode;
  columns: { key: string; label: string; kind: ReportColumnKind }[];
  rows: Record<string, string | number | null>[];
  /** A footer of the columns that add up; null where they do not */
  totals: Record<string, string | number | null> | null;
  /** A line under the table saying how the figures are made */
  note: string | null;
}
