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
  group_id?: string | null;
  group_name?: string | null;
  group_discount_bps?: number | null;
  birth_date?: string | null;
  balance: string;
  last?: string | null;
  spent?: string | null;
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
  groupId: r.group_id ?? null,
  groupName: r.group_name ?? null,
  groupDiscountBps: r.group_discount_bps ?? null,
  birthDate: r.birth_date ?? null,
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

const FOLD_FROM = 'أإآٱؤئىةیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
const FOLD_TO = 'ااااوييهيك01234567890123456789';
const escapeLike = (word: string): string => word.replace(/[\\%_]/g, (c) => '\\' + c);

/** The customer's name in the search form (diacritics out, hamza and ة/ى folded, digits Latin), done by the database */
const foldedName = sql`translate(lower(regexp_replace(regexp_replace(c.name, ${'[ً-ٰٟـ]'}, '', 'g'), '\\s+', ' ', 'g')), ${FOLD_FROM}, ${FOLD_TO})`;

/**
 * The list: one page at a time when `limit` is sent (balance high first, then name, or the order the
 * owner chose), the search, «من عليه دين», the group and the birthday month applied in SQL with a
 * LIMIT, so a store with thousands of customers reads one page, not all. What a customer bought (last
 * day, spend, size) is worked out only for the rows of the page, and only when `limit` is sent: a
 * picker (no `limit`) gets the name, phone and balance and nothing that costs a query over the invoices.
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
    /** Everything of the filters in one answer, for the Excel file (no totals, no paging) */
    export?: boolean;
    /** Only customers who bought before and not since this day (YYYY-MM-DD): «لم يزر منذ 90 يوماً» */
    lastBefore?: string;
    sort?: 'balance' | 'name' | 'last' | 'spent';
    dir?: 'asc' | 'desc';
    groupId?: string;
    birthMonth?: number;
  },
  meta?: RequestMeta,
): Promise<CustomerListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    // The Excel file carries every customer with phone, balance and spend: it needs the reports permission too
    if (query.export === true) await requirePermission(tx, auth.userId, 'report.view');
    const offset = decodeOffset(query.cursor);
    // The figures above the list (debts, who owes, all) ignore the group and the birthday month: an empty
    // birthday month must not read as «no debts at all»; the count of the list itself takes every filter
    const stripFilter = sql`${query.kind ? sql`c.kind = ${query.kind}` : sql`true`}
        and ${query.regionId ? sql`c.region_id = ${query.regionId}` : sql`true`}
        and ${query.approval ? sql`c.approval_status = ${query.approval}` : sql`true`}
        and ${
          query.lastBefore
            ? sql`exists (select 1 from invoices i where i.customer_id = c.id)
                and not exists (select 1 from invoices i where i.customer_id = c.id
                  and i.business_date >= ${query.lastBefore}::date)`
            : sql`true`
        }`;
    const listOnly = sql`${query.groupId ? sql`c.group_id = ${query.groupId}` : sql`true`}
        and ${query.birthMonth ? sql`extract(month from c.birth_date) = ${query.birthMonth}` : sql`true`}`;
    const filter = sql`${stripFilter} and ${listOnly}`;
    const q = query.q ? normalizeArabic(query.q) : '';
    // Arabic-Indic digits are digits too: «٠٩٤٤…» finds the same phone as «0944…»
    const digits = query.q ? toLatinDigits(query.q).replace(/\D/g, '') : '';
    const phoneNeedle = digits.replace(/^0/, '');
    const search = !q
      ? sql`true`
      : digits.length >= 3
        ? sql`(${foldedName} like ${`%${escapeLike(q)}%`}
               or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like ${`%${escapeLike(phoneNeedle)}%`})`
        : sql`${foldedName} like ${`%${escapeLike(q)}%`}`;
    const balance = sql`coalesce(b.balance, 0)`;
    const owingWhere = query.owing ? sql`${balance} > 0` : sql`true`;
    // A picker (a `q` or `lite`, no `limit`) gets the best 50, not every customer; a bare call is held at 500
    const exporting = query.export === true;
    const cap = exporting ? 50000 : (query.limit ?? (q || query.lite ? 50 : 500));
    const sort = query.sort ?? (query.birthMonth ? 'birth' : 'balance');
    const flip = query.dir === 'asc' ? sql`asc` : query.dir === 'desc' ? sql`desc` : null;
    const order =
      sort === 'name'
        ? sql`c.name ${flip ?? sql`asc`}, c.id`
        : sort === 'last'
          ? sql`s.last ${flip ?? sql`desc`} nulls last, c.name, c.id`
          : sort === 'spent'
            ? sql`coalesce(s.spent, 0) ${flip ?? sql`desc`}, c.name, c.id`
            : sort === 'birth'
              ? sql`extract(day from c.birth_date), c.name, c.id`
              : sql`${balance} ${flip ?? sql`desc`}, c.name, c.id`;
    const needSold = sort === 'last' || sort === 'spent' || exporting;
    const soldJoin = needSold
      ? sql`left join (
          select i.customer_id, max(i.business_date) as last,
                 sum(i.total_minor) - coalesce(sum((select sum(r.total_minor) from sale_returns r
                   where r.tenant_id = i.tenant_id and r.sale_id = i.id)), 0) as spent
          from invoices i where i.customer_id is not null group by i.customer_id) s on s.customer_id = c.id`
      : sql``;
    // Balances are added up over every 1200 line only when the order or the filter needs all of them
    // (balance high first, «من عليه دين»). Any other order picks the page first and reads the balances
    // of those rows alone, by the index (tenant, account, customer) that already holds debit and credit.
    const needAllBalances = sort === 'balance' || query.owing === true;
    const cols = sql`c.id, c.name, c.phone, c.credit_limit_minor::text, c.price_tier, c.no_messages, c.archived_at,
             c.kind, c.contact_name, c.contact_phone, c.region_id, g.name as region_name,
             c.approval_status, c.lat, c.lng, c.group_id, cg.name as group_name,
             cg.discount_bps as group_discount_bps, c.birth_date::text as birth_date`;
    const soldCols = exporting ? sql`, s.last::text as last, coalesce(s.spent, 0)::text as spent` : sql``;
    const rows = needAllBalances
      ? await tx.execute<Row>(sql`
      select ${cols},
             ${balance}::text as balance${soldCols}
      from customers c
      left join regions g on g.tenant_id = c.tenant_id and g.id = c.region_id
      left join customer_groups cg on cg.tenant_id = c.tenant_id and cg.id = c.group_id
      left join (${balances}) b on b.customer_id = c.id
      ${soldJoin}
      where ${filter} and ${search} and ${owingWhere}
      order by ${order}
      ${cap ? sql`limit ${cap + 1} offset ${offset}` : sql``}`)
      : await tx.execute<Row>(sql`
      select p.*, coalesce(bl.balance, 0)::text as balance
      from (
        select c.tenant_id, ${cols}${soldCols}, row_number() over (order by ${order}) as ord
        from customers c
        left join regions g on g.tenant_id = c.tenant_id and g.id = c.region_id
        left join customer_groups cg on cg.tenant_id = c.tenant_id and cg.id = c.group_id
        ${soldJoin}
        where ${filter} and ${search}
        order by ${order}
        ${cap ? sql`limit ${cap + 1} offset ${offset}` : sql``}) p
      left join lateral (
        select sum(l.debit_minor - l.credit_minor) as balance from journal_lines l
        where l.tenant_id = p.tenant_id
          and l.account_id = (select a.id from accounts a where a.tenant_id = p.tenant_id and a.code = '1200')
          and l.party_type = 'customer' and l.party_id = p.id) bl on true
      order by p.ord`);
    const hasMore = cap !== undefined && rows.length > cap;
    const page = (cap ? rows.slice(0, cap) : rows).map(item);
    const nextCursor = hasMore && cap ? encodeOffset(offset + cap) : null;
    if (exporting) {
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'customer.export',
          entity: 'customer',
          data: { rows: Math.min(rows.length, cap) },
        },
        meta ?? { ip: '', userAgent: null },
      );
      return {
        items: (rows.slice(0, cap) as Row[]).map((r) => ({
          ...item(r),
          lastPurchaseDate: r.last ?? null,
          spentMinor: Number(r.spent ?? 0),
          favouriteSize: null,
        })),
        totalOwedMinor: 0,
        nextCursor: null,
        baseCurrency: await baseCurrency(tx),
      };
    }
    const [totals] = await tx.execute<{
      all_n: string;
      owing_n: string;
      owed: string;
      owed_archived: string;
      matched: string;
    }>(sql`
      select count(*)::text as all_n,
             count(*) filter (where ${balance} > 0)::text as owing_n,
             coalesce(sum(${balance}) filter (where ${balance} > 0), 0)::text as owed,
             coalesce(sum(${balance}) filter (where ${balance} > 0 and c.archived_at is not null), 0)::text as owed_archived,
             count(*) filter (where ${search} and ${owingWhere} and ${listOnly})::text as matched
      from customers c left join (${balances}) b on b.customer_id = c.id
      where ${stripFilter}`);
    const [pending] = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from customers where approval_status = 'pending'`,
    );

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
      totalOwedMinor: Number(totals?.owed ?? 0),
      archivedOwedMinor: Number(totals?.owed_archived ?? 0),
      totalCount: Number(totals?.matched ?? 0),
      allCount: Number(totals?.all_n ?? 0),
      owingCount: Number(totals?.owing_n ?? 0),
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
           c.approval_status, c.lat, c.lng, c.group_id, cg.name as group_name,
           cg.discount_bps as group_discount_bps, c.birth_date::text as birth_date,
           c.notes, c.created_at, c.loyalty_points, coalesce(b.balance, 0)::text as balance
    from customers c left join (${balances}) b on b.customer_id = c.id
    left join regions g on g.tenant_id = c.tenant_id and g.id = c.region_id
    left join customer_groups cg on cg.tenant_id = c.tenant_id and cg.id = c.group_id
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
  ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
  ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
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
  if (input.groupId) {
    const [group] = await tx.execute<{ id: string }>(
      sql`select id from customer_groups where id = ${input.groupId} and archived_at is null`,
    );
    if (!group) throw invalid({ groupId: 'مجموعة غير موجودة' });
  }
  if ((input.lat === undefined || input.lat === null) !== (input.lng === undefined || input.lng === null)) {
    throw invalid({ lng: 'الموقع خط عرض وخط طول معاً' });
  }
}

/**
 * Another live customer with this phone (already in the international form): the owner is told and
 * may save anyway (`confirmDuplicate`). The phone reaches here normalised, Arabic digits included.
 */
async function assertPhoneFree(tx: Transaction, input: CustomerInput, selfId?: string): Promise<void> {
  if (!input.phone || input.confirmDuplicate) return;
  const [twin] = await tx.execute<{ id: string; name: string }>(sql`
    select id, name from customers
    where phone = ${input.phone} and archived_at is null ${selfId ? sql`and id <> ${selfId}` : sql``}
    order by created_at limit 1`);
  if (twin) {
    throw new AppError(409, 'conflict', `هذا الرقم مسجّل للزبون «${twin.name}». افتح حسابه أو أكّد الحفظ.`, {
      phone: 'الرقم مسجّل لزبون آخر',
      duplicateOf: twin.id,
    });
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
    await assertPhoneFree(tx, input);
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
    const [was] = await tx.execute<{ phone: string | null }>(
      sql`select phone from customers where id = ${id}`,
    );
    if (was && input.phone !== undefined && input.phone !== was.phone) await assertPhoneFree(tx, input, id);
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
    'groupId',
    'birthDate',
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
