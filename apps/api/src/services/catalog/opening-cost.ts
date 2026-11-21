import { sql } from 'drizzle-orm';
import type { ProductCostsResponse, productOpeningInput } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { inScope, permissionScope, requirePermission } from '../../auth/permissions';
import { AppError } from '../../errors';
import { postOpeningStock, variantsWithMovements } from '../import/opening';
import { assertDateOpen } from '../period-close';
import { fieldError, notFound, requireCatalogManager, type CatalogContext } from './common';

/**
 * Opening stock and cost from the product card: the posting is the import's (one stocktake «OPN» per
 * branch, Dr 1300 / Cr 3900). A piece that already moved in the branch is refused: its quantity is
 * changed by a count or a purchase, never by a second «opening».
 */
export async function postProductOpening(
  db: Database,
  productId: string,
  input: z.output<typeof productOpeningInput>,
  ctx: CatalogContext,
): Promise<{ posted: number }> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    // An opening quantity dated inside a closed period is refused, as any other document is
    await assertDateOpen(tx, tenantId, input.date, 'date');
    const adjust = await permissionScope(tx, userId, 'inventory.adjust');
    if (!inScope(adjust, input.branchId)) {
      throw new AppError(
        403,
        'forbidden',
        'الكمية الافتتاحية تحتاج صلاحية اعتماد الجرد والتسويات في هذا الفرع.',
      );
    }
    const [branch] = await tx.execute<{ id: string }>(
      sql`select id from branches where id = ${input.branchId}::uuid and is_active`,
    );
    if (!branch) throw fieldError('branchId', 'الفرع غير موجود');
    const rows = await tx.execute<{ id: string; label: string | null; name: string }>(sql`
      select v.id, v.label, p.name_ar as name from variants v join products p on p.id = v.product_id
      where v.product_id = ${productId}::uuid and v.archived_at is null and p.archived_at is null and p.type = 'stock'`);
    if (rows.length === 0) throw notFound('هذا المنتج غير موجود أو لا يُخزَّن.');
    const known = new Map(rows.map((r) => [r.id, r]));
    input.lines.forEach((l, i) => {
      if (!known.has(l.variantId))
        throw fieldError(`lines.${String(i)}.variantId`, 'هذه القطعة ليست من هذا المنتج');
    });
    if (new Set(input.lines.map((l) => l.variantId)).size !== input.lines.length) {
      throw fieldError('lines', 'قطعة مكررة');
    }
    // The same per-tenant lock the import takes: two quick presses (or two tabs) queue here, and the
    // second one sees the first one's movement below and is refused, never posting twice.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`import:${tenantId}`}, 0))`);
    const moved = await variantsWithMovements(
      tx,
      input.branchId,
      input.lines.map((l) => l.variantId),
    );
    if (moved.size > 0) {
      throw new AppError(
        409,
        'conflict',
        'لهذا المنتج حركة مخزون في هذا الفرع من قبل. غيّر كميته بجرد أو بفاتورة شراء.',
      );
    }
    await postOpeningStock(
      tx,
      ctx.auth,
      ctx.meta,
      input.date,
      input.lines.map((l) => {
        const row = known.get(l.variantId)!;
        return {
          variantId: l.variantId,
          name: `${row.name} ${row.label ?? ''}`.trim(),
          branchId: input.branchId,
          qty: l.qty,
          unitCostMinor: l.unitCostMinor,
        };
      }),
    );
    return { posted: input.lines.length };
  });
}

/** The running average cost of each live piece of a product (all branches), for whoever holds cost.view. */
export async function productCosts(
  db: Database,
  productId: string,
  ctx: CatalogContext,
): Promise<ProductCostsResponse> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requirePermission(tx, ctx.auth.userId, 'cost.view');
    // A product that is not this store's is not found, never an empty list
    const [product] = await tx.execute<{ id: string }>(
      sql`select id from products where id = ${productId}::uuid`,
    );
    if (!product) throw notFound('هذا المنتج غير موجود.');
    const rows = await tx.execute<{ variant_id: string; qty: string; value: string }>(sql`
      select v.id as variant_id, coalesce(sum(sv.qty), 0)::text as qty, coalesce(sum(sv.value_minor), 0)::text as value
      from variants v left join stock_values sv on sv.tenant_id = v.tenant_id and sv.variant_id = v.id
      where v.product_id = ${productId}::uuid and v.archived_at is null
      group by v.id, v.sort_order order by v.sort_order, v.id`);
    return {
      items: rows.map((r) => {
        const qty = Number(r.qty);
        return {
          variantId: r.variant_id,
          qty,
          unitCostMinor: qty > 0 ? Math.round((Number(r.value) * 1000) / qty) : null,
        };
      }),
    };
  });
}
