import { sql, type SQL } from 'drizzle-orm';
import { normalizeArabic } from '@serva/core/text';
import { withTenant, type Database } from '@serva/db';
import { permissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';

/**
 * The records the top bar's search finds (round 48): a few of each kind asked of the database by
 * name, number or phone, instead of the browser downloading seven whole lists. Each kind is only for
 * whoever holds the permission of the page it opens; a branch-bound user only sees his branches'
 * documents. The text is compared in the one search form (hamza seats, ة/ه, ى/ي, Arabic-Indic digits).
 */

export interface RecordHit {
  key: string;
  group: string;
  label: string;
  detail?: string;
  to: string;
}

const EACH = 4;
const FOLD_FROM = 'أإآٱؤئىةیک٠١٢٣٤٥٦٧٨٩';
const FOLD_TO = 'ااااوييهيك0123456789';

/** The columns as one searchable text in the search form */
const folded = (...columns: SQL[]): SQL =>
  sql`translate(lower(concat_ws(' ', ${sql.join(columns, sql`, `)})), ${FOLD_FROM}, ${FOLD_TO})`;

const escapeLike = (word: string): string => word.replace(/[\\%_]/g, (c) => '\\' + c);

/** Every typed word must be somewhere in the text */
const hasWords = (text: SQL, words: readonly string[]): SQL =>
  sql.join(
    words.map((word) => sql`${text} like ${`%${escapeLike(word)}%`}`),
    sql` and `,
  );

export async function searchRecords(db: Database, auth: AccessClaims, query: string): Promise<RecordHit[]> {
  const words = normalizeArabic(query)
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => word.slice(0, 40));
  if (words.length === 0 || normalizeArabic(query).length < 2) return [];

  return withTenant(db, auth.tenantId, async (tx) => {
    const allowed = async (permission: 'purchases.manage' | 'customers.view' | 'catalog.manage') => {
      const scope = await permissionScope(tx, auth.userId, permission);
      return scope.all || scope.branchIds.size > 0 ? scope : null;
    };
    /** `col in (branches)` for a user bound to branches; nothing for one who sees all */
    const inBranches = (scope: NonNullable<Awaited<ReturnType<typeof allowed>>>, column: SQL): SQL =>
      scope.all
        ? sql`true`
        : sql`${column} in (${sql.join(
            [...scope.branchIds].map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
    const hits: RecordHit[] = [];

    const purchases = await allowed('purchases.manage');
    if (purchases) {
      const suppliers = await tx.execute<{ id: string; name: string; phone: string | null }>(sql`
        select id, name, phone from suppliers
        where archived_at is null and ${hasWords(folded(sql`name`, sql`phone`), words)}
        order by name limit ${EACH}`);
      for (const s of suppliers)
        hits.push({
          key: `s:${s.id}`,
          group: 'الموردون',
          label: s.name,
          ...(s.phone ? { detail: s.phone } : {}),
          to: `/suppliers/${s.id}/statement`,
        });

      const invoices = await tx.execute<{ id: string; number: string; supplier: string }>(sql`
        select p.id, p.number, s.name as supplier
        from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
        where ${inBranches(purchases, sql`p.branch_id`)}
          and ${hasWords(folded(sql`p.number`, sql`p.reference`, sql`s.name`), words)}
        order by p.business_date desc, p.number desc limit ${EACH}`);
      for (const p of invoices)
        hits.push({
          key: `u:${p.id}`,
          group: 'فواتير الشراء',
          label: p.number,
          detail: p.supplier,
          to: `/purchases?q=${encodeURIComponent(p.number)}`,
        });

      const returns = await tx.execute<{ id: string; number: string; supplier: string }>(sql`
        select r.id, r.number, s.name as supplier
        from supplier_returns r join suppliers s on s.tenant_id = r.tenant_id and s.id = r.supplier_id
        where ${inBranches(purchases, sql`r.branch_id`)}
          and ${hasWords(folded(sql`r.number`, sql`s.name`), words)}
        order by r.business_date desc, r.number desc limit ${EACH}`);
      for (const r of returns)
        hits.push({
          key: `t:${r.id}`,
          group: 'مرتجعات الموردين',
          label: r.number,
          detail: r.supplier,
          to: '/supplier-returns',
        });
    }

    const customers = await allowed('customers.view');
    if (customers) {
      const people = await tx.execute<{ id: string; name: string; phone: string | null }>(sql`
        select id, name, phone from customers
        where archived_at is null and ${hasWords(folded(sql`name`, sql`phone`), words)}
        order by name limit ${EACH}`);
      for (const c of people)
        hits.push({
          key: `c:${c.id}`,
          group: 'الزبائن',
          label: c.name,
          ...(c.phone ? { detail: c.phone } : {}),
          to: `/customers/${c.id}`,
        });

      const orders = await tx.execute<{ id: string; number: string; customer_name: string }>(sql`
        select id, number, customer_name from online_orders
        where ${hasWords(folded(sql`number`, sql`customer_name`, sql`phone`), words)}
        order by seq desc limit ${EACH}`);
      for (const o of orders)
        hits.push({
          key: `o:${o.id}`,
          group: 'طلبات المتجر الإلكتروني',
          label: o.number,
          detail: o.customer_name,
          to: '/online-store',
        });

      const rentals = await tx.execute<{
        id: string;
        number: string;
        item: string;
        customer_name: string;
      }>(sql`
        select id, number, item, customer_name from rentals
        where ${inBranches(customers, sql`branch_id`)}
          and ${hasWords(folded(sql`number`, sql`customer_name`, sql`item`), words)}
        order by seq desc limit ${EACH}`);
      for (const x of rentals)
        hits.push({
          key: `r:${x.id}`,
          group: 'التأجير',
          label: x.number,
          detail: `${x.item} · ${x.customer_name}`,
          to: '/rentals',
        });
    }

    const catalog = await allowed('catalog.manage');
    if (catalog) {
      const claims = await tx.execute<{
        id: string;
        number: string;
        item: string;
        customer_name: string | null;
      }>(sql`
        select id, number, item, customer_name from warranty_claims
        where ${hasWords(folded(sql`number`, sql`serial`, sql`customer_name`, sql`item`), words)}
        order by seq desc limit ${EACH}`);
      for (const c of claims)
        hits.push({
          key: `w:${c.id}`,
          group: 'مطالبات الضمان',
          label: c.number,
          detail: `${c.item}${c.customer_name ? ` · ${c.customer_name}` : ''}`,
          to: '/warranty',
        });
    }
    return hits;
  });
}
