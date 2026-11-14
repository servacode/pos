import { sql } from 'drizzle-orm';
import type { CurrencyCode, PriceChange, PriceChangeSource, priceHistoryQuery } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';

/**
 * «سجل تغيير الأسعار»: who changed a price, when, from what to what and from where, read from the
 * audit trail that is already written (09). Per-piece rows come from `price.changed` (a price list)
 * and from `product.updated` (the product's page); a bulk change and an applied price list were
 * only logged as one summary, so they show as one row with their count and no old and new price.
 */

const ACTIONS = ['price.changed', 'product.updated', 'prices.list_applied', 'prices.bulk_changed'];

type AuditRow = {
  id: string;
  created_at: Date;
  user_id: string | null;
  action: string;
  entity_id: string | null;
  changes: { priceMinor?: [number | null, number | null] } | null;
  data: Record<string, unknown> | null;
};

export function priceHistory(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof priceHistoryQuery>,
): Promise<{ items: PriceChange[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const product = query.productId ?? null;
    // A day is the store's own: from the start of `from` to the end of `to`, in the store's time zone
    const [tenant] = await tx.execute<{ tz: string | null }>(sql`select timezone as tz from tenants limit 1`);
    const tz = tenant?.tz ?? 'Asia/Damascus';
    const rows = await tx.execute<AuditRow>(sql`
      select id, created_at, user_id, action, entity_id, changes, data
      from audit_logs
      where action in (${sql.join(
        ACTIONS.map((a) => sql`${a}`),
        sql`, `,
      )})
        and (action <> 'product.updated' or jsonb_path_exists(data, '$.variants[*].priceMinor'))
        ${query.from ? sql`and created_at >= (${query.from}::date)::timestamp at time zone ${tz}` : sql``}
        ${query.to ? sql`and created_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})` : sql``}
        ${
          product
            ? sql`and ((action = 'price.changed' and data->>'productId' = ${product})
                    or (action = 'product.updated' and entity_id = ${product}))`
            : sql``
        }
      order by created_at desc, id desc
      limit ${query.limit * 3}`);

    // What the rows name: the pieces' products and labels, and who did it
    const variantIds = new Set<string>();
    const productIds = new Set<string>();
    const userIds = new Set<string>();
    for (const r of rows) {
      if (r.user_id) userIds.add(r.user_id);
      if (r.action === 'price.changed' && r.entity_id) {
        variantIds.add(r.entity_id);
        const pid = r.data?.productId;
        if (typeof pid === 'string') productIds.add(pid);
      }
      if (r.action === 'product.updated') {
        if (r.entity_id) productIds.add(r.entity_id);
        for (const v of variantsOf(r)) variantIds.add(v.id);
      }
    }
    const names = new Map<string, string>();
    if (productIds.size > 0) {
      const found = await tx.execute<{ id: string; name: string }>(
        sql`select id, name_ar as name from products where id in (${idList(productIds)})`,
      );
      for (const p of found) names.set(p.id, p.name);
    }
    const labels = new Map<string, { label: string | null; productId: string; currency: CurrencyCode }>();
    if (variantIds.size > 0) {
      const found = await tx.execute<{
        id: string;
        label: string | null;
        product_id: string;
        currency: string | null;
      }>(
        sql`select v.id, v.label, v.product_id, p.currency from variants v
            left join prices p on p.id = v.id where v.id in (${idList(variantIds)})`,
      );
      for (const v of found) {
        labels.set(v.id, {
          label: v.label,
          productId: v.product_id,
          currency: (v.currency ?? 'SYP') as CurrencyCode,
        });
      }
      const more = [...found.map((v) => v.product_id)].filter((id) => !names.has(id));
      if (more.length > 0) {
        const extra = await tx.execute<{ id: string; name: string }>(
          sql`select id, name_ar as name from products where id in (${idList(new Set(more))})`,
        );
        for (const p of extra) names.set(p.id, p.name);
      }
    }
    const who = new Map<string, string>();
    if (userIds.size > 0) {
      const found = await tx.execute<{ id: string; name: string }>(
        sql`select id, full_name as name from users where id in (${idList(userIds)})`,
      );
      for (const u of found) who.set(u.id, u.name);
    }

    const items: PriceChange[] = [];
    const push = (
      r: AuditRow,
      source: PriceChangeSource,
      fields: Pick<PriceChange, 'productId' | 'variantLabel' | 'currency' | 'oldMinor' | 'newMinor' | 'note'>,
      suffix: string,
    ) =>
      items.push({
        id: `${r.id}${suffix}`,
        at: new Date(r.created_at).toISOString(),
        userName: r.user_id ? (who.get(r.user_id) ?? null) : null,
        source,
        productName: fields.productId ? (names.get(fields.productId) ?? null) : null,
        ...fields,
      });
    for (const r of rows) {
      if (r.action === 'price.changed') {
        const pair = r.changes?.priceMinor;
        const piece = r.entity_id ? labels.get(r.entity_id) : undefined;
        const pid = typeof r.data?.productId === 'string' ? r.data.productId : (piece?.productId ?? null);
        if (!pair) continue;
        push(
          r,
          'price_list',
          {
            productId: pid,
            variantLabel: piece?.label ?? null,
            currency: piece?.currency ?? null,
            oldMinor: pair[0],
            newMinor: pair[1],
            note: typeof r.data?.fileName === 'string' ? r.data.fileName : null,
          },
          '',
        );
      } else if (r.action === 'product.updated') {
        for (const v of variantsOf(r)) {
          if (!v.priceMinor) continue;
          push(
            r,
            'product_edit',
            {
              productId: r.entity_id,
              variantLabel: labels.get(v.id)?.label ?? null,
              currency: labels.get(v.id)?.currency ?? null,
              oldMinor: v.priceMinor[0],
              newMinor: v.priceMinor[1],
              note: null,
            },
            `:${v.id}`,
          );
        }
      } else if (!product) {
        const count = Number(r.data?.pieces ?? 0);
        const note =
          r.action === 'prices.bulk_changed'
            ? r.data?.mode === 'restore'
              ? `إنهاء التخفيض على ${count} قطعة`
              : `تعديل جماعي ${Number(r.data?.percentBp ?? 0) / 100}٪ على ${count} قطعة`
            : `قائمة أسعار${typeof r.data?.fileName === 'string' ? ` «${r.data.fileName}»` : ''}: ${count} قطعة`;
        push(
          r,
          r.action === 'prices.bulk_changed' ? 'bulk' : 'price_list_summary',
          { productId: null, variantLabel: null, currency: null, oldMinor: null, newMinor: null, note },
          '',
        );
      }
    }
    return { items: items.slice(0, query.limit) };
  });
}

/** The pieces a `product.updated` row changed the price of, with their price move */
function variantsOf(row: AuditRow): { id: string; priceMinor?: [number, number] }[] {
  const list = row.data?.variants;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v: unknown) => {
    const x = v as { id?: unknown; priceMinor?: unknown };
    if (typeof x.id !== 'string') return [];
    const p = x.priceMinor;
    return [
      Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
        ? { id: x.id, priceMinor: [p[0], p[1]] as [number, number] }
        : { id: x.id },
    ];
  });
}

const idList = (ids: Set<string>) =>
  sql.join(
    [...ids].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
