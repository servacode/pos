import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  ShortageRequestInput,
  ShortageRequestPlaced,
  ShortageRow,
  ShortagesResponse,
} from '@serva/core';
import { shortageRequests, variants, withTenant, type Database } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * «النواقص» (round 38, pharmacy). Two things put an item on the list: its stock is at or under its
 * minimum, or a customer asked for it and the shelf did not have it («طلبو زبون وما كان موجود»). The
 * request is written by the till with its own id, so a retry creates nothing twice. A request closes by
 * itself when a purchase of the item is received after it, or by hand («تم توفيره»). The purchase-order
 * suggestion (purchase-orders.ts) reads the same open requests, so the shortage list feeds it.
 */

/**
 * The open requests of a variant: not resolved, and not yet covered by a purchase received in the request's own
 * branch after it whose received quantity reaches what was asked for (a purchase of a few pieces for another
 * branch, or of fewer pieces than the customer wanted, leaves it open).
 */
export const OPEN_REQUEST = sql`r.resolved_at is null and (r.variant_id is null or coalesce((
  select sum(pl.qty) from purchase_lines pl join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
  where pl.tenant_id = r.tenant_id and pl.variant_id = r.variant_id and pu.branch_id = r.branch_id
    and pu.created_at > r.created_at), 0) < r.qty)`;

/**
 * What an item holds that cannot be sold: the balance of each batch (per branch, damaged location left out) that is
 * past its expiry or stopped by hand (a recall), summed per item. A CTE named `unsellable`, so both lists count only
 * the sellable stock (round 39): an item whose shelf is all expired is short, not «20 available».
 */
export const UNSELLABLE_CTE = sql`unsellable as (
  select b.variant_id, sum(b.bal) as qty from (
    select m.variant_id, m.branch_id, m.batch_no, m.expiry_date, sum(m.qty) as bal
    from batch_movements m
    where m.branch_id not in (select id from branches where kind = 'damaged')
    group by m.variant_id, m.branch_id, m.batch_no, m.expiry_date) b
  where b.bal > 0
    and (b.expiry_date < (now() at time zone (select timezone from tenants where id = app_current_tenant()))::date
         or exists (select 1 from batch_blocks bb where bb.variant_id = b.variant_id
                    and bb.batch_no = b.batch_no and bb.released_at is null))
  group by b.variant_id)`;

export function recordShortageRequest(
  db: Database,
  device: DeviceClaims,
  input: ShortageRequestInput,
): Promise<ShortageRequestPlaced> {
  return withTenant(db, device.tenantId, async (tx) => {
    if (input.variantId) {
      const [known] = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.id, input.variantId));
      if (!known)
        throw new AppError(400, 'validation_failed', 'هذا الصنف غير موجود.', { variantId: 'صنف غير معروف' });
    }
    const [row] = await tx
      .insert(shortageRequests)
      .values({
        id: input.id,
        tenantId: device.tenantId,
        branchId: device.branchId,
        variantId: input.variantId,
        name: input.name,
        qty: input.qty,
        note: input.note,
      })
      .onConflictDoNothing()
      .returning({ id: shortageRequests.id });
    return { id: input.id, created: Boolean(row) };
  });
}

type Raw = {
  variant_id: string | null;
  name: string;
  generic_name: string | null;
  stock: string | null;
  min: string | null;
  req_count: string;
  req_qty: string;
  last_at: string | null;
  ids: string[] | null;
  supplier_id: string | null;
  supplier_name: string | null;
  expired: string | null;
  order_numbers: string[] | null;
  on_order: string | null;
};

export function listShortages(db: Database, auth: AccessClaims): Promise<ShortagesResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const rows = await tx.execute<Raw>(sql`
      with stock as (
        select variant_id, sum(qty) as qty from stock_levels
        where branch_id not in (select id from branches where kind = 'damaged') group by variant_id
      ),
      ${UNSELLABLE_CTE},
      ordered as (
        select (l->>'variantId')::uuid as variant_id,
               sum(greatest((l->>'qty')::bigint - (l->>'receivedQty')::bigint, 0)) as qty,
               array_agg(distinct o.number order by o.number) as numbers
        from purchase_orders o, jsonb_array_elements(o.lines) l
        where o.status in ('sent', 'partial')
        group by 1
      ),
      asked as (
        select r.variant_id, case when r.variant_id is null then min(r.name) end as free_name,
               count(*) as cnt, sum(r.qty) as qty, max(r.created_at) as last_at, array_agg(r.id) as ids
        from shortage_requests r
        where ${OPEN_REQUEST}
        group by r.variant_id, case when r.variant_id is null then lower(r.name) end
      ),
      lastbuy as (
        select distinct on (pl.variant_id) pl.variant_id, pu.supplier_id, s.name as supplier_name
        from purchase_lines pl
        join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
        join suppliers s on s.tenant_id = pu.tenant_id and s.id = pu.supplier_id
        order by pl.variant_id, pu.business_date desc, pu.created_at desc, pl.line_no desc
      )
      select v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, p.generic_name,
             greatest(coalesce(k.qty, 0) - coalesce(u.qty, 0), 0)::text as stock, v.min_stock_qty::text as min,
             coalesce(a.cnt, 0)::text as req_count, coalesce(a.qty, 0)::text as req_qty,
             a.last_at::text as last_at, a.ids,
             lb.supplier_id::text as supplier_id, lb.supplier_name,
             coalesce(u.qty, 0)::text as expired, o.numbers as order_numbers, coalesce(o.qty, 0)::text as on_order
      from variants v
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join stock k on k.variant_id = v.id
      left join unsellable u on u.variant_id = v.id
      left join ordered o on o.variant_id = v.id
      left join asked a on a.variant_id = v.id
      left join lastbuy lb on lb.variant_id = v.id
      where v.archived_at is null and p.archived_at is null and p.type = 'stock'
        and ((v.min_stock_qty is not null and greatest(coalesce(k.qty, 0) - coalesce(u.qty, 0), 0) <= v.min_stock_qty)
           or a.variant_id is not null)
      union all
      select null, a.free_name, null, null, null, a.cnt::text, a.qty::text, a.last_at::text, a.ids, null, null, null, null, null
      from asked a where a.variant_id is null
      order by name`);
    const items: ShortageRow[] = rows.map((r) => {
      const min = r.min === null ? null : Number(r.min);
      const stock = r.stock === null ? null : Number(r.stock);
      const requested = Number(r.req_count) > 0;
      const below = min !== null && stock !== null && stock <= min;
      return {
        variantId: r.variant_id,
        name: r.name,
        genericName: r.generic_name,
        stockQty: stock,
        minStockQty: min,
        requestCount: Number(r.req_count),
        requestedQty: Number(r.req_qty),
        lastRequestedAt: r.last_at,
        requestIds: r.ids ?? [],
        reason: below && requested ? 'both' : requested ? 'requested' : 'below_min',
        lastSupplierId: r.supplier_id,
        lastSupplierName: r.supplier_name,
        expiredQty: Number(r.expired ?? 0),
        onOrderQty: Number(r.on_order ?? 0),
        orderNumbers: r.order_numbers ?? [],
      };
    });
    return { items };
  });
}

/** «تم توفيره»: closes the open requests of one line of the list (by their ids) */
export function resolveShortages(
  db: Database,
  auth: AccessClaims,
  ids: readonly string[],
  meta: RequestMeta,
): Promise<void> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const closed = await tx
      .update(shortageRequests)
      .set({ resolvedAt: sql`now()`, resolvedBy: auth.userId })
      .where(
        and(
          isNull(shortageRequests.resolvedAt),
          sql`${shortageRequests.id} = any(${sql`array[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})`,
        ),
      )
      .returning({ id: shortageRequests.id });
    if (closed.length > 0) {
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'shortage.resolve',
          entity: 'shortage_request',
          entityId: closed[0]!.id,
          changes: { requests: [null, closed.length] },
        },
        meta,
      );
    }
  });
}
