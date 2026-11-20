import { sql } from 'drizzle-orm';
import type {
  CurrencyCode,
  CustomerDetail,
  CustomerInput,
  CustomerKind,
  CustomerListItem,
  CustomerListResponse,
  CustomerPurchases,
  StatementLine,
} from '@serva/core';
import { normalizeArabic, toLatinDigits } from '@serva/core/text';
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
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

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
  kind: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  region_id: string | null;
  region_name: string | null;
  approval_status: string;
  lat: number | null;
  lng: number | null;
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
  kind: (r.kind as CustomerKind | null) ?? null,
  contactName: r.contact_name,
  contactPhone: r.contact_phone,
  regionId: r.region_id,
  regionName: r.region_name,
  approvalStatus:
    r.approval_status === 'pending' || r.approval_status === 'rejected' ? r.approval_status : 'approved',
  lat: r.lat,
  lng: r.lng,
});

const decodeOffset = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!m) throw invalid({ cursor: 'صفحة غير صالحة. ارجع إلى أول القائمة' });
  return Number(m[1]);
};
const encodeOffset = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');

const uuidList = (ids: string[]) =>
  sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]::uuid[]`;

/**
 * The list: one page at a time when `limit` is sent (balance high first, then name), the search and
 * «من عليه دين» applied here. What a customer bought (last day, spend, size) is worked out only for
 * the rows of the page, and only when `limit` is sent: a picker (no `limit`) gets the name, phone and
 * balance and nothing that costs a query over the invoices.
 * `totalOwedMinor` is every debt of the store (the filters of kind, region and approval apply, the
 * search does not), so the tile does not shrink while the owner types.
 */
export async function listCustomers(
  db: Database,
  auth: AccessClaims,
  query: {
    q?: string;
    owing?: boolean;
    kind?: CustomerKind;
    regionId?: string;
    approval?: 'approved' | 'pending' | 'rejected';
    limit?: number;
    cursor?: string;
    lite?: boolean;
    /** Only customers who bought before and not since this day (YYYY-MM-DD): «لم يزر منذ 90 يوماً» */
    lastBefore?: string;
  },
): Promise<CustomerListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const offset = decodeOffset(query.cursor);
    const filter = sql`${query.kind ? sql`c.kind = ${query.kind}` : sql`true`}
        and ${query.regionId ? sql`c.region_id = ${query.regionId}` : sql`true`}
        and ${query.approval ? sql`c.approval_status = ${query.approval}` : sql`true`}`;
    const base = await tx.execute<Omit<Row, 'balance'>>(sql`
      select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.no_messages, c.archived_at,
             c.kind, c.contact_name, c.contact_phone, c.region_id, g.name as region_name,
             c.approval_status, c.lat, c.lng
      from customers c
      left join regions g on g.tenant_id = c.tenant_id and g.id = c.region_id
      where ${filter}
        and ${
          query.lastBefore
            ? sql`exists (select 1 from invoices i where i.customer_id = c.id)
                and not exists (select 1 from invoices i where i.customer_id = c.id
                  and i.business_date >= ${query.lastBefore}::date)`
            : sql`true`
        }`);
    const q = query.q ? normalizeArabic(query.q) : '';
    // Arabic-Indic digits are digits too: «٠٩٤٤…» finds the same phone as «0944…»
    const digits = query.q ? toLatinDigits(query.q).replace(/\D/g, '') : '';
    const phoneNeedle = digits.replace(/^0/, '');
    const matched = base.filter(
      (c) =>
        !q ||
        normalizeArabic(c.name).includes(q) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(phoneNeedle)),
    );
    // The balances of the matches only; the whole store's when nothing narrows the list
    const narrowed = q !== '' && matched.length < base.length;
    const owed =
      narrowed && matched.length === 0
        ? []
        : await tx.execute<{ customer_id: string; balance: string }>(
            narrowed
              ? sql`select customer_id, balance::text from (${balances}) b where b.customer_id = any(${uuidList(matched.map((c) => c.id))})`
              : sql`select customer_id, balance::text from (${balances}) b`,
          );
    const balanceBy = new Map(owed.map((r) => [r.customer_id, r.balance]));
    const baseIds = new Set(base.map((c) => c.id));
    let totalOwedMinor = 0;
    let owingCount = 0;
    if (!narrowed) {
      for (const r of owed) {
        if (baseIds.has(r.customer_id) && Number(r.balance) > 0) {
          totalOwedMinor += Number(r.balance);
          owingCount += 1;
        }
      }
    } else {
      const [all] = await tx.execute<{ owed: string; n: string }>(sql`
        select coalesce(sum(b.balance) filter (where b.balance > 0), 0)::text as owed,
               count(*) filter (where b.balance > 0)::text as n
        from customers c join (${balances}) b on b.customer_id = c.id
        where ${filter}`);
      totalOwedMinor = Number(all?.owed ?? 0);
      owingCount = Number(all?.n ?? 0);
    }
    const [pending] = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from customers where approval_status = 'pending'`,
    );
    const ranked = matched
      .map((r) => item({ ...r, balance: balanceBy.get(r.id) ?? '0' }))
      .filter((c) => !query.owing || c.balanceMinor > 0)
      .sort(
        (x, y) =>
          y.balanceMinor - x.balanceMinor ||
          (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      );
    const page = query.limit ? ranked.slice(offset, offset + query.limit) : ranked;
    const nextCursor =
      query.limit && offset + query.limit < ranked.length ? encodeOffset(offset + query.limit) : null;

    // The last purchase, spend and size cost a query over the invoices: only the paged list (`limit`) asks for them
    const extras = query.limit !== undefined && !query.lite;
    const soldBy = new Map<string, { last: string; spent: string }>();
    const sizeBy = new Map<string, string>();
    if (extras && page.length > 0) {
      const ids = uuidList(page.map((c) => c.id));
      // What each customer bought: the last day, the total net of returns, and the size they take most
      const sold = await tx.execute<{ customer_id: string; last: string; spent: string }>(sql`
        select i.customer_id, max(i.business_date)::text as last,
               (sum(i.total_minor) - coalesce(sum((select sum(r.total_minor) from sale_returns r
                                                   where r.tenant_id = i.tenant_id and r.sale_id = i.id)), 0))::text as spent
        from invoices i where i.customer_id = any(${ids}) group by i.customer_id`);
      for (const r of sold) soldBy.set(r.customer_id, r);
      const sizes = await tx.execute<{ customer_id: string; value: string }>(sql`
        select distinct on (customer_id) customer_id, value from (
          select i.customer_id, a->>'value' as value,
                 sum(l.base_qty - coalesce((select sum(rl.base_qty) from sale_return_lines rl
                   join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
                   where r.sale_id = l.invoice_id and rl.sale_line_no = l.line_no), 0)) as qty
          from invoice_lines l
          join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
          join variants v on v.id = l.variant_id
          cross join lateral jsonb_array_elements(v.attributes) a
          where i.customer_id = any(${ids}) and coalesce(a->>'name', '') <> '' and coalesce(a->>'value', '') <> ''
            and a->>'name' not like '%لون%'
          group by 1, 2) t
        where qty > 0 order by customer_id, qty desc, value`);
      for (const r of sizes) sizeBy.set(r.customer_id, r.value);
    }
    const items = !extras
      ? page
      : page.map((c) => ({
          ...c,
          lastPurchaseDate: soldBy.get(c.id)?.last ?? null,
          spentMinor: Number(soldBy.get(c.id)?.spent ?? 0),
          favouriteSize: sizeBy.get(c.id) ?? null,
        }));
    return {
      items,
      totalOwedMinor,
      totalCount: ranked.length,
      allCount: base.length,
      owingCount,
      pendingCount: Number(pending?.n ?? 0),
      nextCursor,
      baseCurrency: await baseCurrency(tx),
    };
  });
}

async function detail(tx: Transaction, id: string): Promise<CustomerDetail> {
  const [row] = await tx.execute<
    Row & {
      tax_number: string | null;
      address: string | null;
      notes: string | null;
      created_at: string;
      loyalty_points: number;
    }
  >(sql`
    select c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.no_messages, c.archived_at, c.tax_number, c.address,
           c.kind, c.contact_name, c.contact_phone, c.region_id, g.name as region_name,
           c.approval_status, c.lat, c.lng,
           c.notes, c.created_at, c.loyalty_points, coalesce(b.balance, 0)::text as balance
    from customers c left join (${balances}) b on b.customer_id = c.id
    left join regions g on g.tenant_id = c.tenant_id and g.id = c.region_id
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
    loyaltyPoints: row.loyalty_points,
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
  ...(input.kind !== undefined ? { kind: input.kind } : {}),
  ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
  ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
  ...(input.regionId !== undefined ? { regionId: input.regionId } : {}),
  ...(input.lat !== undefined ? { lat: input.lat } : {}),
  ...(input.lng !== undefined ? { lng: input.lng } : {}),
  ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
});

/** A region must be the store's own, and a location is a latitude with its longitude */
async function checkPlace(tx: Transaction, input: CustomerInput): Promise<void> {
  if (input.regionId) {
    const [region] = await tx.execute<{ id: string }>(
      sql`select id from regions where id = ${input.regionId}`,
    );
    if (!region) throw invalid({ regionId: 'منطقة غير موجودة' });
  }
  if ((input.lat === undefined || input.lat === null) !== (input.lng === undefined || input.lng === null)) {
    throw invalid({ lng: 'الموقع خط عرض وخط طول معاً' });
  }
}

export async function createCustomer(
  db: Database,
  auth: AccessClaims,
  input: CustomerInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    return createCustomerTx(tx, auth, input, meta, now);
  });
}

/** The write of createCustomer inside the caller's transaction (the import); permission checked by the caller. */
export async function createCustomerTx(
  tx: Transaction,
  auth: AccessClaims,
  input: CustomerInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  const id = newId();
  await checkPlace(tx, input);
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
    return updateCustomerTx(tx, auth, id, input, meta, now);
  });
}

/** The write of updateCustomer inside the caller's transaction (the import); permission checked by the caller. */
export async function updateCustomerTx(
  tx: Transaction,
  auth: AccessClaims,
  id: string,
  input: CustomerInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  const before = await detail(tx, id);
  await checkPlace(tx, input);
  // «أرشفه» is the same act as archiving a duplicate: a debt, a credit, an uncashed cheque or points stop it
  if (input.archived === true && !before.archived) await assertCanArchive(tx, id);
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
    'kind',
    'contactName',
    'contactPhone',
    'regionId',
    'lat',
    'lng',
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
  // What the customer owes now (account 1200), for the till's credit limit and the receipt
  const [owed] = await tx.execute<{ balance: string }>(sql`
    select coalesce(b.balance, 0)::text as balance
    from (select 1) one left join (${balances}) b on b.customer_id = ${id}::uuid`);
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
    balanceMinor: Number(owed?.balance ?? 0),
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

// ─── The duplicate customer (no merge: posted rows are never moved) ─────────────

/**
 * What stands in the way of archiving a customer, the reason in Arabic: an open balance (either
 * way), a cheque not cashed yet, loyalty points. Returns true when the customer is archived already.
 * Archiving never moves posted rows, so what is owed has to be settled first.
 */
async function assertCanArchive(tx: Transaction, id: string): Promise<boolean> {
  const [row] = await tx.execute<{
    archived_at: string | null;
    loyalty_points: number;
    balance: string;
  }>(sql`
    select c.archived_at, c.loyalty_points, coalesce(b.balance, 0)::text as balance
    from customers c left join (${balances}) b on b.customer_id = c.id
    where c.id = ${id}`);
  if (!row) throw notFound();
  if (row.archived_at !== null) return true;
  const refuse = (reason: string) => new AppError(409, 'conflict', reason);
  if (Number(row.balance) !== 0) {
    throw refuse(
      Number(row.balance) > 0
        ? 'عليه دين غير مسدّد. سدّد حسابه أو حوّله قبل الأرشفة.'
        : 'له رصيد عندنا. اصرفه له قبل الأرشفة.',
    );
  }
  const [open] = await tx.execute<{ n: string }>(sql`
    select count(*)::text as n from (
      select i.id from invoice_payments p
        join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
        where p.method = 'cheque' and i.customer_id = ${id}
          and not exists (select 1 from cheque_actions a where a.source_type = 'sale'
            and a.source_id = i.id and a.payment_no = p.payment_no)
      union all
      select r.id from receipts r
        where r.method = 'cheque' and r.customer_id = ${id}
          and not exists (select 1 from cheque_actions a where a.source_type = 'receipt'
            and a.source_id = r.id and a.payment_no = 1)
    ) x`);
  if (Number(open?.n ?? 0) > 0) throw refuse('عنده شيك لم يُصرف بعد. أنهِ أمره قبل الأرشفة.');
  if (row.loyalty_points > 0) throw refuse('عنده نقاط ولاء. استعملها أو انقلها قبل الأرشفة.');
  return false;
}

/**
 * «أرشف هذا الزبون المكرر»: archives a customer entered twice. Two customers are never merged (their
 * invoices and ledger lines are posted and stay as they are), so a duplicate that still owes or is
 * owed, holds a cheque not yet cashed or keeps loyalty points is refused, with the reason: it has
 * to be settled first, on the customer the owner keeps.
 */
export async function archiveDuplicateCustomer(
  db: Database,
  auth: AccessClaims,
  id: string,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const archivedBefore = await assertCanArchive(tx, id);
    if (archivedBefore) throw new AppError(409, 'conflict', 'هذا الزبون مؤرشف من قبل.');
    await tx.update(customers).set({ archivedAt: now, updatedAt: now }).where(eq(customers.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'customer.archive_duplicate',
        entity: 'customer',
        entityId: id,
        changes: { archived: [false, true] },
      },
      meta,
    );
    return detail(tx, id);
  });
}
