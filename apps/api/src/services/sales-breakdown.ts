import { sql, type SQL } from 'drizzle-orm';
import type { CurrencyCode, SalesBreakdown, SalesBreakdownRow, SalesGroup } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { AccessClaims } from '../auth/tokens';
import { branchesOf } from './merchandise';

/**
 * «تقرير المبيعات»: sales by product, category, option or seller, net of returns, against the
 * period of the same length just before (packages/core › contracts/sales-breakdown.ts). Read-only.
 */

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const DAY = 86_400_000;

/** The period of the same number of days that ends the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / DAY) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(start - days * DAY), to: iso(start - DAY) };
}

interface Raw {
  key: string;
  name: string | null;
  qty: string;
  total: string;
  back: string;
  n: string;
}

export function salesBreakdown(
  db: Database,
  auth: AccessClaims,
  query: {
    from: string;
    to: string;
    by: SalesGroup;
    option?: string | undefined;
    branchId?: string | undefined;
  },
): Promise<SalesBreakdown> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const ids = await branchesOf(tx, auth, query.branchId);
    const inBranches = (column: SQL): SQL =>
      ids === null
        ? sql`true`
        : sql`${column} in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings`,
    );

    // For each group: how a line and a returned line get their key and name
    const soldKey: Record<SalesGroup, { key: SQL; name: SQL; join: SQL }> = {
      product: {
        key: sql`l.product_id::text`,
        name: sql`min(p.name_ar)`,
        join: sql`left join products p on p.id = l.product_id`,
      },
      category: {
        key: sql`coalesce(p.category_id::text, '')`,
        name: sql`coalesce(min(c.name), 'بلا تصنيف')`,
        join: sql`left join products p on p.id = l.product_id left join categories c on c.id = p.category_id`,
      },
      option: {
        key: sql`o.a->>'value'`,
        name: sql`min(o.a->>'value')`,
        join: sql`join variants v on v.id = l.variant_id
          cross join lateral jsonb_array_elements(v.attributes) as o(a)`,
      },
      seller: {
        key: sql`coalesce(i.salesperson_id, i.cashier_id)::text`,
        name: sql`min(u.full_name)`,
        join: sql`left join users u on u.id = coalesce(i.salesperson_id, i.cashier_id)`,
      },
    };
    const backKey: Record<SalesGroup, { key: SQL; join: SQL }> = {
      product: { key: sql`v.product_id::text`, join: sql`join variants v on v.id = rl.variant_id` },
      category: {
        key: sql`coalesce(p.category_id::text, '')`,
        join: sql`join variants v on v.id = rl.variant_id join products p on p.id = v.product_id`,
      },
      option: {
        key: sql`o.a->>'value'`,
        join: sql`join variants v on v.id = rl.variant_id cross join lateral jsonb_array_elements(v.attributes) as o(a)`,
      },
      seller: {
        key: sql`coalesce(i.salesperson_id, i.cashier_id)::text`,
        join: sql`join invoices i on i.tenant_id = r.tenant_id and i.id = r.sale_id`,
      },
    };
    const optionFilter: SQL = query.by === 'option' ? sql`and o.a->>'name' = ${query.option ?? ''}` : sql``;

    const run = async (from: string, to: string): Promise<Map<string, Raw>> => {
      const k = soldKey[query.by];
      const b = backKey[query.by];
      const sold = await tx.execute<Omit<Raw, 'back'>>(sql`
        select ${k.key} as key, ${k.name} as name, sum(l.base_qty)::text as qty, sum(l.total_minor)::text as total,
               count(distinct i.id)::text as n
        from invoice_lines l
        join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        ${k.join}
        where i.business_date between ${from} and ${to} and ${inBranches(sql`i.branch_id`)}
          ${optionFilter}
        group by 1`);
      const back = await tx.execute<{ key: string; qty: string; total: string }>(sql`
        select ${b.key} as key, sum(rl.base_qty)::text as qty, sum(rl.total_minor)::text as total
        from sale_return_lines rl
        join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
        ${b.join}
        where r.business_date between ${from} and ${to} and ${inBranches(sql`r.branch_id`)}
          ${optionFilter}
        group by 1`);
      const out = new Map<string, Raw>();
      for (const s of sold) out.set(s.key, { ...s, back: '0' });
      for (const r of back) {
        const row = out.get(r.key) ?? { key: r.key, name: null, qty: '0', total: '0', n: '0', back: '0' };
        out.set(r.key, {
          ...row,
          qty: String(num(row.qty) - num(r.qty)),
          total: String(num(row.total) - num(r.total)),
          back: r.total,
        });
      }
      return out;
    };

    const previous = previousPeriod(query.from, query.to);
    const [now, before] = await Promise.all([run(query.from, query.to), run(previous.from, previous.to)]);
    const names = await tx.execute<{ name: string }>(sql`
      select distinct a->>'name' as name from variants v cross join lateral jsonb_array_elements(v.attributes) a
      where coalesce(a->>'name', '') <> '' order by 1`);

    const rows: SalesBreakdownRow[] = [...now.values()]
      .map((r) => ({
        key: r.key,
        name: r.name ?? before.get(r.key)?.name ?? r.key,
        qty: num(r.qty),
        totalMinor: num(r.total),
        returnedMinor: num(r.back),
        invoiceCount: num(r.n),
        previousQty: num(before.get(r.key)?.qty),
        previousTotalMinor: num(before.get(r.key)?.total),
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name, 'ar'));
    const sum = (m: Map<string, Raw>) => [...m.values()].reduce((acc, r) => acc + num(r.total), 0);
    return {
      from: query.from,
      to: query.to,
      previousFrom: previous.from,
      previousTo: previous.to,
      by: query.by,
      option: query.by === 'option' ? (query.option ?? null) : null,
      branchId: query.branchId ?? null,
      baseCurrency: (settings?.base ?? 'SYP') as CurrencyCode,
      rows,
      totalMinor: sum(now),
      previousTotalMinor: sum(before),
      optionNames: names.map((n) => n.name),
    };
  });
}
