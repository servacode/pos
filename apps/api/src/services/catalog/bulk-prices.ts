import { sql } from 'drizzle-orm';
import type { BulkPriceResult, bulkPriceInput, CurrencyCode } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { audit } from '../audit';
import { notFound, requireCatalogManager, type CatalogContext } from './common';

/**
 * «تغيير الأسعار بالجملة» (03 › الألبسة: تنزيلات آخر الموسم): a category's pieces, sub-categories
 * included, move by a percent and are rounded; first shown, then applied in one transaction. The
 * tills pull the new prices like any price edit.
 */

/** `minor` moved by `bp` basis points and rounded to the nearest `step` (never below one step). */
export function movedPrice(minor: number, bp: number, step: number): number {
  const raw = (minor * (10_000 + bp)) / 10_000;
  return Math.max(step, Math.round(raw / step) * step);
}

export function bulkPrices(
  db: Database,
  input: z.output<typeof bulkPriceInput>,
  ctx: CatalogContext,
): Promise<BulkPriceResult> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    const [category] = await tx.execute<{ id: string }>(
      sql`select id from categories where id = ${input.categoryId} and archived_at is null`,
    );
    if (!category) throw notFound('هذا التصنيف غير موجود.');
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings`,
    );
    const base = (settings?.base ?? 'SYP') as CurrencyCode;
    const rows = await tx.execute<{
      product_id: string;
      variant_id: string;
      name: string;
      currency: string;
      price: string;
      min_price: string | null;
    }>(sql`
      with recursive tree as (
        select id from categories where id = ${input.categoryId}
        union all
        select c.id from categories c join tree t on c.parent_id = t.id
      )
      select p.id as product_id, v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             pr.currency, pr.price_minor::text as price, pr.min_price_minor::text as min_price
      from products p
      join variants v on v.product_id = p.id and v.archived_at is null
      join prices pr on pr.id = v.id
      where p.category_id in (select id from tree) and p.archived_at is null
      order by p.name_ar, v.sort_order, v.id
      limit 5000`);
    const items = rows.map((r) => {
      const step = r.currency === base ? input.roundToMinor : 1;
      const oldMinor = Number(r.price);
      const newMinor = movedPrice(oldMinor, input.percentBp, step);
      const min =
        r.min_price === null
          ? null
          : Math.min(newMinor, movedPrice(Number(r.min_price), input.percentBp, step));
      return {
        productId: r.product_id,
        variantId: r.variant_id,
        name: r.name,
        currency: r.currency as CurrencyCode,
        oldMinor,
        newMinor,
        min,
      };
    });
    const changed = items.filter((i) => i.newMinor !== i.oldMinor);
    if (input.apply && changed.length > 0) {
      for (const i of changed) {
        await tx.execute(sql`
          update prices set price_minor = ${i.newMinor}, min_price_minor = ${i.min},
                 price_changed_at = ${ctx.now.toISOString()}::timestamptz, updated_at = now()
          where id = ${i.variantId}`);
      }
      // The product's version moves with its prices, as with any price edit
      const products = [...new Set(changed.map((i) => i.productId))];
      await tx.execute(sql`
        update products set updated_at = now()
        where id in (${sql.join(
          products.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
      await audit(
        tx,
        {
          tenantId,
          userId,
          action: 'prices.bulk_changed',
          entity: 'category',
          entityId: input.categoryId,
          data: { percentBp: input.percentBp, roundToMinor: input.roundToMinor, pieces: changed.length },
        },
        ctx.meta,
      );
    }
    return {
      applied: input.apply && changed.length > 0,
      items: items.map(({ min: _min, ...rest }) => rest),
    };
  });
}
