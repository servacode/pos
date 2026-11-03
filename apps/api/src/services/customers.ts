import { sql } from 'drizzle-orm';
import type {
  CurrencyCode,
  CustomerDetail,
  CustomerInput,
  CustomerListItem,
  CustomerListResponse,
  StatementLine,
} from '@serva/core';
import { normalizeArabic } from '@serva/core/text';
import { customers, withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../auth/permissions';
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
      select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.archived_at,
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
    select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.archived_at, c.tax_number, c.address,
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
