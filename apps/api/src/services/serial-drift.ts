import { sql } from 'drizzle-orm';
import type { SerialDriftRow } from '@serva/core';
import type { Database } from '@serva/db';
import { withTenant } from '@serva/db';
import { permissionScope, forbidden } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';

/** More than this and the list says so (the owner puts the first ones right, then looks again) */
const DRIFT_LIMIT = 100;

/**
 * Round 62/64: the products that track serial numbers whose stock and «في المحل» numbers disagree (a phone written
 * off with no number named, a surplus counted without numbers, a sale that left without one). Computed on read,
 * nothing is stored; the serial page shows it and puts the numbers right with «تصحيح».
 *
 * Seeing it is for whoever can fix it (inventory.adjust) or manages the catalog: one story with the fix route.
 * Stock and numbers are counted the same way: the damaged branch is left out of both, and the comparison is exact
 * (a half piece of a numbered product is a difference too).
 */
export function serialDrift(
  db: Database,
  auth: AccessClaims,
): Promise<{ items: SerialDriftRow[]; truncated: boolean }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const adjust = await permissionScope(tx, auth.userId, 'inventory.adjust');
    const manage = await permissionScope(tx, auth.userId, 'catalog.manage');
    const allowed = [adjust, manage].some((s) => s.all || s.branchIds.size > 0);
    if (!allowed) throw forbidden();
    const rows = await tx.execute<{ variant_id: string; name: string; stock: string; n: string }>(sql`
      select v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             coalesce(st.qty, 0)::text as stock, coalesce(sr.n, 0)::text as n
      from variants v
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id and p.tracks_serial
      left join (
        select l.variant_id, sum(l.qty) as qty from stock_levels l
        join branches b on b.tenant_id = l.tenant_id and b.id = l.branch_id and b.kind <> 'damaged'
        group by l.variant_id) st on st.variant_id = v.id
      left join (
        select s.variant_id, count(*) as n from serials s
        where s.status = 'in_stock'
          and not exists (
            select 1 from branches b
            where b.tenant_id = s.tenant_id and b.id = s.branch_id and b.kind = 'damaged')
        group by s.variant_id) sr on sr.variant_id = v.id
      where coalesce(st.qty, 0) <> coalesce(sr.n, 0) * 1000
      order by name
      limit ${DRIFT_LIMIT + 1}`);
    return {
      items: rows.slice(0, DRIFT_LIMIT).map((r) => ({
        variantId: r.variant_id,
        name: r.name,
        stockPieces: Number(r.stock) / 1000,
        serialPieces: Number(r.n),
      })),
      truncated: rows.length > DRIFT_LIMIT,
    };
  });
}
