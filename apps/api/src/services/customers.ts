import { sql } from 'drizzle-orm';
import type {
  CurrencyCode,
  CustomerDetail,
  CustomerInput,
  CustomerListItem,
  CustomerListResponse,
  CustomerPurchases,
  StatementLine,
} from '@serva/core';
import { normalizeArabic } from '@serva/core/text';
import { customers, withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../auth/permissions';
import type { DeviceClaims } from '../auth/device-guard';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * Customers (packages/core › contracts/customers.ts): the list with what each owes, one customer
 * with their statement, and the owner's changes. A balance is always read from the ledger (the
 * 1200 lines that name the customer), never kept beside it.
 */

const newId = createUuidV7();
const notFound = () => new AppError(404, 'not_found', 'هذا الزبون غير موجود.');

async function baseCurrency(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

type Row = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit_minor: string | null;
  price_tier: string;
  no_messages: boolean;
  archived_at: string | null;
  balance: string;
};

const balances = sql`
  select l.party_id as customer_id, sum(l.debit_minor - l.credit_minor) as balance
  from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where a.code = '1200' and l.party_type = 'customer'
  group by l.party_id`;

const item = (r: Row): CustomerListItem => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  creditLimitMinor: r.credit_limit_minor === null ? null : Number(r.credit_limit_minor),
  balanceMinor: Number(r.balance),
  priceTier: r.price_tier === 'wholesale' ? 'wholesale' : 'retail',
  noMessages: r.no_messages,
  archived: r.archived_at !== null,
});

export async function listCustomers(
  db: Database,
  auth: AccessClaims,
  query: { q?: string; owing?: boolean },
): Promise<CustomerListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const rows = await tx.execute<Row>(sql`
      select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.no_messages, c.archived_at,
             coalesce(b.balance, 0)::text as balance
      from customers c left join (${balances}) b on b.customer_id = c.id
      order by coalesce(b.balance, 0) desc, c.name, c.id`);
    const q = query.q ? normalizeArabic(query.q) : '';
    const digits = query.q?.replace(/\D/g, '') ?? '';
    const items = rows
      .map(item)
      .filter(
        (c) =>
          !q ||
          normalizeArabic(c.name).includes(q) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits.replace(/^0/, ''))),
      )
      .filter((c) => !query.owing || c.balanceMinor > 0);
    return {
      items,
      totalOwedMinor: items.reduce((sum, c) => sum + Math.max(0, c.balanceMinor), 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

async function detail(tx: Transaction, id: string): Promise<CustomerDetail> {
  const [row] = await tx.execute<
    Row & { tax_number: string | null; address: string | null; notes: string | null; created_at: string }
  >(sql`
    select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.no_messages, c.archived_at, c.tax_number, c.address,
           c.notes, c.created_at, coalesce(b.balance, 0)::text as balance
    from customers c left join (${balances}) b on b.customer_id = c.id
    where c.id = ${id}`);
  if (!row) throw notFound();
  const lines = await tx.execute<{
    date: string;
    source_type: string;
    source_id: string;
    number: string | null;
    memo: string;
    debit: string;
    credit: string;
  }>(sql`
    select e.entry_date::text as date, e.source_type, e.source_id, e.source_number as number, e.memo,
           l.debit_minor::text as debit, l.credit_minor::text as credit
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where a.code = '1200' and l.party_type = 'customer' and l.party_id = ${id}
    order by e.entry_date, e.year, e.seq, l.line_no`);
  let running = 0;
  const statement: StatementLine[] = lines.map((l) => {
    running += Number(l.debit) - Number(l.credit);
    return {
      date: l.date,
      sourceType: l.source_type,
      sourceId: l.source_id,
      number: l.number,
      memo: l.memo,
      debitMinor: Number(l.debit),
      creditMinor: Number(l.credit),
      balanceMinor: running,
    };
  });
  return {
    ...item(row),
    taxNumber: row.tax_number,
    address: row.address,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    statement,
    baseCurrency: await baseCurrency(tx),
  };
}

export async function readCustomer(db: Database, auth: AccessClaims, id: string): Promise<CustomerDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    return detail(tx, id);
  });
}

const fields = (input: CustomerInput, now: Date) => ({
  name: input.name,
  ...(input.phone !== undefined ? { phone: input.phone } : {}),
  ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
  ...(input.address !== undefined ? { address: input.address } : {}),
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  ...(input.creditLimitMinor !== undefined ? { creditLimitMinor: input.creditLimitMinor } : {}),
  ...(input.priceTier !== undefined ? { priceTier: input.priceTier } : {}),
  ...(input.noMessages !== undefined ? { noMessages: input.noMessages } : {}),
  ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
});

export async function createCustomer(
  db: Database,
  auth: AccessClaims,
  input: CustomerInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const id = newId();
    await tx.insert(customers).values({ tenantId: auth.tenantId, id, ...fields(input, now) });
    const created = await detail(tx, id);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'customer.create',
        entity: 'customer',
        entityId: id,
        changes: { name: [null, created.name], creditLimitMinor: [null, created.creditLimitMinor] },
      },
      meta,
    );
    return created;
  });
}

export async function updateCustomer(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: CustomerInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const before = await detail(tx, id);
    await tx
      .update(customers)
      .set({ ...fields(input, now), updatedAt: now })
      .where(eq(customers.id, id));
    const after = await detail(tx, id);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of [
      'name',
      'phone',
      'taxNumber',
      'address',
      'notes',
      'creditLimitMinor',
      'priceTier',
      'archived',
    ] as const) {
      if (before[key] !== after[key]) changes[key] = [before[key], after[key]];
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'customer.update',
        entity: 'customer',
        entityId: id,
        changes,
      },
      meta,
    );
    return after;
  });
}

// ─── What a customer bought (03 › الألبسة: سجل الزبون ومقاسه) ─────────────────

async function purchasesOf(tx: Transaction, id: string): Promise<CustomerPurchases> {
  const [known] = await tx.execute<{ id: string }>(sql`select id from customers where id = ${id}`);
  if (!known) throw notFound();
  const returned = sql`coalesce((select sum(rl.base_qty) from sale_return_lines rl
    join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
    where r.sale_id = l.invoice_id and rl.sale_line_no = l.line_no), 0)`;
  const invoices = await tx.execute<{
    id: string;
    number: string;
    date: string;
    total: string;
    currency: string;
  }>(sql`
    select id, number, business_date::text as date, total_minor::text as total, currency
    from invoices where customer_id = ${id}
    order by business_date desc, device_time desc, id desc limit 20`);
  const lines =
    invoices.length === 0
      ? []
      : await tx.execute<{ invoice_id: string; name: string; qty: string; total: string; back: string }>(sql`
          select l.invoice_id, l.name, l.base_qty::text as qty, l.total_minor::text as total,
                 ${returned}::text as back
          from invoice_lines l
          where l.invoice_id in (${sql.join(
            invoices.map((i) => sql`${i.id}::uuid`),
            sql`, `,
          )})
          order by l.invoice_id, l.line_no`);
  // Colour tells what someone likes, not what fits: every other option counts as a size
  const sizes = await tx.execute<{ name: string; value: string; qty: string }>(sql`
    select a->>'name' as name, a->>'value' as value, sum(l.base_qty - ${returned})::text as qty
    from invoice_lines l
    join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
    join variants v on v.id = l.variant_id
    cross join lateral jsonb_array_elements(v.attributes) a
    where i.customer_id = ${id} and coalesce(a->>'name', '') <> '' and coalesce(a->>'value', '') <> ''
      and a->>'name' not like '%لون%'
    group by 1, 2
    having sum(l.base_qty - ${returned}) > 0
    order by 3 desc, 2`);
  const [totals] = await tx.execute<{ pieces: string; spent: string }>(sql`
    select coalesce((select sum(l.base_qty - ${returned}) from invoice_lines l
                     join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
                     where i.customer_id = ${id}), 0)::text as pieces,
           (coalesce((select sum(total_minor) from invoices where customer_id = ${id}), 0)
            - coalesce((select sum(r.total_minor) from sale_returns r
                        join invoices i on i.tenant_id = r.tenant_id and i.id = r.sale_id
                        where i.customer_id = ${id}), 0))::text as spent`);
  const byName = new Map<string, { value: string; qty: number }[]>();
  for (const s of sizes) {
    const list = byName.get(s.name) ?? [];
    list.push({ value: s.value, qty: Number(s.qty) });
    byName.set(s.name, list);
  }
  return {
    customerId: id,
    sizes: [...byName.entries()].map(([name, values]) => ({ name, values: values.slice(0, 5) })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      date: i.date,
      totalMinor: Number(i.total),
      currency: i.currency as CurrencyCode,
      lines: lines
        .filter((l) => l.invoice_id === i.id)
        .map((l) => ({
          name: l.name,
          qty: Number(l.qty),
          totalMinor: Number(l.total),
          returnedQty: Number(l.back),
        })),
    })),
    pieces: Number(totals?.pieces ?? 0),
    spentMinor: Number(totals?.spent ?? 0),
  };
}

export function customerPurchases(db: Database, auth: AccessClaims, id: string): Promise<CustomerPurchases> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    return purchasesOf(tx, id);
  });
}

/** The till's view: any signed-in cashier of the store may look a customer up while selling */
export function customerPurchasesForDevice(
  db: Database,
  device: DeviceClaims,
  id: string,
): Promise<CustomerPurchases> {
  return withTenant(db, device.tenantId, (tx) => purchasesOf(tx, id));
}
