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

const ACTIONS = [
  'price.changed',
  'product.updated',
  'prices.list_applied',
  'prices.bulk_changed',
  'prices.bulk_undone',
];
/** A bulk row lists at most this many pieces; the rest is counted */
const MOVES_SHOWN = 300;

type AuditRow = {
  id: string;
  created_at: Date;
  created_text: string;
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
): Promise<{ items: PriceChange[]; nextCursor: string | null }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const product = query.productId ?? null;
    const [cursorAt, cursorId] = (query.before ?? '').split('|');
    const cursor = cursorAt && cursorId ? { at: cursorAt, id: cursorId } : null;
    // A day is the store's own: from the start of `from` to the end of `to`, in the store's time zone
    const [tenant] = await tx.execute<{ tz: string | null }>(sql`select timezone as tz from tenants limit 1`);
    const tz = tenant?.tz ?? 'Asia/Damascus';
    // A bulk row carries up to 5,000 pieces: only the first ones shown (and the product's own) leave the database
    const pick = product
      ? sql`and (m->>'id') in (select id::text from variants where product_id = ${product}::uuid)`
      : sql``;
    const dataColumn = sql`case when action in ('prices.bulk_changed', 'prices.bulk_undone')
        and jsonb_typeof(data->'moves') = 'array' then
          (data - 'moves') || jsonb_build_object(
            'moves', coalesce((select jsonb_agg(m) from (
                select m from jsonb_array_elements(data->'moves') m where true ${pick} limit ${MOVES_SHOWN}) x), '[]'::jsonb),
            'movesTotal', (select count(*) from jsonb_array_elements(data->'moves') m where true ${pick}))
        when action = 'prices.list_applied' then data - 'moves'
        else data end as data`;
    const rows = await tx.execute<AuditRow>(sql`
      select id, created_at, created_at::text as created_text, user_id, action, entity_id, changes, ${dataColumn}
      from audit_logs
      where action in (${sql.join(
        ACTIONS.map((a) => sql`${a}`),
        sql`, `,
      )})
        and (action <> 'product.updated' or jsonb_path_exists(data,
              '$.variants[*] ? (exists(@.priceMinor) || exists(@.minPriceMinor) || exists(@.wholesalePriceMinor))'))
        and not (action = 'prices.list_applied' and data ? 'batchId')
        ${cursor ? sql`and (created_at, id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``}
        ${query.from ? sql`and created_at >= (${query.from}::date)::timestamp at time zone ${tz}` : sql``}
        ${query.to ? sql`and created_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})` : sql``}
        ${
          product
            ? sql`and ((action = 'price.changed' and data->>'productId' = ${product})
                    or (action = 'product.updated' and entity_id = ${product})
                    or (action in ('prices.bulk_changed', 'prices.bulk_undone') and exists (
                          select 1 from jsonb_array_elements(coalesce(data->'moves', '[]'::jsonb)) m
                          where (m->>'id') in (select id::text from variants where product_id = ${product}::uuid))))`
            : sql``
        }
      order by created_at desc, id desc
      limit ${query.limit + 1}`);
    const more = rows.length > query.limit;
    if (more) rows.length = query.limit;
    const last = rows[rows.length - 1];
    const nextCursor = more && last ? `${last.created_text}|${last.id}` : null;

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
      if (r.action === 'prices.bulk_changed' || r.action === 'prices.bulk_undone')
        for (const m of movesOf(r)) variantIds.add(m.id);
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

    // Which of the listed bulk changes were taken back since
    const batchIds = [
      ...new Set(
        rows.flatMap((r) =>
          (r.action === 'prices.bulk_changed' ||
            r.action === 'prices.list_applied' ||
            r.action === 'price.changed') &&
          typeof r.data?.batchId === 'string'
            ? [r.data.batchId]
            : [],
        ),
      ),
    ];
    const undone = new Set<string>();
    if (batchIds.length > 0) {
      const found = await tx.execute<{ of: string }>(sql`
        select data->>'of' as of from audit_logs
        where action = 'prices.bulk_undone'
          and data->>'of' in (${sql.join(
            batchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`);
      for (const f of found) undone.add(f.of);
    }

    const items: PriceChange[] = [];
    const push = (
      r: AuditRow,
      source: PriceChangeSource,
      fields: Pick<
        PriceChange,
        'productId' | 'variantLabel' | 'currency' | 'oldMinor' | 'newMinor' | 'note'
      > &
        Partial<Pick<PriceChange, 'field' | 'batchId' | 'undone'>>,
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
        const listBatch = typeof r.data?.batchId === 'string' ? r.data.batchId : undefined;
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
            ...(listBatch ? { batchId: listBatch, undone: undone.has(listBatch) } : {}),
          },
          '',
        );
      } else if (r.action === 'product.updated') {
        for (const v of variantsOf(r)) {
          for (const [key, field, note] of [
            ['priceMinor', 'price', null],
            ['minPriceMinor', 'floor', 'السعر الأدنى'],
            ['wholesalePriceMinor', 'wholesale', 'سعر الجملة'],
          ] as const) {
            const pair = v.pairs[key];
            if (!pair) continue;
            push(
              r,
              'product_edit',
              {
                productId: r.entity_id,
                variantLabel: labels.get(v.id)?.label ?? null,
                currency: labels.get(v.id)?.currency ?? null,
                oldMinor: pair[0],
                newMinor: pair[1],
                note,
                field,
              },
              field === 'price' ? `:${v.id}` : `:${v.id}:${field}`,
            );
          }
        }
      } else if (
        (r.action === 'prices.bulk_changed' || r.action === 'prices.bulk_undone') &&
        movesOf(r).length > 0
      ) {
        const isUndo = r.action === 'prices.bulk_undone';
        const batchId = isUndo ? undefined : typeof r.data?.batchId === 'string' ? r.data.batchId : undefined;
        // A bulk change written with its pieces: one row for each, as a price edit shows
        const all = movesOf(r);
        const total = Math.max(Number(r.data?.movesTotal ?? all.length), all.length);
        // A change of thousands of pieces shows its first 300 and says how many more it moved
        for (const m of all) {
          const piece = labels.get(m.id);
          push(
            r,
            'bulk',
            {
              productId: piece?.productId ?? null,
              variantLabel: piece?.label ?? null,
              currency: piece?.currency ?? null,
              oldMinor: m.old,
              newMinor: m.new,
              note: isUndo
                ? 'تراجع عن تغيير جماعي'
                : r.data?.mode === 'restore'
                  ? 'إنهاء التخفيض'
                  : `تعديل جماعي ${Number(r.data?.percentBp ?? 0) / 100}٪`,
              ...(batchId ? { batchId, undone: undone.has(batchId), batchPieces: total } : {}),
            },
            `:${m.id}`,
          );
        }
        if (total > all.length) {
          push(
            r,
            'bulk',
            {
              productId: null,
              variantLabel: null,
              currency: null,
              oldMinor: null,
              newMinor: null,
              note: `و${String(total - all.length)} قطعة أخرى في التغيير نفسه`,
              ...(batchId ? { batchId, undone: undone.has(batchId), batchPieces: total } : {}),
            },
            ':more',
          );
        }
      } else if (
        !product &&
        r.action !== 'prices.bulk_undone' &&
        // A price list written with its own pieces shows them under one header instead
        !(r.action === 'prices.list_applied' && typeof r.data?.batchId === 'string')
      ) {
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
    return { items, nextCursor };
  });
}

/** The pieces a bulk change moved, with their old and new price; empty for older rows that kept only a count */
function movesOf(row: AuditRow): { id: string; old: number; new: number }[] {
  const list = row.data?.moves;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v: unknown) => {
    const x = v as { id?: unknown; old?: unknown; new?: unknown };
    return typeof x.id === 'string' && typeof x.old === 'number' && typeof x.new === 'number'
      ? [{ id: x.id, old: x.old, new: x.new }]
      : [];
  });
}

/** The pieces a `product.updated` row changed a price, floor or wholesale price of, with each move */
function variantsOf(row: AuditRow): {
  id: string;
  pairs: Partial<
    Record<'priceMinor' | 'minPriceMinor' | 'wholesalePriceMinor', [number | null, number | null]>
  >;
}[] {
  const list = row.data?.variants;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v: unknown) => {
    const x = v as Record<string, unknown>;
    if (typeof x.id !== 'string') return [];
    const pairs: ReturnType<typeof variantsOf>[number]['pairs'] = {};
    for (const key of ['priceMinor', 'minPriceMinor', 'wholesalePriceMinor'] as const) {
      const p = x[key];
      const ok = (n: unknown) => n === null || typeof n === 'number';
      if (Array.isArray(p) && ok(p[0]) && ok(p[1]))
        pairs[key] = [p[0] as number | null, p[1] as number | null];
    }
    return [{ id: x.id, pairs }];
  });
}

const idList = (ids: Set<string>) =>
  sql.join(
    [...ids].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
