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
  /** Sum of line total x the rate that applied (basis points), and the totals of the lines that had a rate; seller view only */
  cnum?: string;
  rated?: string;
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
      season: {
        key: sql`coalesce(p.season, '')`,
        name: sql`coalesce(min(p.season), 'بلا موسم')`,
        join: sql`left join products p on p.id = l.product_id`,
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
      season: {
        key: sql`coalesce(p.season, '')`,
        join: sql`join variants v on v.id = rl.variant_id join products p on p.id = v.product_id`,
      },
      option: {
        key: sql`o.a->>'value'`,
        join: sql`join variants v on v.id = rl.variant_id cross join lateral jsonb_array_elements(v.attributes) as o(a)`,
      },
      seller: {
        key: sql`coalesce(i.salesperson_id, i.cashier_id)::text`,
        join: sql`join invoices i on i.tenant_id = r.tenant_id and i.id = r.sale_id
          left join users u on u.id = coalesce(i.salesperson_id, i.cashier_id)`,
      },
    };
    const optionFilter: SQL = query.by === 'option' ? sql`and o.a->>'name' = ${query.option ?? ''}` : sql``;

    const run = async (from: string, to: string): Promise<Map<string, Raw>> => {
      const k = soldKey[query.by];
      const b = backKey[query.by];
      // The rate a sale carries is the one snapshotted when it was processed; the seller's current
      // rate only stands in where the snapshot is null (a sale made before the snapshot existed)
      const seller = query.by === 'seller';
      const rate = sql`coalesce(i.commission_bp, u.commission_bp)`;
      const sold = await tx.execute<Omit<Raw, 'back'>>(sql`
        select ${k.key} as key, ${k.name} as name, sum(l.base_qty)::text as qty, sum(l.total_minor)::text as total,
               count(distinct i.id)::text as n,
               ${seller ? sql`sum(l.total_minor * ${rate})::text` : sql`null::text`} as cnum,
               ${seller ? sql`sum(case when ${rate} is not null then l.total_minor else 0 end)::text` : sql`null::text`} as rated
        from invoice_lines l
        join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        ${k.join}
        where i.business_date between ${from} and ${to} and ${inBranches(sql`i.branch_id`)}
          ${optionFilter}
        group by 1`);
      const back = await tx.execute<{
        key: string;
        qty: string;
        total: string;
        cnum: string | null;
        rated: string | null;
      }>(sql`
        select ${b.key} as key, sum(rl.base_qty)::text as qty, sum(rl.total_minor)::text as total,
               ${seller ? sql`sum(rl.total_minor * ${rate})::text` : sql`null::text`} as cnum,
               ${seller ? sql`sum(case when ${rate} is not null then rl.total_minor else 0 end)::text` : sql`null::text`} as rated
        from sale_return_lines rl
        join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
        ${b.join}
        where r.business_date between ${from} and ${to} and ${inBranches(sql`r.branch_id`)}
          ${optionFilter}
        group by 1`);
      const out = new Map<string, Raw>();
      for (const s of sold) out.set(s.key, { ...s, cnum: s.cnum ?? '0', rated: s.rated ?? '0', back: '0' });
      for (const r of back) {
        const row = out.get(r.key) ?? {
          key: r.key,
          name: null,
          qty: '0',
          total: '0',
          n: '0',
          cnum: '0',
          rated: '0',
          back: '0',
        };
        out.set(r.key, {
          ...row,
          qty: String(num(row.qty) - num(r.qty)),
          total: String(num(row.total) - num(r.total)),
          cnum: String(num(row.cnum) - num(r.cnum)),
          rated: String(num(row.rated) - num(r.rated)),
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

    // Per day of the period, net of returns (the small bars chart), and for seasons what was received
    const dailySold = await tx.execute<{ d: string; total: string }>(sql`
      select i.business_date::text as d, sum(l.total_minor)::text as total
      from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
      where i.business_date between ${query.from} and ${query.to} and ${inBranches(sql`i.branch_id`)}
      group by 1`);
    const dailyBack = await tx.execute<{ d: string; total: string }>(sql`
      select r.business_date::text as d, sum(rl.total_minor)::text as total
      from sale_return_lines rl join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
      where r.business_date between ${query.from} and ${query.to} and ${inBranches(sql`r.branch_id`)}
      group by 1`);
    const perDay = new Map<string, number>();
    for (const r of dailySold) perDay.set(r.d, num(r.total));
    for (const r of dailyBack) perDay.set(r.d, (perDay.get(r.d) ?? 0) - num(r.total));
    const daily = [...perDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, totalMinor]) => ({ date, totalMinor }));
    const received = new Map<string, number>();
    if (query.by === 'season') {
      const got = await tx.execute<{ key: string; qty: string }>(sql`
        select coalesce(p.season, '') as key, sum(m.qty)::text as qty
        from stock_movements m
        join variants v on v.id = m.variant_id
        join products p on p.id = v.product_id
        where m.kind = 'purchase' and m.business_date <= ${query.to} and ${inBranches(sql`m.branch_id`)}
        group by 1`);
      for (const g of got) received.set(g.key, num(g.qty));
    }

    // `by=option`: the same sales across a second option too (size × colour), net of returns
    let cross: SalesBreakdown['cross'] = null;
    if (query.by === 'option' && query.option) {
      const other =
        names.map((n) => n.name).find((n) => n !== query.option && (n === 'اللون' || n === 'المقاس')) ??
        names.map((n) => n.name).find((n) => n !== query.option);
      if (other) {
        const pick = (name: string): SQL =>
          sql`(select a2.a->>'value' from jsonb_array_elements(v.attributes) a2(a) where a2.a->>'name' = ${name} limit 1)`;
        const cellSql = sql`${pick(query.option)} as r, ${pick(other)} as c`;
        const sold = await tx.execute<{ r: string | null; c: string | null; qty: string; total: string }>(sql`
          select ${cellSql}, sum(l.base_qty)::text as qty, sum(l.total_minor)::text as total
          from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
          join variants v on v.id = l.variant_id
          where i.business_date between ${query.from} and ${query.to} and ${inBranches(sql`i.branch_id`)}
          group by 1, 2`);
        const back = await tx.execute<{ r: string | null; c: string | null; qty: string; total: string }>(sql`
          select ${cellSql}, sum(rl.base_qty)::text as qty, sum(rl.total_minor)::text as total
          from sale_return_lines rl join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
          join variants v on v.id = rl.variant_id
          where r.business_date between ${query.from} and ${query.to} and ${inBranches(sql`r.branch_id`)}
          group by 1, 2`);
        const cells = new Map<string, { row: string; col: string; qty: number; totalMinor: number }>();
        const add = (r: typeof sold, sign: 1 | -1) => {
          for (const x of r) {
            if (x.r === null || x.c === null) continue;
            const key = JSON.stringify([x.r, x.c]);
            const cell = cells.get(key) ?? { row: x.r, col: x.c, qty: 0, totalMinor: 0 };
            cell.qty += sign * num(x.qty);
            cell.totalMinor += sign * num(x.total);
            cells.set(key, cell);
          }
        };
        add(sold, 1);
        add(back, -1);
        cross = { rowOption: query.option, colOption: other, cells: [...cells.values()] };
      }
    }

    const rows: SalesBreakdownRow[] = [...now.values()]
      .map((r) => {
        // Commission follows the rate each sale carried; the shown rate is the effective one over the period
        const rated = num(r.rated);
        const hasRate = query.by === 'seller' && rated !== 0;
        const bp = hasRate ? Math.round(num(r.cnum) / rated) : null;
        return {
          key: r.key,
          name: r.name ?? before.get(r.key)?.name ?? r.key,
          qty: num(r.qty),
          totalMinor: num(r.total),
          returnedMinor: num(r.back),
          invoiceCount: num(r.n),
          previousQty: num(before.get(r.key)?.qty),
          previousTotalMinor: num(before.get(r.key)?.total),
          commissionBp: bp,
          commissionMinor: hasRate ? Math.round(num(r.cnum) / 10_000) : null,
          receivedQty: query.by === 'season' ? (received.get(r.key) ?? 0) : null,
        };
      })
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
      daily,
      cross,
      totalMinor: sum(now),
      previousTotalMinor: sum(before),
      optionNames: names.map((n) => n.name),
      commissionTotalMinor:
        query.by === 'seller' ? rows.reduce((n, r) => n + (r.commissionMinor ?? 0), 0) : null,
    };
  });
}
