import { z } from 'zod';
import { PROMOTION_KINDS, PROMOTION_SCOPES, type PromotionRule } from '../promotions';
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

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة 14:30');

export const promotionInput = z
  .object({
    name: z.string('اسم العرض مطلوب').trim().min(2, 'اسم العرض مطلوب').max(60, 'اسم العرض طويل'),
    kind: z.enum(PROMOTION_KINDS),
    percentBp: bpSchema.nullable().default(null),
    buyQty: z.int().min(1).max(100).nullable().default(null),
    getQty: z.int().min(1).max(100).nullable().default(null),
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

/** A promotion as the dashboard reads it and as the `promotions` pull set carries it. */
export interface PromotionRow extends PromotionRule {
  version: number;
}

export type Promotion = PromotionRow & { updatedAt: string };
