import { sql } from 'drizzle-orm';
import { promotionActive, type PromotionRule, type SalePayload } from '@serva/core';
import type { Transaction } from '@serva/db';
import type { SyncFlag } from '@serva/sync';

/** The offers a till code may open: the same kinds the online shop accepts (services/shop.ts › COUPON_KINDS) */
const COUPON_KINDS: readonly string[] = ['percent', 'buy_get'];

interface GroupRow extends Record<string, unknown> {
  group_id: string | null;
  bps: number | null;
  archived: boolean | null;
}

/**
 * «خصم المجموعة» (round A5): an invoice discount that names a customer group must be the group of the
 * sale's own customer and no more than the group's percent. A till cannot invent or inflate it: the sale
 * stands (08 › قاعدة 8, accept-and-flag), and the owner is told with group_discount_mismatch.
 * A group the owner archived or changed after the till last pulled it is the till's honest lag, so only a
 * percent above the group's current one, another group, a missing customer or an amount form is flagged.
 */
export async function groupDiscountFlags(tx: Transaction, sale: SalePayload): Promise<SyncFlag[]> {
  const discount = sale.invoiceDiscount;
  if (!discount?.groupId) return [];
  if (discount.type !== 'percent' || !sale.customerId) return ['group_discount_mismatch'];
  const [row] = await tx.execute<GroupRow>(sql`
    select c.group_id, g.discount_bps as bps, g.archived_at is not null as archived
    from customers c left join customer_groups g on g.tenant_id = c.tenant_id and g.id = c.group_id
    where c.id = ${sale.customerId}::uuid`);
  if (!row || row.group_id !== discount.groupId || row.bps === null) return ['group_discount_mismatch'];
  return discount.bp > row.bps ? ['group_discount_mismatch'] : [];
}

interface CouponRow extends Record<string, unknown> {
  id: string;
  name: string;
  kind: PromotionRule['kind'];
  coupon_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  days_of_week: number[] | null;
  from_time: string | null;
  to_time: string | null;
  archived_at: string | null;
}

/**
 * A code typed at the till (round A5): a line whose discount names a promotion that has a coupon code must
 * name an offer of a kind the shop's codes may open, that was running when the sale was made (the device's own
 * time, corrected by its offset: a sale sent late is judged by when it was made), and not archived before then.
 * Same rule as an online order's code (services/shop.ts › couponRule); the sale stands and is flagged coupon_invalid.
 */
export async function couponFlags(tx: Transaction, sale: SalePayload, madeAt: Date): Promise<SyncFlag[]> {
  // A shop order's code was checked when the customer placed it; the sale of it may come after the offer ended
  if (sale.onlineOrderId) return [];
  const ids = [
    ...new Set(
      sale.lines.flatMap((l) =>
        l.discount?.source === 'promotion' && l.discount.promotionId ? [l.discount.promotionId] : [],
      ),
    ),
  ];
  if (ids.length === 0) return [];
  const [tenant] = await tx.execute<{ timezone: string | null }>(sql`select timezone from tenants limit 1`);
  const zone = tenant?.timezone ?? 'Asia/Damascus';
  const rows = await tx.execute<CouponRow>(sql`
    select id, name, kind, coupon_code,
           to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
           to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
           days_of_week, from_time, to_time,
           to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as archived_at
    from promotions where id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) and coupon_code is not null`);
  for (const r of rows) {
    const rule: PromotionRule = {
      id: r.id,
      name: r.name,
      kind: r.kind,
      percentBp: null,
      buyQty: null,
      getQty: null,
      scope: 'all',
      categoryIds: [],
      productIds: [],
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      daysOfWeek: r.days_of_week ?? [],
      fromTime: r.from_time,
      toTime: r.to_time,
      archived: false,
    };
    const archivedBefore = r.archived_at !== null && Date.parse(r.archived_at) <= madeAt.getTime();
    if (!COUPON_KINDS.includes(r.kind) || archivedBefore || !promotionActive(rule, madeAt, zone)) {
      return ['coupon_invalid'];
    }
  }
  return [];
}
