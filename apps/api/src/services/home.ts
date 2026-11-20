import { sql, type SQL } from 'drizzle-orm';
import { businessDateOf, type CurrencyCode } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import { permissionScope } from '../auth/permissions';
import { DAY_MS } from '../clock';
import { branchesOf } from './merchandise';
import type { AccessClaims } from '../auth/tokens';

/**
 * The few numbers the home page needs and nothing else (round 44): what customers owe and who is
 * over the limit, and how many goods have no photo. Each block is only for whoever holds the
 * permission of the page it links to; the heavy lists (customers with their sizes, 100 products)
 * are not read for them any more.
 */

export interface HomeSummary {
  baseCurrency: CurrencyCode;
  /** customers.view: what customers owe (every customer with a debt, archived too) and who is over the limit */
  debts: {
    totalOwedMinor: number;
    overLimitCount: number;
    /** The one customer over the limit, named when there is exactly one */
    overLimitOne: { name: string; balanceMinor: number; creditLimitMinor: number } | null;
  } | null;
  /** catalog.manage: goods (not services) still without a photo, and how many goods there are */
  photos: { goodsCount: number; withoutPhoto: number } | null;
  /** report.view: the pieces that sold in the last 30 days and are down to their minimum (the report's rule), best sellers first */
  lowStock: {
    /** How many pieces are low in all; `items` is the first 100 */
    total: number;
    items: {
      variantId: string;
      productId: string;
      name: string;
      label: string | null;
      attributes: { name: string; value: string }[];
      stockQty: number;
      productPieces: number;
      productInStock: number;
    }[];
  } | null;
}

const debtLines = sql`
  select l.party_id as customer_id, sum(l.debit_minor - l.credit_minor) as balance
  from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where a.code = '1200' and l.party_type = 'customer'
  group by l.party_id`;

export async function loadHomeSummary(db: Database, auth: AccessClaims, now: Date): Promise<HomeSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const seesCustomers = await permissionScope(tx, auth.userId, 'customers.view');
    const seesCatalog = await permissionScope(tx, auth.userId, 'catalog.manage');
    const [base] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);

    let debts: HomeSummary['debts'] = null;
    if (seesCustomers.all || seesCustomers.branchIds.size > 0) {
      const [totals] = await tx.execute<{ owed: string; over: string }>(sql`
        select coalesce(sum(greatest(b.balance, 0)), 0)::text as owed,
               count(*) filter (where c.archived_at is null and c.credit_limit_minor is not null
                                  and b.balance > c.credit_limit_minor)::text as over
        from customers c join (${debtLines}) b on b.customer_id = c.id`);
      const overCount = Number(totals?.over ?? 0);
      let one: NonNullable<HomeSummary['debts']>['overLimitOne'] = null;
      if (overCount === 1) {
        const [row] = await tx.execute<{ name: string; balance: string; lim: string }>(sql`
          select c.name, b.balance::text as balance, c.credit_limit_minor::text as lim
          from customers c join (${debtLines}) b on b.customer_id = c.id
          where c.archived_at is null and c.credit_limit_minor is not null and b.balance > c.credit_limit_minor
          limit 1`);
        if (row) {
          one = { name: row.name, balanceMinor: Number(row.balance), creditLimitMinor: Number(row.lim) };
        }
      }
      debts = { totalOwedMinor: Number(totals?.owed ?? 0), overLimitCount: overCount, overLimitOne: one };
    }

    let photos: HomeSummary['photos'] = null;
    if (seesCatalog.all || seesCatalog.branchIds.size > 0) {
      const [row] = await tx.execute<{ goods: string; bare: string }>(sql`
        select count(*)::text as goods,
               count(*) filter (where not exists (
                 select 1 from product_images pi
                 where pi.tenant_id = p.tenant_id and pi.product_id = p.id))::text as bare
        from products p
        where p.archived_at is null and p.status = 'active' and p.type = 'stock'`);
      photos = { goodsCount: Number(row?.goods ?? 0), withoutPhoto: Number(row?.bare ?? 0) };
    }

    let lowStock: HomeSummary['lowStock'] = null;
    const seesStock = await permissionScope(tx, auth.userId, 'report.view');
    if (seesStock.all || seesStock.branchIds.size > 0) {
      const ids = await branchesOf(tx, auth, undefined);
      const inBranches = (column: SQL): SQL =>
        ids === null
          ? sql`${column} not in (select id from branches where kind = 'damaged')`
          : sql`${column} in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`;
      const [tz] = await tx.execute<{ timezone: string | null }>(sql`select timezone from tenants limit 1`);
      const to = businessDateOf(now, tz?.timezone ?? 'Asia/Damascus');
      const from = businessDateOf(new Date(now.getTime() - 30 * DAY_MS), tz?.timezone ?? 'Asia/Damascus');
      const rows = await tx.execute<{
        variant_id: string;
        product_id: string;
        name: string;
        label: string | null;
        attributes: { name: string; value: string }[];
        stock: string;
        pieces: string;
        in_stock: string;
        total: string;
      }>(sql`
        with sold as (
          select l.variant_id, sum(l.base_qty) as qty
          from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
          where i.business_date between ${from} and ${to} and ${inBranches(sql`i.branch_id`)}
          group by l.variant_id),
        stock as (
          select variant_id, sum(qty) as qty from stock_levels
          where ${inBranches(sql`branch_id`)} group by variant_id),
        low as (
          select v.id as variant_id, v.product_id, p.name_ar as name, v.label, v.attributes,
                 coalesce(k.qty, 0) as stock, coalesce(s.qty, 0) as sold,
                 (select count(*) from variants a where a.product_id = v.product_id and a.archived_at is null) as pieces,
                 (select count(*) from variants a left join stock ak on ak.variant_id = a.id
                    where a.product_id = v.product_id and a.archived_at is null and coalesce(ak.qty, 0) > 0) as in_stock
          from variants v join products p on p.id = v.product_id
          left join stock k on k.variant_id = v.id left join sold s on s.variant_id = v.id
          where v.archived_at is null and p.archived_at is null and p.type = 'stock'
            and ((v.min_stock_qty is not null and coalesce(k.qty, 0) <= v.min_stock_qty)
              or (v.min_stock_qty is null and coalesce(s.qty, 0) > 0 and coalesce(k.qty, 0) <= 2000)))
        select variant_id, product_id, name, label, attributes, stock::text, pieces::text, in_stock::text,
               (select count(*) from low)::text as total
        from low order by sold desc, stock, name limit 100`);
      lowStock = {
        total: Number(rows[0]?.total ?? 0),
        items: rows.map((r) => ({
          variantId: r.variant_id,
          productId: r.product_id,
          name: r.name,
          label: r.label,
          attributes: r.attributes,
          stockQty: Number(r.stock),
          productPieces: Number(r.pieces),
          productInStock: Number(r.in_stock),
        })),
      };
    }

    return { baseCurrency: (base?.base ?? 'SYP') as CurrencyCode, debts, photos, lowStock };
  });
}
