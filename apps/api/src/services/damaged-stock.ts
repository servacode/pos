import { sql } from 'drizzle-orm';
import type { DamagedStock, DamagedStockLocation } from '@serva/core';
import { branches, withTenant, type Database, type Transaction } from '@serva/db';
import { forbidden, inScope, permissionScope, type PermissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { nextBranchCode } from './branches';

/**
 * «البضاعة التالفة» (packages/core › contracts/damaged-stock.ts). A store's damaged goods live in a
 * hidden branch of kind `damaged` whose parent is the store: the sellable stock of the store never
 * includes it, and everything stock does (levels, movements, cost, counts, supplier returns) works on
 * it as on any branch. It is made the first time a damaged return needs it.
 */

/**
 * The damaged location for goods that came back to `branchId`: the store's own, or, for a van, its home
 * store's. Made on demand; two returns made together end up with the same one (unique per store).
 */
export async function damagedLocationOf(
  tx: Transaction,
  tenantId: string,
  branchId: string,
): Promise<{ id: string; ownerId: string }> {
  const [b] = await tx.execute<{ id: string; kind: string; parent_branch_id: string | null; name: string }>(
    sql`select id, kind, parent_branch_id, name from branches where id = ${branchId}`,
  );
  // A van's damaged goods are brought home with it; a damaged location is its own
  const ownerId = b && b.kind === 'van' && b.parent_branch_id ? b.parent_branch_id : branchId;
  if (b?.kind === 'damaged') return { id: b.id, ownerId: b.parent_branch_id ?? b.id };
  const find = async () => {
    const [row] = await tx.execute<{ id: string }>(
      sql`select id from branches where kind = 'damaged' and parent_branch_id = ${ownerId}`,
    );
    return row?.id ?? null;
  };
  const found = await find();
  if (found) return { id: found, ownerId };
  const [owner] = await tx.execute<{ name: string }>(sql`select name from branches where id = ${ownerId}`);
  await tx
    .insert(branches)
    .values({
      tenantId,
      code: await nextBranchCode(tx),
      name: `تالف — ${owner?.name ?? ''}`.trim(),
      kind: 'damaged',
      parentBranchId: ownerId,
    })
    .onConflictDoNothing();
  const made = await find();
  if (!made) throw new Error('could not make the damaged location');
  return { id: made, ownerId };
}

/**
 * The branch whose books an entry about this branch's stock goes to: a store's damaged goods are still the
 * store's inventory, so a count or a supplier return of them posts under the store; any other branch under itself.
 */
export async function ledgerBranchOf(tx: Transaction, branchId: string): Promise<string> {
  const [row] = await tx.execute<{ parent_branch_id: string | null }>(
    sql`select parent_branch_id from branches where id = ${branchId} and kind = 'damaged'`,
  );
  return row?.parent_branch_id ?? branchId;
}

/** GET /v1/damaged-stock: what each store holds as damaged goods, with what it cost */
export function listDamagedStock(db: Database, auth: AccessClaims): Promise<DamagedStock> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // Seeing it needs the stock desk or the purchasing desk; the actions check their own permission
    const adjust = await permissionScope(tx, auth.userId, 'inventory.adjust');
    const purchasing = await permissionScope(tx, auth.userId, 'purchases.manage');
    const seen = (b: string) => inScope(adjust, b) || inScope(purchasing, b);
    const any = (s: PermissionScope) => s.all || s.branchIds.size > 0;
    if (!any(adjust) && !any(purchasing)) throw forbidden();

    const rows = await tx.execute<{
      branch_id: string;
      owner_id: string;
      owner_name: string;
      variant_id: string;
      name: string;
      qty: string;
      value: string | null;
    }>(sql`
      select d.id as branch_id, d.parent_branch_id as owner_id, o.name as owner_name, l.variant_id,
             trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, l.qty::text as qty,
             coalesce(sv.value_minor, 0)::text as value
      from branches d
      join branches o on o.tenant_id = d.tenant_id and o.id = d.parent_branch_id
      join stock_levels l on l.tenant_id = d.tenant_id and l.branch_id = d.id and l.qty > 0
      join variants v on v.tenant_id = l.tenant_id and v.id = l.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join stock_values sv on sv.tenant_id = l.tenant_id and sv.branch_id = l.branch_id and sv.variant_id = l.variant_id
      where d.kind = 'damaged'
      order by o.code, name`);
    const locations = new Map<string, DamagedStockLocation>();
    for (const r of rows) {
      if (!seen(r.owner_id)) continue;
      let loc = locations.get(r.branch_id);
      if (!loc) {
        loc = {
          branchId: r.branch_id,
          ownerBranchId: r.owner_id,
          ownerName: r.owner_name,
          items: [],
          totalValueMinor: 0,
        };
        locations.set(r.branch_id, loc);
      }
      const valueMinor = Number(r.value);
      loc.items.push({ variantId: r.variant_id, name: r.name, qty: Number(r.qty), valueMinor });
      loc.totalValueMinor += valueMinor;
    }
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings`,
    );
    return { baseCurrency: settings?.base ?? 'SYP', locations: [...locations.values()] };
  });
}
