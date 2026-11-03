import { sql, type SQL } from 'drizzle-orm';
import { businessDateOf, type CurrencyCode, type MerchandiseReport, type OptionSales } from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { forbidden, inScope, permissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import { costPending } from './costing';

/**
 * What sells and what sleeps (03 › الألبسة): sales by each option of the pieces, the best models
 * with their pieces, and the pieces on the shelf that have neither sold nor arrived for a while.
 * Read-only, in the store's transaction like every report.
 */

const notFound = (message: string) => new AppError(404, 'not_found', message);
const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Sizes in the order a shop hangs them; anything else keeps the order of the pieces */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];

const isWholeNumber = (text: string) => {
  if (text.length === 0 || text.length > 6) return false;
  for (const c of text) if (c < '0' || c > '9') return false;
  return true;
};

export function optionOrder(values: { value: string; position: number }[]): string[] {
  const rank = (value: string, position: number): [number, number, string] => {
    const size = SIZE_ORDER.indexOf(value.trim().toUpperCase());
    if (size >= 0) return [0, size, value];
    if (isWholeNumber(value.trim())) return [1, Number(value.trim()), value];
    return [2, position, value];
  };
  return [...values]
    .map((v) => ({ v: v.value, r: rank(v.value, v.position) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2].localeCompare(b.r[2], 'ar'))
    .map((x) => x.v);
}

async function branchesOf(tx: Transaction, auth: AccessClaims, branchId: string | undefined) {
  const scope = await permissionScope(tx, auth.userId, 'report.view');
  if (branchId) {
    if (!inScope(scope, branchId)) throw forbidden();
    const [branch] = await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`);
    if (!branch) throw notFound('هذا الفرع غير موجود.');
    return [branchId];
  }
  if (scope.all) return null;
  if (scope.branchIds.size === 0) throw forbidden();
  return [...scope.branchIds];
}

export function merchandiseReport(
  db: Database,
  auth: AccessClaims,
  query: { from: string; to: string; branchId?: string; categoryId?: string; idleDays: number },
  now: Date,
): Promise<MerchandiseReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const ids = await branchesOf(tx, auth, query.branchId);
    const inBranches = (column: SQL): SQL =>
      ids === null
        ? sql`true`
        : sql`${column} in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
    // One department and its sub-categories; every product otherwise
    const inCategory = (column: SQL): SQL =>
      query.categoryId
        ? sql`${column} in (with recursive tree as (
            select id from categories where id = ${query.categoryId}
            union all select c.id from categories c join tree t on c.parent_id = t.id
          ) select id from tree)`
        : sql`true`;
    const cost = await permissionScope(tx, auth.userId, 'cost.view');
    const canCost = cost.all || (ids !== null && ids.every((id) => cost.branchIds.has(id)));
    if (canCost) await costPending(tx, auth.tenantId);
    const [settings] = await tx.execute<{ base: string; timezone: string | null }>(sql`
      select s.base_currency as base, t.timezone
      from tenant_settings s join tenants t on t.id = s.tenant_id`);
    const today = businessDateOf(now, settings?.timezone ?? 'Asia/Damascus');

    const moved = sql`
      sold as (
        select l.variant_id, sum(l.base_qty) as qty, sum(l.total_minor) as total
        from invoice_lines l
        join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        where i.business_date between ${query.from} and ${query.to} and ${inBranches(sql`i.branch_id`)}
          and ${inCategory(sql`(select p.category_id from products p where p.id = l.product_id)`)}
        group by l.variant_id
      ),
      back as (
        select rl.variant_id, sum(rl.base_qty) as qty
        from sale_return_lines rl
        join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
        where r.business_date between ${query.from} and ${query.to} and ${inBranches(sql`r.branch_id`)}
          and ${inCategory(sql`(select p.category_id from variants v2 join products p on p.id = v2.product_id where v2.id = rl.variant_id)`)}
        group by rl.variant_id
      )`;

    const options = await tx.execute<{
      name: string;
      value: string;
      sold: string;
      back: string;
      total: string;
      name_pos: string;
      value_pos: string;
    }>(sql`
      with ${moved},
      touched as (select variant_id from sold union select variant_id from back)
      select x.a->>'name' as name, x.a->>'value' as value,
             coalesce(sum(s.qty), 0)::text as sold, coalesce(sum(b.qty), 0)::text as back,
             coalesce(sum(s.total), 0)::text as total,
             min(x.n)::text as name_pos, min(v.sort_order)::text as value_pos
      from touched t
      join variants v on v.id = t.variant_id
      cross join lateral jsonb_array_elements(v.attributes) with ordinality as x(a, n)
      left join sold s on s.variant_id = t.variant_id
      left join back b on b.variant_id = t.variant_id
      where coalesce(x.a->>'name', '') <> '' and coalesce(x.a->>'value', '') <> ''
      group by 1, 2`);
    const byName = new Map<string, { pos: number; rows: (OptionSales & { position: number })[] }>();
    for (const o of options) {
      const group = byName.get(o.name) ?? { pos: num(o.name_pos), rows: [] };
      group.pos = Math.min(group.pos, num(o.name_pos));
      group.rows.push({
        value: o.value,
        soldQty: num(o.sold),
        returnedQty: num(o.back),
        totalMinor: num(o.total),
        position: num(o.value_pos),
      });
      byName.set(o.name, group);
    }
    const byOption = [...byName.entries()]
      .sort((a, b) => a[1].pos - b[1].pos || a[0].localeCompare(b[0], 'ar'))
      .map(([name, group]) => {
        const order = optionOrder(group.rows);
        return {
          name,
          values: order.map((value) => {
            const { position: _position, ...row } = group.rows.find((r) => r.value === value)!;
            return row;
          }),
        };
      });

    const models = await tx.execute<{ product_id: string; name: string; sold: string; total: string }>(sql`
      with ${moved}
      select v.product_id, min(p.name_ar) as name, sum(s.qty)::text as sold, sum(s.total)::text as total
      from sold s
      join variants v on v.id = s.variant_id
      join products p on p.id = v.product_id
      where (select count(*) from variants o where o.product_id = v.product_id and o.archived_at is null) > 1
      group by v.product_id
      order by sum(s.total) desc, v.product_id
      limit 15`);
    const pieces =
      models.length === 0
        ? []
        : await tx.execute<{
            variant_id: string;
            product_id: string;
            label: string | null;
            sold: string;
            stock: string;
          }>(sql`
            with ${moved},
            stock as (
              select variant_id, sum(qty) as qty from stock_levels
              where ${inBranches(sql`branch_id`)} group by variant_id
            )
            select v.id as variant_id, v.product_id, v.label,
                   coalesce(s.qty, 0)::text as sold, coalesce(k.qty, 0)::text as stock
            from variants v
            left join sold s on s.variant_id = v.id
            left join stock k on k.variant_id = v.id
            where v.product_id in (${sql.join(
              models.map((m) => sql`${m.product_id}::uuid`),
              sql`, `,
            )}) and (v.archived_at is null or s.qty is not null)
            order by v.sort_order, v.id`);

    const cutoff = sql`(${today}::date - ${query.idleDays}::int)`;
    const slow = await tx.execute<{
      variant_id: string;
      product_id: string;
      name: string;
      qty: string;
      value: string | null;
      last_sold: string | null;
      last_in: string | null;
    }>(sql`
      with stock as (
        select variant_id, sum(qty) as qty from stock_levels
        where ${inBranches(sql`branch_id`)} group by variant_id having sum(qty) > 0
      ),
      value as (
        select variant_id, sum(value_minor) as v from stock_values
        where ${inBranches(sql`branch_id`)} group by variant_id
      ),
      last_sold as (
        select l.variant_id, max(i.business_date) as d
        from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        where ${inBranches(sql`i.branch_id`)} group by l.variant_id
      ),
      last_in as (
        select variant_id, max(business_date) as d from stock_movements
        where kind in ('purchase', 'stocktake', 'transfer') and qty > 0 and ${inBranches(sql`branch_id`)}
        group by variant_id
      )
      select k.variant_id, v.product_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             k.qty::text as qty, val.v::text as value, ls.d::text as last_sold, li.d::text as last_in
      from stock k
      join variants v on v.id = k.variant_id
      join products p on p.id = v.product_id
      left join value val on val.variant_id = k.variant_id
      left join last_sold ls on ls.variant_id = k.variant_id
      left join last_in li on li.variant_id = k.variant_id
      where coalesce(ls.d, '1900-01-01'::date) < ${cutoff} and coalesce(li.d, '1900-01-01'::date) < ${cutoff}
        and ${inCategory(sql`p.category_id`)}
      order by greatest(ls.d, li.d) nulls first, name, k.variant_id
      limit 300`);

    const sellers = await tx.execute<{
      id: string;
      name: string | null;
      n: string;
      total: string;
      back: string;
    }>(sql`
      with sold as (
        select coalesce(i.salesperson_id, i.cashier_id) as id, count(*) as n, sum(i.total_minor) as total
        from invoices i
        where i.business_date between ${query.from} and ${query.to} and ${inBranches(sql`i.branch_id`)}
        group by 1
      ),
      back as (
        select coalesce(i.salesperson_id, i.cashier_id) as id, sum(r.total_minor) as total
        from sale_returns r join invoices i on i.tenant_id = r.tenant_id and i.id = r.sale_id
        where r.business_date between ${query.from} and ${query.to} and ${inBranches(sql`r.branch_id`)}
        group by 1
      )
      select s.id, u.full_name as name, s.n::text as n, s.total::text as total, coalesce(b.total, 0)::text as back
      from sold s left join back b on b.id = s.id left join users u on u.id = s.id
      order by s.total desc, s.id`);

    const departments = await tx.execute<{
      id: string | null;
      name: string | null;
      sold: string;
      total: string;
      back: string;
      back_total: string;
    }>(sql`
      with recursive roots as (
        select id, id as root from categories where parent_id is null
        union all select c.id, r.root from categories c join roots r on c.parent_id = r.id
      ),
      moves as (
        select p.category_id, l.base_qty as sold, l.total_minor as total, 0 as back, 0 as back_total
        from invoice_lines l
        join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        join products p on p.id = l.product_id
        where i.business_date between ${query.from} and ${query.to} and ${inBranches(sql`i.branch_id`)}
        union all
        select p.category_id, 0, 0, rl.base_qty, rl.total_minor
        from sale_return_lines rl
        join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
        join variants v on v.id = rl.variant_id
        join products p on p.id = v.product_id
        where r.business_date between ${query.from} and ${query.to} and ${inBranches(sql`r.branch_id`)}
      )
      select ro.root as id, min(c.name) as name, sum(m.sold)::text as sold, sum(m.total)::text as total,
             sum(m.back)::text as back, sum(m.back_total)::text as back_total
      from moves m
      left join roots ro on ro.id = m.category_id
      left join categories c on c.id = ro.root
      group by ro.root
      order by sum(m.total) desc, ro.root`);

    const slowMovers = slow.map((r) => ({
      variantId: r.variant_id,
      productId: r.product_id,
      name: r.name,
      stockQty: num(r.qty),
      valueMinor: canCost ? num(r.value) : null,
      lastSoldOn: r.last_sold,
      lastReceivedOn: r.last_in,
    }));
    return {
      from: query.from,
      to: query.to,
      branchId: query.branchId ?? null,
      idleDays: query.idleDays,
      today,
      baseCurrency: (settings?.base ?? 'SYP') as CurrencyCode,
      byOption,
      models: models.map((m) => ({
        productId: m.product_id,
        name: m.name,
        soldQty: num(m.sold),
        totalMinor: num(m.total),
        pieces: pieces
          .filter((x) => x.product_id === m.product_id)
          .map((x) => ({
            variantId: x.variant_id,
            label: x.label ?? '',
            soldQty: num(x.sold),
            stockQty: num(x.stock),
          })),
      })),
      slowMovers,
      slowValueMinor: canCost ? slowMovers.reduce((n, r) => n + (r.valueMinor ?? 0), 0) : null,
      byDepartment: departments.map((d) => ({
        categoryId: d.id,
        name: d.name ?? 'بلا قسم',
        soldQty: num(d.sold),
        totalMinor: num(d.total),
        returnedQty: num(d.back),
        returnedMinor: num(d.back_total),
      })),
      bySeller: sellers.map((r) => ({
        userId: r.id,
        fullName: r.name ?? '',
        invoiceCount: num(r.n),
        totalMinor: num(r.total),
        returnedMinor: num(r.back),
      })),
    };
  });
}
