import { sql } from 'drizzle-orm';
import { businessDateOf, type ExpiryResponse } from '@serva/core';
import { uuidArray } from './costing';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';

/**
 * Expiry (03 › الصيدليات: الصلاحية). Stock is kept per item, not per batch, so what is left of each
 * receipt is estimated the way a shelf empties: the oldest boxes sell first, so the stock on hand
 * is taken from the newest receipts back. A batch is on the shelf for whatever part of the stock
 * it covers. The earliest expiry of those batches is written on the item for the till's warning.
 */

/** Each receipt line with an expiry, and what of it is still on the shelf (estimated). */
const onShelf = (variantFilter = sql`true`) => sql`
  with stock as (
    select variant_id, sum(qty) as qty from stock_levels group by variant_id
  ),
  received as (
    select l.variant_id, l.name, l.batch_no, l.expiry_date, l.qty, p.number, p.business_date,
           sum(l.qty) over (
             partition by l.variant_id order by p.business_date desc, p.created_at desc, l.line_no desc
             rows between unbounded preceding and 1 preceding
           ) as newer
    from purchase_lines l
    join purchases p on p.tenant_id = l.tenant_id and p.id = l.purchase_id
    where ${variantFilter}
  )
  select r.variant_id, r.name, r.batch_no, r.expiry_date::text as expiry_date, r.number,
         r.business_date::text as received_on,
         greatest(0, least(r.qty, coalesce(s.qty, 0) - coalesce(r.newer, 0)))::bigint as left_qty
  from received r left join stock s on s.variant_id = r.variant_id
  where r.expiry_date is not null`;

/** Writes the earliest expiry still on the shelf onto these items (null when there is none). */
export async function refreshExpiry(tx: Transaction, variantIds: readonly string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const ids = uuidArray([...new Set(variantIds)]);
  await tx.execute(sql`
    update variants v set nearest_expiry = x.nearest
    from (
      select v2.id, (select min(o.expiry_date)::date from (${onShelf(sql`l.variant_id = v2.id`)}) o
                     where o.left_qty > 0) as nearest
      from variants v2 where v2.id = any(${ids})
    ) x
    where v.id = x.id and v.nearest_expiry is distinct from x.nearest`);
}

export function expiryReport(
  db: Database,
  auth: AccessClaims,
  days: number,
  now: Date,
): Promise<ExpiryResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [tenant] = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${auth.tenantId}`,
    );
    const today = businessDateOf(now, tenant?.timezone ?? 'Asia/Damascus');
    const rows = await tx.execute<{
      variant_id: string;
      name: string;
      batch_no: string | null;
      expiry_date: string;
      number: string;
      received_on: string;
      left_qty: string;
    }>(sql`
      select * from (${onShelf()}) o
      where o.left_qty > 0 and o.expiry_date::date <= ${today}::date + ${days}::int
      order by o.expiry_date, o.name`);
    // What sold since the last receipt moves the earliest expiry later: the till's warning follows
    const all = await tx.execute<{ id: string }>(sql`
      select distinct variant_id as id from purchase_lines where expiry_date is not null`);
    await refreshExpiry(
      tx,
      all.map((r) => r.id),
    );
    const day = Date.parse(`${today}T00:00:00Z`);
    return {
      today,
      items: rows.map((r) => ({
        variantId: r.variant_id,
        name: r.name,
        batchNo: r.batch_no,
        expiryDate: r.expiry_date,
        purchaseNumber: r.number,
        receivedOn: r.received_on,
        qty: Number(r.left_qty),
        daysLeft: Math.round((Date.parse(`${r.expiry_date}T00:00:00Z`) - day) / 86_400_000),
      })),
    };
  });
}
