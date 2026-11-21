import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { BulkPriceResult, bulkPriceInput, CurrencyCode } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { audit } from '../audit';
import { AppError } from '../../errors';
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
      was: string | null;
    }>(sql`
      with recursive tree as (
        select id from categories where id = ${input.categoryId}
        union all
        select c.id from categories c join tree t on c.parent_id = t.id
      )
      select p.id as product_id, v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             pr.currency, pr.price_minor::text as price, pr.min_price_minor::text as min_price,
             pr.was_price_minor::text as was
      from products p
      join variants v on v.product_id = p.id and v.archived_at is null
      join prices pr on pr.id = v.id
      where p.category_id in (select id from tree) and p.archived_at is null
      order by p.name_ar, v.sort_order, v.id
      limit 5001
      ${input.apply ? sql`for update of pr` : sql``}`);
    // More than 5,000 pieces in one category: never apply half of it silently
    if (rows.length > 5000) {
      if (input.apply) {
        throw new AppError(
          422,
          'validation_failed',
          'في هذا التصنيف أكثر من 5000 قطعة. غيّر الأسعار على تصنيفاته الفرعية كلاً على حدة.',
        );
      }
      rows.length = 5000;
    }
    const items = rows.flatMap((r) => {
      const step = r.currency === base ? input.roundToMinor : 1;
      const oldMinor = Number(r.price);
      const kept = r.was === null ? null : Number(r.was);
      if (input.mode === 'restore') {
        // Ending the markdown: back at the kept price; a piece never marked down stays
        if (kept === null) return [];
        const min = r.min_price === null ? null : Math.min(kept, Number(r.min_price));
        return [
          {
            productId: r.product_id,
            variantId: r.variant_id,
            name: r.name,
            currency: r.currency as CurrencyCode,
            oldMinor,
            newMinor: kept,
            wasMinor: null,
            min,
            oldMin: r.min_price === null ? null : Number(r.min_price),
            oldWas: kept,
          },
        ];
      }
      const newMinor = movedPrice(oldMinor, input.percentBp, step);
      const min =
        r.min_price === null
          ? null
          : Math.min(newMinor, movedPrice(Number(r.min_price), input.percentBp, step));
      // Marked down: the first price before the markdowns stays struck through; at or above it, none
      const was = newMinor < oldMinor && input.markWas ? (kept ?? oldMinor) : kept;
      return [
        {
          productId: r.product_id,
          variantId: r.variant_id,
          name: r.name,
          currency: r.currency as CurrencyCode,
          oldMinor,
          newMinor,
          wasMinor: was !== null && was > newMinor ? was : null,
          min,
          oldMin: r.min_price === null ? null : Number(r.min_price),
          oldWas: kept,
        },
      ];
    });
    const changed = items.filter((i) => i.newMinor !== i.oldMinor);
    const batchId = randomUUID();
    if (input.apply && changed.length > 0) {
      for (const i of changed) {
        await tx.execute(sql`
          update prices set price_minor = ${i.newMinor}, min_price_minor = ${i.min},
                 was_price_minor = ${i.wasMinor},
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
          data: {
            mode: input.mode,
            percentBp: input.percentBp,
            roundToMinor: input.roundToMinor,
            pieces: changed.length,
            // One line per piece, for «سجل تغيير الأسعار» (the first thousand)
            batchId,
            // Every piece with what it had before, so «تراجع» can put it back (up to the 5,000 a change may hold)
            moves: changed.map((i) => ({
              id: i.variantId,
              old: i.oldMinor,
              new: i.newMinor,
              oldMin: i.oldMin,
              newMin: i.min,
              oldWas: i.oldWas,
              newWas: i.wasMinor,
            })),
          },
        },
        ctx.meta,
      );
    }
    return {
      applied: input.apply && changed.length > 0,
      ...(input.apply && changed.length > 0 ? { changeId: batchId } : {}),
      items: items.map(({ min: _min, oldMin: _oldMin, oldWas: _oldWas, ...rest }) => rest),
    };
  });
}

interface Move {
  id: string;
  old: number;
  new: number;
  oldMin?: number | null;
  newMin?: number | null;
  oldWas?: number | null;
  newWas?: number | null;
}

/**
 * «تراجع» for a bulk price change: every piece still at the price that change gave it goes back to
 * what it had (price, floor, struck-through price). A piece edited since is left as it is and counted.
 * A change can be undone once.
 */
export function undoBulkPrices(
  db: Database,
  changeId: string,
  ctx: CatalogContext,
): Promise<{ restored: number; skipped: number }> {
  const { tenantId, userId } = ctx.auth;
  return withTenant(db, tenantId, async (tx) => {
    await requireCatalogManager(tx, userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`bulk-undo:${tenantId}`}, 0))`);
    const [row] = await tx.execute<{ data: { moves?: Move[]; mode?: string } | null }>(sql`
      select data from audit_logs where action = 'prices.bulk_changed' and data->>'batchId' = ${changeId} limit 1`);
    const moves = row?.data?.moves;
    if (!row || !Array.isArray(moves) || moves.some((m) => m.oldMin === undefined)) {
      throw notFound('هذا التغيير غير موجود أو قديم ولا يمكن التراجع عنه.');
    }
    const [done] = await tx.execute<{ id: string }>(sql`
      select id from audit_logs where action = 'prices.bulk_undone' and data->>'of' = ${changeId} limit 1`);
    if (done) throw new AppError(409, 'conflict', 'سبق التراجع عن هذا التغيير.');
    let restored = 0;
    const touched = new Set<string>();
    for (const m of moves) {
      const res = await tx.execute<{ product_id: string }>(sql`
        update prices pr set price_minor = ${m.old}, min_price_minor = ${m.oldMin ?? null},
               was_price_minor = ${m.oldWas ?? null},
               price_changed_at = ${ctx.now.toISOString()}::timestamptz, updated_at = now()
        from variants v
        where pr.id = ${m.id}::uuid and v.id = pr.id and pr.price_minor = ${m.new}
        returning v.product_id`);
      if (res[0]) {
        restored += 1;
        touched.add(res[0].product_id);
      }
    }
    if (touched.size > 0) {
      await tx.execute(sql`
        update products set updated_at = now()
        where id in (${sql.join(
          [...touched].map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
    }
    await audit(
      tx,
      {
        tenantId,
        userId,
        action: 'prices.bulk_undone',
        entity: 'category',
        data: {
          of: changeId,
          restored,
          skipped: moves.length - restored,
          moves: moves.map((m) => ({ id: m.id, old: m.new, new: m.old })),
        },
      },
      ctx.meta,
    );
    return { restored, skipped: moves.length - restored };
  });
}
