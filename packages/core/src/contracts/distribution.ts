import { z } from 'zod';
import {
  bpSchema,
  isoDateSchema,
  isoTimeSchema,
  nonNegativeMinorSchema,
  uuidSchema,
  versionSchema,
} from './common';

/**
 * «المندوبون والتوزيع» (docs/specs/32-sales-reps.md, 31-warehouses.md): a rep sells and collects in the
 * market from his phone, a supervisor plans the routes and settles each rep's day. Built on the
 * ordinary engine: a van is a branch of kind `van` (stock moves with transfers and stocktakes), the
 * rep's phone is a device of kind `rep_phone` paired to that branch, his cash is his shift drawer
 * (account 1110), and a pre-sale order (`sales_order`, series SO) posts nothing until it is invoiced
 * as an ordinary sale that names it. The whole module is behind `plans.limits.reps` (0 or missing:
 * hidden, the routes answer 403 plan_limit_reached).
 *
 *   GET  /v1/regions                       RegionRow[]                       (routes.manage)
 *   POST /v1/regions                       regionInput → RegionRow
 *   PATCH /v1/regions/{id}                 regionUpdateInput → RegionRow
 *   GET  /v1/vans                          VanRow[]
 *   POST /v1/vans                          vanInput → VanRow
 *   PATCH /v1/vans/{id}                    vanInput → VanRow
 *   POST /v1/vans/{id}/active              { active } → VanRow
 *   GET  /v1/reps                          RepRow[]
 *   POST /v1/reps                          repInput → RepRow
 *   PATCH /v1/reps/{id}                    repUpdateInput → RepRow
 *   POST /v1/reps/{id}/active              { active } → RepRow
 *   GET  /v1/routes                        RouteRow[]
 *   POST /v1/routes                        routeInput → RouteDetail
 *   GET  /v1/routes/{id}                   RouteDetail
 *   PATCH /v1/routes/{id}                  routeUpdateInput → RouteDetail
 *   PUT  /v1/routes/{id}/customers         routeCustomersInput → RouteDetail
 */

// ─── Settings ───────────────────────────────────────────────────────────────

/** `tenant_settings.distribution`; null in the row means these defaults */
export interface DistributionSettings {
  /** A customer a rep adds waits for the supervisor's approval, and gets cash sales only until then */
  requireCustomerApproval: boolean;
  /** A visit to a customer who is not on today's route needs a reason */
  offRouteNeedsReason: boolean;
  /** The phone records where a visit happened (needs the rep's consent, named in the privacy text) */
  gps: boolean;
  /** The van keeps its stock overnight; otherwise the day ends with an unloading transfer */
  keepStockInVanOvernight: boolean;
  /** A return taken on the phone waits for the supervisor */
  returnsNeedApproval: boolean;
  /** Days a pre-sale order holds its goods before it expires */
  orderHoldDays: number;
  /** When a pre-sale order becomes an invoice: at delivery, or at once when it is taken */
  invoiceOrdersAt: 'delivery' | 'order';
}

export const DISTRIBUTION_DEFAULTS: DistributionSettings = {
  requireCustomerApproval: true,
  offRouteNeedsReason: true,
  gps: false,
  keepStockInVanOvernight: false,
  returnsNeedApproval: false,
  orderHoldDays: 7,
  invoiceOrdersAt: 'delivery',
};

export const distributionSettingsInput = z.object({
  requireCustomerApproval: z.boolean(),
  offRouteNeedsReason: z.boolean(),
  gps: z.boolean(),
  keepStockInVanOvernight: z.boolean(),
  returnsNeedApproval: z.boolean(),
  orderHoldDays: z.int().min(1).max(90),
  invoiceOrdersAt: z.enum(['delivery', 'order']),
});

/** The stored value (or null) with the defaults filling what the owner never chose */
export function distributionSettingsOf(
  stored: Record<string, unknown> | null | undefined,
): DistributionSettings {
  const parsed = distributionSettingsInput.partial().safeParse(stored ?? {});
  return { ...DISTRIBUTION_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
}

// ─── No-sale reasons ────────────────────────────────────────────────────────

/** The reasons every store starts with (migration 0073 and registration write the same list) */
export const DEFAULT_NO_SALE_REASONS: readonly { key: string; name: string; sortOrder: number }[] = [
  { key: 'closed', name: 'المحل مغلق', sortOrder: 1 },
  { key: 'no_need', name: 'لا يحتاج بضاعة الآن', sortOrder: 2 },
  { key: 'has_stock', name: 'لديه مخزون كافٍ', sortOrder: 3 },
  { key: 'owner_absent', name: 'صاحب القرار غير موجود', sortOrder: 4 },
  { key: 'postponed', name: 'طلب الزيارة لاحقاً', sortOrder: 5 },
  { key: 'overdue', name: 'عليه ذمم متأخرة', sortOrder: 6 },
  { key: 'competitor', name: 'يشتري من منافس', sortOrder: 7 },
  { key: 'other', name: 'سبب آخر', sortOrder: 8 },
];

// ─── Shared pieces ──────────────────────────────────────────────────────────

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** 0 = Sunday … 6 = Saturday, as `Date.getUTCDay()` counts them */
export const weekdaySchema = z.int().min(0).max(6);
export const WEEKDAY_LABELS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

/** Money per currency in minor units: { SYP: 150000, USD: 2500 } */
export const moneyByCurrencySchema = z.record(z.string().regex(/^[A-Z]{3}$/), nonNegativeMinorSchema);
export type MoneyByCurrency = z.output<typeof moneyByCurrencySchema>;

export const activeInput = z.object({ active: z.boolean('حدّد التشغيل أو الإيقاف') });

// ─── Regions ────────────────────────────────────────────────────────────────

export const regionInput = z.object({
  name: z.string('اسم المنطقة مطلوب').trim().min(2, 'اكتب اسم المنطقة').max(60, 'الاسم طويل'),
  /** A region may sit under another (a city under a governorate); null: top level */
  parentId: uuidSchema.nullable().optional(),
  sortOrder: z.int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export type RegionInput = z.output<typeof regionInput>;
export const regionUpdateInput = regionInput.extend({ version: versionSchema });
export type RegionUpdateInput = z.output<typeof regionUpdateInput>;

export interface RegionRow {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Customers placed in it */
  customerCount: number;
  version: number;
}

// ─── Vans (branches of kind van) ────────────────────────────────────────────

export const BRANCH_KINDS = ['store', 'van'] as const;
export type BranchKind = (typeof BRANCH_KINDS)[number];

export const vanInput = z.object({
  name: z.string('اسم السيارة مطلوب').trim().min(2, 'اكتب اسم السيارة').max(60, 'الاسم طويل'),
  /** The branch it is loaded from and unloaded to */
  parentBranchId: uuidSchema,
  vehiclePlate: optionalText(20, 'رقم اللوحة طويل'),
});
export type VanInput = z.output<typeof vanInput>;

export interface VanRow {
  id: string;
  code: string;
  name: string;
  parentBranchId: string;
  parentBranchName: string;
  vehiclePlate: string | null;
  isActive: boolean;
  /** The rep who drives it, if one is set */
  repId: string | null;
  repName: string | null;
}

// ─── Reps ───────────────────────────────────────────────────────────────────

/** van: sells and delivers from his van; presale: takes orders and carries nothing; both */
export const REP_MODES = ['van', 'presale', 'both'] as const;
export type RepMode = (typeof REP_MODES)[number];
export const REP_MODE_LABELS: Record<RepMode, string> = {
  van: 'بيع من السيارة',
  presale: 'طلبيات بيع مسبق',
  both: 'الاثنان معاً',
};

export const repInput = z.object({
  /** The user he signs in as (a staff member with the rep role) */
  userId: uuidSchema,
  /** The branch he is loaded from and settles in */
  branchId: uuidSchema,
  /** His van, a branch of kind van; null for a rep who is not given one yet */
  vanBranchId: uuidSchema.nullable().optional(),
  mode: z.enum(REP_MODES).optional(),
  /** Most discount he may give, basis points; null: his role's limit */
  maxDiscountBp: bpSchema.nullable().optional(),
  /** Most credit he may give in a day, base currency; null: no limit */
  dailyCreditLimitMinor: nonNegativeMinorSchema.nullable().optional(),
  commissionPlanId: uuidSchema.nullable().optional(),
  note: optionalText(300, 'الملاحظة طويلة'),
});
export type RepInput = z.output<typeof repInput>;
/** The user of a rep never changes: stop him and add another */
export const repUpdateInput = repInput.omit({ userId: true }).extend({ version: versionSchema });
export type RepUpdateInput = z.output<typeof repUpdateInput>;

export interface RepRow {
  id: string;
  userId: string;
  userName: string;
  branchId: string;
  branchName: string;
  vanBranchId: string | null;
  vanName: string | null;
  vehiclePlate: string | null;
  deviceId: string | null;
  deviceName: string | null;
  mode: RepMode;
  maxDiscountBp: number | null;
  dailyCreditLimitMinor: number | null;
  commissionPlanId: string | null;
  isActive: boolean;
  note: string | null;
  routeCount: number;
  version: number;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const routeInput = z.object({
  name: z.string('اسم الخط مطلوب').trim().min(2, 'اكتب اسم الخط').max(60, 'الاسم طويل'),
  regionId: uuidSchema.nullable().optional(),
  /** The days the rep visits it */
  weekdays: z.array(weekdaySchema).max(7).optional(),
  /** The rep responsible for it */
  repId: uuidSchema.nullable().optional(),
  sortOrder: z.int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export type RouteInput = z.output<typeof routeInput>;
export const routeUpdateInput = routeInput.extend({ version: versionSchema });
export type RouteUpdateInput = z.output<typeof routeUpdateInput>;

/** The customers on a route in visiting order; the list replaces the route's whole list */
export const routeCustomersInput = z.object({
  customerIds: z.array(uuidSchema).max(2000, 'خط السير يتسع لألفي زبون'),
  version: versionSchema,
});
export type RouteCustomersInput = z.output<typeof routeCustomersInput>;

export interface RouteRow {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
  weekdays: number[];
  repId: string | null;
  repName: string | null;
  sortOrder: number;
  isActive: boolean;
  customerCount: number;
  version: number;
}

export interface RouteCustomer {
  customerId: string;
  name: string;
  phone: string | null;
  regionId: string | null;
  visitOrder: number;
}

export interface RouteDetail extends RouteRow {
  customers: RouteCustomer[];
}

// ─── Customers waiting for the supervisor ───────────────────────────────────

export const CUSTOMER_APPROVALS = ['approved', 'pending', 'rejected'] as const;
export type CustomerApproval = (typeof CUSTOMER_APPROVALS)[number];

// ─── Pre-sale orders (sales_order, series SO) ───────────────────────────────

export const SALES_ORDER_STATUSES = ['open', 'partial', 'delivered', 'cancelled', 'expired'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  open: 'مفتوحة',
  partial: 'مسلّمة جزئياً',
  delivered: 'مسلّمة',
  cancelled: 'ملغاة',
  expired: 'منتهية',
};
/** An order that still holds goods for the customer */
export const salesOrderOpen = (status: SalesOrderStatus): boolean =>
  status === 'open' || status === 'partial';

export const salesOrderLineSchema = z.object({
  variantId: uuidSchema,
  /** Base units ordered, thousandths (12.5 kg is 12500) */
  qty: z.int().positive().max(1_000_000_000),
  /** What has been delivered of it so far; the server keeps it, a phone sends 0 */
  deliveredQty: z.int().nonnegative().max(1_000_000_000).default(0),
  /** The price the customer was given for one base unit, minor units of the order's currency */
  unitPriceMinor: nonNegativeMinorSchema,
});
export type SalesOrderLine = z.output<typeof salesOrderLineSchema>;

/** The `sales_order` document a phone sends: nothing is posted, the goods are only promised */
export const salesOrderPayloadSchema = z.object({
  customerId: uuidSchema,
  /** Where it is filled from */
  warehouseBranchId: uuidSchema,
  repId: uuidSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(salesOrderLineSchema).min(1, 'أضف بنداً واحداً على الأقل').max(500),
  totalMinor: nonNegativeMinorSchema,
  /** A deposit taken with it (its receipt is a document of its own) */
  depositMinor: nonNegativeMinorSchema.default(0),
  depositReceiptId: uuidSchema.nullable().default(null),
  deliveryDate: isoDateSchema.nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
export type SalesOrderPayload = z.output<typeof salesOrderPayloadSchema>;

export interface SalesOrderRow {
  id: string;
  number: string;
  status: SalesOrderStatus;
  customerId: string;
  customerName: string;
  warehouseBranchId: string;
  repId: string | null;
  repName: string | null;
  businessDate: string;
  currency: string;
  totalMinor: number;
  depositMinor: number;
  deliveryDate: string | null;
  holdUntil: string | null;
  lines: SalesOrderLine[];
  version: number;
}

// ─── The rep's day and visits ───────────────────────────────────────────────

export const REP_DAY_STATUSES = ['open', 'closed'] as const;
export type RepDayStatus = (typeof REP_DAY_STATUSES)[number];

/** Starting the day: his cash float per currency; the van's load is confirmed separately */
export const repDayOpenInput = z.object({
  businessDate: isoDateSchema,
  openingCash: moneyByCurrencySchema.default({}),
});
export type RepDayOpenInput = z.output<typeof repDayOpenInput>;

export interface RepDayRow {
  id: string;
  repId: string;
  businessDate: string;
  status: RepDayStatus;
  startedAt: string | null;
  endedAt: string | null;
  openingCash: MoneyByCurrency;
  loadConfirmedAt: string | null;
  visits: number;
}

export const VISIT_OUTCOMES = ['sale', 'order', 'collection', 'return', 'no_sale', 'none'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const VISIT_OUTCOME_LABELS: Record<VisitOutcome, string> = {
  sale: 'بيع',
  order: 'طلبية',
  collection: 'تحصيل',
  return: 'مرتجع',
  no_sale: 'بلا بيع',
  none: 'زيارة فقط',
};

export const repVisitInput = z
  .object({
    id: uuidSchema,
    repDayId: uuidSchema,
    customerId: uuidSchema,
    routeId: uuidSchema.nullable().default(null),
    offRoute: z.boolean().default(false),
    arrivedAt: isoTimeSchema,
    leftAt: isoTimeSchema.nullable().default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    outcome: z.enum(VISIT_OUTCOMES).default('none'),
    noSaleReasonId: uuidSchema.nullable().default(null),
    docIds: z.array(uuidSchema).max(50).default([]),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === 'no_sale' && !v.noSaleReasonId) {
      ctx.addIssue({ code: 'custom', path: ['noSaleReasonId'], message: 'اختر سبب عدم البيع' });
    }
    if ((v.lat === null) !== (v.lng === null)) {
      ctx.addIssue({ code: 'custom', path: ['lng'], message: 'الموقع خط عرض وخط طول معاً' });
    }
  });
export type RepVisitInput = z.output<typeof repVisitInput>;

// ─── Settlement (RST), targets, commissions ─────────────────────────────────

export const SETTLEMENT_STATUSES = ['draft', 'approved', 'cancelled'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: 'مسودة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
};

/** What a shortfall becomes: a debt on the rep (1250) or a loss for the shop (6200 cash, 6300 goods) */
export const SETTLEMENT_TREATMENTS = ['rep_debt', 'shop_loss'] as const;
export type SettlementTreatment = (typeof SETTLEMENT_TREATMENTS)[number];
export const SETTLEMENT_TREATMENT_LABELS: Record<SettlementTreatment, string> = {
  rep_debt: 'ذمة على المندوب',
  shop_loss: 'خسارة على المحل',
};

export const repSettlementInput = z.object({
  repId: uuidSchema,
  businessDate: isoDateSchema,
  /** What the supervisor counted, per currency */
  countedCash: moneyByCurrencySchema,
  treatment: z.enum(SETTLEMENT_TREATMENTS).nullable().optional(),
  note: optionalText(300, 'الملاحظة طويلة'),
});
export type RepSettlementInput = z.output<typeof repSettlementInput>;

export interface RepSettlementRow {
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
  note: string | null;
  version: number;
}

export const TARGET_METRICS = ['net_sales', 'collections', 'new_customers', 'qty'] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const TARGET_SCOPES = ['all', 'product', 'category'] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];

export const repTargetInput = z
  .object({
    repId: uuidSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    metric: z.enum(TARGET_METRICS),
    scope: z.enum(TARGET_SCOPES).default('all'),
    productId: uuidSchema.nullable().default(null),
    categoryId: uuidSchema.nullable().default(null),
    /** Money in base-currency minor units, a quantity in thousandths, a count as it is */
    targetValue: nonNegativeMinorSchema,
  })
  .superRefine((t, ctx) => {
    if (t.periodEnd < t.periodStart) {
      ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'نهاية الفترة قبل بدايتها' });
    }
    if (t.scope === 'product' && !t.productId) {
      ctx.addIssue({ code: 'custom', path: ['productId'], message: 'اختر المنتج' });
    }
    if (t.scope === 'category' && !t.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'اختر التصنيف' });
    }
  });
export type RepTargetInput = z.output<typeof repTargetInput>;

export const COMMISSION_BASES = ['sales', 'collections'] as const;
export const COMMISSION_MODES = ['flat', 'tiered'] as const;
export const COMMISSION_RETURNS_EFFECTS = ['deduct', 'ignore'] as const;

export const commissionPlanInput = z
  .object({
    name: z.string('اسم الخطة مطلوب').trim().min(2, 'اكتب اسم الخطة').max(60, 'الاسم طويل'),
    basis: z.enum(COMMISSION_BASES).default('sales'),
    mode: z.enum(COMMISSION_MODES).default('flat'),
    rateBp: bpSchema.nullable().default(null),
    /** For mode tiered: from this much (base currency minor units) the rate applies */
    tiers: z
      .array(z.object({ fromMinor: nonNegativeMinorSchema, rateBp: bpSchema }))
      .max(10)
      .nullable()
      .default(null),
    returnsEffect: z.enum(COMMISSION_RETURNS_EFFECTS).default('deduct'),
    isActive: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.mode === 'flat' && p.rateBp === null) {
      ctx.addIssue({ code: 'custom', path: ['rateBp'], message: 'اكتب نسبة العمولة' });
    }
    if (p.mode === 'tiered' && (!p.tiers || p.tiers.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'أضف شريحة واحدة على الأقل' });
    }
  });
export type CommissionPlanInput = z.output<typeof commissionPlanInput>;
