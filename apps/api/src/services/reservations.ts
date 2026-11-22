import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '@serva/db';

/**
 * Round 37, decision 14: what is reserved. A reservation is the pieces an order holds: an accepted
 * online order, or a hold made at the till (it is an accepted order of its branch). It is derived from
 * those orders, never written to stock_levels (reserved_qty stays the older, unused column), so it moves
 * no stock, posts no journal and the replay and the integrity fingerprints are untouched.
 *
 *   reserved  = pieces on accepted orders that have not lapsed (reserved_until null or in the future)
 *   available = on hand − reserved
 *
 * Releasing an order (sold at the till, rejected) takes it out of 'accepted'; a lapsed one stops counting
 * by itself, with no job to run. Quantities here are stock units (a thousandth of a piece).
 */

/** The order rows that reserve right now (alias `o` of online_orders) */
export const liveReservation: SQL = sql`o.status = 'accepted' and (o.reserved_until is null or o.reserved_until > now())`;

/** Units of one variant (a SQL expression for `v.id`-like column) reserved in every branch together */
export const reservedUnitsOf = (variantId: SQL): SQL =>
  sql`coalesce((select sum((x->>'qty')::bigint) * 1000 from online_orders o
    cross join lateral jsonb_array_elements(o.lines) x
    where ${liveReservation} and x->>'variantId' = (${variantId})::text), 0)`;

/**
 * Units reserved per variant at one branch: the holds of that branch, plus the shop orders that name no
 * branch (they take their pieces from whichever branch sells them, so every branch counts them).
 * `except` leaves one order out (the order a till is selling must not be blocked by its own reservation).
 */
export async function reservedAtBranch(
  tx: Transaction,
  branchId: string,
  variantIds: readonly string[],
  except?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (variantIds.length === 0) return out;
  const rows = await tx.execute<{ variant_id: string; units: string }>(sql`
    select x->>'variantId' as variant_id, (sum((x->>'qty')::bigint) * 1000)::text as units
    from online_orders o cross join lateral jsonb_array_elements(o.lines) x
    where ${liveReservation} and (o.branch_id is null or o.branch_id = ${branchId})
      ${except ? sql`and o.id <> ${except}` : sql``}
      and x->>'variantId' in (${sql.join(
        variantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    group by 1`);
  for (const r of rows) out.set(r.variant_id, Number(r.units));
  return out;
}

/**
 * Units reserved per branch and variant, for the stock pages: the holds of each branch, and the shop
 * orders that name no branch counted at `defaultBranchId` (the store's first branch, where they are filled).
 */
export async function reservedByBranch(
  tx: Transaction,
  variantIds: readonly string[],
  defaultBranchId: string | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (variantIds.length === 0) return out;
  const rows = await tx.execute<{ branch_id: string | null; variant_id: string; units: string }>(sql`
    select o.branch_id, x->>'variantId' as variant_id, (sum((x->>'qty')::bigint) * 1000)::text as units
    from online_orders o cross join lateral jsonb_array_elements(o.lines) x
    where ${liveReservation}
      and x->>'variantId' in (${sql.join(
        variantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    group by 1, 2`);
  for (const r of rows) {
    const branch = r.branch_id ?? defaultBranchId;
    if (!branch) continue;
    const key = `${branch}|${r.variant_id}`;
    out.set(key, (out.get(key) ?? 0) + Number(r.units));
  }
  return out;
}
