import { z } from 'zod';
import { PROMOTION_KINDS, PROMOTION_SCOPES, type PromotionRule } from '../promotions';
import { CUSTOMER_KINDS } from './customers';
import { bpSchema, isoTimeSchema, uuidSchema, versionSchema } from './common';

/**
 * Promotions (packages/core › promotions.ts; 20 › العروض): the owner or a manager sets them on the
 * dashboard, every till pulls them (set `promotions`) and applies the best one to each line by
 * itself, online or not.
 *
 *   GET  /v1/promotions        catalog.manage   → { items: Promotion[] }
 *   POST /v1/promotions        catalog.manage   promotionInput → Promotion (201)
 *   PUT  /v1/promotions/{id}   catalog.manage   promotionInput & { version } → Promotion
 *
 * Stopping a promotion is `archived: true`; it stays in the list and in old receipts' reasons.
 */

export const PROMOTION_PRICE_TIERS = ['retail', 'wholesale'] as const;

/** «من 10 قطع: 5%»: one step of a tiered promotion */
export const promotionTierInput = z.object({
  minQty: z.int('اكتب عدد القطع').min(2, 'من قطعتين فأكثر').max(100_000, 'العدد كبير'),
  percentBp: bpSchema.refine((n) => n > 0, 'اكتب نسبة الخصم'),
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة 14:30');

export const promotionInput = z
  .object({
    name: z.string('اسم العرض مطلوب').trim().min(2, 'اسم العرض مطلوب').max(60, 'اسم العرض طويل'),
    kind: z.enum(PROMOTION_KINDS),
    percentBp: bpSchema.nullable().default(null),
    buyQty: z.int().min(1).max(100).nullable().default(null),
    getQty: z.int().min(1).max(100).nullable().default(null),
    /** tiered: «من 10 قطع 5%، من 50 قطعة 8%»; any other kind leaves it empty */
    tiers: z.array(promotionTierInput).max(10, 'عشر شرائح على الأكثر').default([]),
    /** free_item: the item that comes free, and how many of it for each buyQty bought */
    freeVariantId: uuidSchema.nullable().default(null),
    freeQty: z.int().min(1).max(100).nullable().default(null),
    /** Only these kinds of customers get it; empty: everyone */
    customerKinds: z.array(z.enum(CUSTOMER_KINDS)).max(20).default([]),
    /** Only customers on these price lists; empty: everyone */
    priceTiers: z.array(z.enum(PROMOTION_PRICE_TIERS)).max(2).default([]),
    /** Only on a rep's phone, not at the shop's till */
    repOnly: z.boolean().default(false),
    scope: z.enum(PROMOTION_SCOPES),
    categoryIds: z.array(uuidSchema).max(100).default([]),
    productIds: z.array(uuidSchema).max(500).default([]),
    startsAt: isoTimeSchema.nullable().default(null),
    endsAt: isoTimeSchema.nullable().default(null),
    daysOfWeek: z.array(z.int().min(0).max(6)).max(7).default([]),
    fromTime: timeSchema.nullable().default(null),
    toTime: timeSchema.nullable().default(null),
    /** «كود الخصم»: the customer types it in the online shop's cart; blank: the promotion runs by itself */
    couponCode: z
      .string()
      .trim()
      .min(3, 'الكود من 3 أحرف على الأقل')
      .max(20, 'الكود طويل')
      .refine((c) => [...c].every((ch) => /[\p{L}\p{N}_-]/u.test(ch)), 'حروف وأرقام وشرطة فقط')
      .nullable()
      .default(null),
    archived: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'percent' && !p.percentBp) {
      ctx.addIssue({ code: 'custom', path: ['percentBp'], message: 'اكتب نسبة الخصم' });
    }
    if (p.kind === 'buy_get') {
      if (!p.buyQty) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'كم قطعة يشتري الزبون؟' });
      if (!p.getQty) ctx.addIssue({ code: 'custom', path: ['getQty'], message: 'كم قطعة مجاناً؟' });
    }
    if (p.kind === 'tiered') {
      if (p.tiers.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'أضف شريحة واحدة على الأقل' });
      }
      const mins = p.tiers.map((t) => t.minQty);
      if (new Set(mins).size !== mins.length) {
        ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'لا تكرر عدد القطع في شريحتين' });
      }
    }
    if (p.kind === 'free_item') {
      if (!p.buyQty) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'كم قطعة يشتري الزبون؟' });
      if (!p.freeQty) ctx.addIssue({ code: 'custom', path: ['freeQty'], message: 'كم قطعة مجاناً؟' });
      if (!p.freeVariantId) {
        ctx.addIssue({ code: 'custom', path: ['freeVariantId'], message: 'اختر الصنف المجاني' });
      }
    }
    if ((p.kind === 'tiered' || p.kind === 'free_item') && p.couponCode) {
      ctx.addIssue({ code: 'custom', path: ['couponCode'], message: 'الكود لعروض الخصم والعبوات فقط' });
    }
    // The shop never offers a code to an audience-limited offer, so the owner is told instead of a code that never works
    // (a stopped offer is let through: an old row must still be stoppable)
    if (p.couponCode && !p.archived && (p.repOnly || p.customerKinds.length > 0 || p.priceTiers.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['couponCode'],
        message: 'الكود لا يعمل مع عرض مخصص لفئة من الزبائن أو للمندوب. أزل أحدهما',
      });
    }
    if (p.scope === 'categories' && p.categoryIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['categoryIds'], message: 'اختر تصنيفاً واحداً على الأقل' });
    }
    if (p.scope === 'products' && p.productIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'اختر منتجاً واحداً على الأقل' });
    }
    if ((p.fromTime === null) !== (p.toTime === null)) {
      ctx.addIssue({ code: 'custom', path: ['toTime'], message: 'حدد وقت البداية والنهاية معاً' });
    }
    if (p.startsAt && p.endsAt && Date.parse(p.endsAt) <= Date.parse(p.startsAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'النهاية بعد البداية' });
    }
  });
export type PromotionInput = z.input<typeof promotionInput>;
export type PromotionData = z.output<typeof promotionInput>;

export const promotionUpdateInput = z.object({ version: versionSchema }).and(promotionInput);
export type PromotionUpdateInput = z.input<typeof promotionUpdateInput>;

/** `POST /v1/promotions/{id}/archive`: stop (`archived: true`) or restart an offer, whatever else is in the row */
export const promotionArchiveInput = z.object({ version: versionSchema, archived: z.boolean() });
export type PromotionArchiveInput = z.input<typeof promotionArchiveInput>;

/** A promotion as the dashboard reads it and as the `promotions` pull set carries it. */
export interface PromotionRow extends PromotionRule {
  version: number;
}

export type Promotion = PromotionRow & { updatedAt: string };

/**
 * `GET /v1/promotions/report?from&to` (catalog.manage): what each offer did at the tills in a period
 * (the sales whose lines carry it as the reason of a `promotion` discount; a return is not netted off).
 * One row per offer name and invoice currency, the biggest discount first.
 */
export const promotionReportQuery = z.object({
  from: z.iso.date('اكتب تاريخ البداية'),
  to: z.iso.date('اكتب تاريخ النهاية'),
});
export type PromotionReportQuery = z.input<typeof promotionReportQuery>;

export interface PromotionReportRow {
  /** The offer's name as printed on the receipts */
  name: string;
  currency: string;
  /** Sales that carry it */
  invoices: number;
  /** Pieces sold under it, in whole pieces (thousandths kept) */
  pieces: number;
  /** What the offer took off the price, in the invoice currency's minor units */
  discountMinor: number;
  /** What those lines were sold for after it */
  netMinor: number;
  /** Pieces given free (a «اشترِ وخذ مجاناً» line at price 0) */
  freePieces: number;
}
export interface PromotionReport {
  from: string;
  to: string;
  items: PromotionReportRow[];
}

/** `POST /v1/promotions/preview` (catalog.manage): how many products an offer's scope touches, before it is saved */
export const promotionPreviewInput = z.object({
  scope: z.enum(PROMOTION_SCOPES),
  categoryIds: z.array(uuidSchema).max(100).default([]),
  productIds: z.array(uuidSchema).max(500).default([]),
});
export type PromotionPreviewInput = z.input<typeof promotionPreviewInput>;
export interface PromotionPreview {
  /** Active products for sale the scope reaches */
  products: number;
  /** A few of their names */
  sample: string[];
}
