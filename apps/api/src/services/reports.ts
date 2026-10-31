import { sql, type SQL } from 'drizzle-orm';
import type {
  AccountListResponse,
  AccountRow,
  AccountType,
  CurrencyCode,
  DayReport,
  JournalEntry,
  JournalPage,
  JournalSourceType,
  PaymentMethod,
  ShiftCurrencyReport,
  ShiftListResponse,
  ShiftReport,
  ShiftSummary,
  SyncEvidence,
  TradeRate,
  TrialBalance,
  dayReportQuery,
  journalQuery,
  shiftListQuery,
  syncEvidenceQuery,
  trialBalanceQuery,
} from '@serva/core';
import type { Permission } from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { formatDocNumber } from '@serva/sync';
import type { z } from 'zod';
import { forbidden, inScope, permissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/**
 * The report and accounting routes of packages/core › contracts/accounting.ts. Everything is read
 * from what the documents stored (invoices, payments, shifts, drawer movements) and from the
 * journal; nothing here writes. Each route checks its permission for the branch asked, or limits
 * itself to the branches the caller holds it in.
 */

const notFound = (message: string) => new AppError(404, 'not_found', message);
const num = (value: unknown) => Number(value ?? 0);
const iso = (value: unknown) =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

/** The branches a report may read: one asked for, or every branch the caller holds the key in. */
interface BranchFilter {
  /** null: every branch of the store */
  ids: string[] | null;
}

async function branchFilter(
  tx: Transaction,
  auth: AccessClaims,
  permission: Permission,
  branchId: string | undefined,
): Promise<BranchFilter> {
  const scope = await permissionScope(tx, auth.userId, permission);
  if (branchId) {
    if (!inScope(scope, branchId)) throw forbidden();
    const [branch] = await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`);
    if (!branch) throw notFound('هذا الفرع غير موجود.');
    return { ids: [branchId] };
  }
  if (scope.all) return { ids: null };
  if (scope.branchIds.size === 0) throw forbidden();
  return { ids: [...scope.branchIds] };
}

/** `column in (the branches)`, or true for every branch. */
const inBranches = (column: SQL, filter: BranchFilter): SQL =>
  filter.ids === null
    ? sql`true`
    : sql`${column} in (${sql.join(
        filter.ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;

async function baseCurrencyOf(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function listAccounts(db: Database, auth: AccessClaims): Promise<AccountListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await branchFilter(tx, auth, 'accounting.view', undefined);
    const rows = await tx.execute<{
      id: string;
      code: string;
      name: string;
      name_en: string | null;
      type: AccountType;
      parent_code: string | null;
      is_group: boolean;
      is_system: boolean;
      currency: CurrencyCode | null;
    }>(sql`
      select id, code, name, name_en, type, parent_code, is_group, is_system, currency
      from accounts where archived_at is null order by code`);
    return {
      items: rows.map((r): AccountRow => ({
        id: r.id,
        code: r.code,
        name: r.name,
        nameEn: r.name_en,
        type: r.type,
        parentCode: r.parent_code,
        isGroup: r.is_group,
        isSystem: r.is_system,
        currency: r.currency,
      })),
    };
  });
}

// ─── Day report ──────────────────────────────────────────────────────────────

/**
 * Payments by method and currency, cash net of the change given in that currency (as the Z
 * report prints it), over the invoices `where` selects.
 */
async function paymentsByMethod(tx: Transaction, where: SQL) {
  const rows = await tx.execute<{
    method: PaymentMethod;
    currency: CurrencyCode;
    amount: string;
    base: string;
    count: string;
  }>(sql`
    with inv as (select i.id, i.payload -> 'change' as change from invoices i where ${where}),
    paid as (
      select p.method, p.currency, p.amount_minor as amount, p.base_amount_minor as base, p.invoice_id
      from invoice_payments p join inv on inv.id = p.invoice_id
      union all
      select 'cash', inv.change ->> 'currency', -(inv.change ->> 'amountMinor')::bigint,
             -(inv.change ->> 'baseAmountMinor')::bigint, null
      from inv where jsonb_typeof(inv.change) = 'object'
    )
    select method, currency, sum(amount)::text as amount, sum(base)::text as base,
           count(distinct invoice_id)::text as count
    from paid group by method, currency
    order by array_position(array['cash', 'card', 'wallet', 'transfer', 'credit'], method), currency`);
  return rows.map((r) => ({
    method: r.method,
    currency: r.currency,
    amountMinor: num(r.amount),
    baseAmountMinor: num(r.base),
    count: num(r.count),
  }));
}

export async function dayReport(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof dayReportQuery>,
): Promise<DayReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const filter = await branchFilter(tx, auth, 'report.view', query.branchId);
    const where = sql`i.business_date = ${query.date} and ${inBranches(sql`i.branch_id`, filter)}`;
    const [totals] = await tx.execute<Record<string, string>>(sql`
      select count(*)::text as n, coalesce(sum(gross_minor), 0)::text as gross,
             coalesce(sum(discount_minor), 0)::text as discount, coalesce(sum(tax_minor), 0)::text as tax,
             coalesce(sum(total_minor), 0)::text as total, coalesce(sum(tip_minor), 0)::text as tips,
             coalesce(sum(rounding_base_minor), 0)::text as rounding
      from invoices i where ${where}`);
    const cashiers = await tx.execute<{ id: string; name: string | null; n: string; total: string }>(sql`
      select i.cashier_id as id, u.full_name as name, count(*)::text as n, sum(i.total_minor)::text as total
      from invoices i left join users u on u.id = i.cashier_id
      where ${where}
      group by i.cashier_id, u.full_name order by sum(i.total_minor) desc, i.cashier_id`);
    const total = num(totals?.total);
    const tax = num(totals?.tax);
    return {
      date: query.date,
      branchId: query.branchId ?? null,
      invoiceCount: num(totals?.n),
      grossMinor: num(totals?.gross),
      discountMinor: num(totals?.discount),
      netExTaxMinor: total - tax,
      taxMinor: tax,
      totalMinor: total,
      tipsMinor: num(totals?.tips),
      cashRoundingMinor: num(totals?.rounding),
      byMethod: await paymentsByMethod(tx, where),
      byCashier: cashiers.map((c) => ({
        userId: c.id,
        fullName: c.name ?? '',
        invoiceCount: num(c.n),
        totalMinor: num(c.total),
      })),
      baseCurrency: await baseCurrencyOf(tx),
    };
  });
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

type ShiftRow = {
  id: string;
  number: string | null;
  branch_id: string;
  device_code: string;
  opened_by: string | null;
  opened_by_name: string | null;
  opened_at: string | null;
  closed_at: string | null;
  status: 'open' | 'closed';
  sales_count: string;
  sales_total: string;
  opening: { currency: CurrencyCode; amountMinor: number }[] | null;
  closing: {
    cash: { currency: CurrencyCode; openingMinor: number; countedMinor: number }[];
  } | null;
};

async function shiftRows(tx: Transaction, where: SQL): Promise<ShiftRow[]> {
  return tx.execute<ShiftRow>(sql`
    select s.id, s.number, s.branch_id, d.code as device_code, s.opened_by, u.full_name as opened_by_name,
           s.opened_at, s.closed_at, s.status, s.opening, s.closing,
           (select count(*) from invoices i where i.shift_id = s.id)::text as sales_count,
           (select coalesce(sum(i.total_minor), 0) from invoices i where i.shift_id = s.id)::text as sales_total
    from shifts s
    join devices d on d.id = s.device_id
    left join users u on u.id = s.opened_by
    where ${where}
    order by coalesce(s.opened_at, s.closed_at), s.id`);
}

const summaryOf = (r: ShiftRow): ShiftSummary => ({
  id: r.id,
  number: r.number ?? '',
  branchId: r.branch_id,
  deviceCode: r.device_code,
  openedBy: r.opened_by ? { id: r.opened_by, fullName: r.opened_by_name ?? '' } : null,
  openedAt: iso(r.opened_at),
  closedAt: iso(r.closed_at),
  status: r.status,
  salesCount: num(r.sales_count),
  salesTotalMinor: num(r.sales_total),
});

export async function listShifts(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof shiftListQuery>,
): Promise<ShiftListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const filter = await branchFilter(tx, auth, 'report.view', query.branchId);
    // A shift's day is its opening's business day; a close that came alone, its closing day.
    const day = query.date
      ? sql`coalesce(s.business_date,
          (select (s.closed_at at time zone t.timezone)::date from tenants t where t.id = s.tenant_id)) = ${query.date}`
      : sql`true`;
    const rows = await shiftRows(tx, sql`${inBranches(sql`s.branch_id`, filter)} and ${day}`);
    return { items: rows.map(summaryOf) };
  });
}

/**
 * GET /v1/shifts/{id}: the drawer of each currency by the formula of 10 › مطابقة الصندوق, from the
 * documents the server holds (an open shift's X report too). The expected amount and the
 * difference are only for those who may see them (shift.view_difference).
 */
export async function shiftReport(db: Database, auth: AccessClaims, id: string): Promise<ShiftReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [row] = await shiftRows(tx, sql`s.id = ${id}`);
    if (!row) throw notFound('هذه الوردية غير موجودة.');
    const scope = await permissionScope(tx, auth.userId, 'report.view');
    if (!inScope(scope, row.branch_id)) throw forbidden();
    const seesDifference = inScope(
      await permissionScope(tx, auth.userId, 'shift.view_difference'),
      row.branch_id,
    );

    const ofShift = sql`i.shift_id = ${id}`;
    const byMethod = await paymentsByMethod(tx, ofShift);
    const flows = await tx.execute<{ currency: CurrencyCode; kind: string; amount: string }>(sql`
      select p.currency, 'cash_in' as kind, sum(p.amount_minor)::text as amount
      from invoice_payments p join invoices i on i.id = p.invoice_id
      where ${ofShift} and p.method = 'cash' group by p.currency
      union all
      select i.payload -> 'change' ->> 'currency', 'change', sum((i.payload -> 'change' ->> 'amountMinor')::bigint)::text
      from invoices i where ${ofShift} and jsonb_typeof(i.payload -> 'change') = 'object'
      group by i.payload -> 'change' ->> 'currency'
      union all
      select m.currency, m.kind, sum(m.amount_minor)::text from cash_movements m
      where m.shift_id = ${id} group by m.currency, m.kind`);
    const movements = await tx.execute<{
      id: string;
      kind: ShiftReport['movements'][number]['kind'];
      currency: CurrencyCode;
      amount: string;
      reason: string;
      approver: string | null;
      approver_name: string | null;
      at: string | null;
    }>(sql`
      select m.id, m.kind, m.currency, m.amount_minor::text as amount, m.reason,
             u.id as approver, u.full_name as approver_name,
             coalesce(x.device_time, m.created_at) as at
      from cash_movements m
      left join users u on u.id = (m.approval ->> 'userId')::uuid
      left join sync_inbox x on x.doc_id = m.id
      where m.shift_id = ${id}
      order by coalesce(x.device_time, m.created_at), m.id`);

    const currencies = new Map<CurrencyCode, ShiftCurrencyReport>();
    const drawer = (currency: CurrencyCode) => {
      let d = currencies.get(currency);
      if (!d) {
        d = {
          currency,
          openingMinor: 0,
          cashSalesMinor: 0,
          changeGivenMinor: 0,
          payInMinor: 0,
          payOutMinor: 0,
          dropsMinor: 0,
          expectedMinor: null,
          countedMinor: null,
          differenceMinor: null,
        };
        currencies.set(currency, d);
      }
      return d;
    };
    // The opening count, or the close's copy of it when the opening has not arrived.
    const opening =
      row.opening ?? row.closing?.cash.map((c) => ({ currency: c.currency, amountMinor: c.openingMinor }));
    for (const o of opening ?? []) drawer(o.currency).openingMinor = o.amountMinor;
    for (const f of flows) {
      const d = drawer(f.currency);
      const amount = num(f.amount);
      if (f.kind === 'cash_in') d.cashSalesMinor += amount;
      else if (f.kind === 'change') d.changeGivenMinor += amount;
      else if (f.kind === 'pay_in') d.payInMinor += amount;
      else if (f.kind === 'pay_out' || f.kind === 'expense') d.payOutMinor += amount;
      else if (f.kind === 'safe_drop') d.dropsMinor += amount;
    }
    for (const c of row.closing?.cash ?? []) drawer(c.currency).countedMinor = c.countedMinor;
    for (const d of currencies.values()) {
      const expected =
        d.openingMinor + d.cashSalesMinor - d.changeGivenMinor + d.payInMinor - d.payOutMinor - d.dropsMinor;
      d.expectedMinor = seesDifference ? expected : null;
      d.differenceMinor = seesDifference && d.countedMinor !== null ? d.countedMinor - expected : null;
    }

    return {
      ...summaryOf(row),
      byCurrency: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      byMethod: byMethod.map(({ baseAmountMinor: _base, ...m }) => m),
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        currency: m.currency,
        amountMinor: num(m.amount),
        reason: m.reason,
        approvedBy: m.approver ? { id: m.approver, fullName: m.approver_name ?? '' } : null,
        at: iso(m.at)!,
      })),
    };
  });
}

// ─── Journal ─────────────────────────────────────────────────────────────────

const encodeCursor = (year: number, seq: number) => Buffer.from(`${year}:${seq}`).toString('base64url');
function decodeCursor(cursor: string | undefined): { year: number; seq: number } | null {
  if (!cursor) return null;
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
  const [year, seq] = parts.map(Number);
  if (parts.length !== 2 || !Number.isSafeInteger(year) || !Number.isSafeInteger(seq)) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { cursor: 'مؤشر غير صالح' });
  }
  return { year: year!, seq: seq! };
}

/** GET /v1/journal: the journal book in number order (10 › رقم القيد), filtered by date and branch. */
export async function journal(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof journalQuery>,
): Promise<JournalPage> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const filter = await branchFilter(tx, auth, 'accounting.view', query.branchId);
    const after = decodeCursor(query.cursor);
    const conditions: SQL[] = [inBranches(sql`e.branch_id`, filter)];
    if (query.from) conditions.push(sql`e.entry_date >= ${query.from}`);
    if (query.to) conditions.push(sql`e.entry_date <= ${query.to}`);
    if (after) conditions.push(sql`(e.year, e.seq) > (${after.year}, ${after.seq})`);
    const entries = await tx.execute<{
      id: string;
      year: number;
      seq: number;
      number: string;
      entry_date: string;
      source_type: JournalSourceType;
      source_id: string;
      source_number: string | null;
      memo: string;
      total: string;
    }>(sql`
      select e.id, e.year, e.seq, e.number, e.entry_date::text as entry_date, e.source_type, e.source_id,
             e.source_number, e.memo, e.total_minor::text as total
      from journal_entries e where ${sql.join(conditions, sql` and `)}
      order by e.year, e.seq limit ${query.limit + 1}`);
    const page = entries.slice(0, query.limit);
    const lines = page.length
      ? await tx.execute<{
          entry_id: string;
          code: string;
          name: string;
          debit: string;
          credit: string;
          currency: CurrencyCode;
          amount: string;
          rate: TradeRate | null;
        }>(sql`
          select l.entry_id, a.code, a.name, l.debit_minor::text as debit, l.credit_minor::text as credit,
                 l.currency, l.amount_minor::text as amount, l.rate
          from journal_lines l join accounts a on a.id = l.account_id
          where l.entry_id in (${sql.join(
            page.map((e) => sql`${e.id}::uuid`),
            sql`, `,
          )})
          order by l.entry_id, l.line_no`)
      : [];
    const byEntry = new Map<string, JournalEntry['lines']>();
    for (const l of lines) {
      const list = byEntry.get(l.entry_id) ?? [];
      list.push({
        accountCode: l.code,
        accountName: l.name,
        debitMinor: num(l.debit),
        creditMinor: num(l.credit),
        currency: l.currency,
        amountMinor: Math.abs(num(l.amount)),
        rate: l.rate,
      });
      byEntry.set(l.entry_id, list);
    }
    const last = page.at(-1);
    return {
      items: page.map((e) => ({
        id: e.id,
        number: e.number,
        date: e.entry_date,
        source: { type: e.source_type, id: e.source_id, number: e.source_number },
        memo: e.memo,
        lines: byEntry.get(e.id) ?? [],
        totalMinor: num(e.total),
      })),
      nextCursor: entries.length > query.limit && last ? encodeCursor(last.year, last.seq) : null,
    };
  });
}

// ─── Trial balance ───────────────────────────────────────────────────────────

/**
 * GET /v1/reports/trial-balance: per posted-to account, the balance before `from`, the movements
 * from `from` to `to`, and the balance at `to`, signed by the account's normal side.
 */
export async function trialBalance(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof trialBalanceQuery>,
): Promise<TrialBalance> {
  if (query.from > query.to) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
      to: 'تاريخ النهاية قبل تاريخ البداية',
    });
  }
  return withTenant(db, auth.tenantId, async (tx) => {
    const filter = await branchFilter(tx, auth, 'accounting.view', query.branchId);
    const rows = await tx.execute<{
      code: string;
      name: string;
      type: AccountType;
      normal_side: 'debit' | 'credit';
      opening: string;
      debit: string;
      credit: string;
    }>(sql`
      select a.code, a.name, a.type, a.normal_side,
             coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.entry_date < ${query.from}), 0)::text as opening,
             coalesce(sum(l.debit_minor) filter (where e.entry_date >= ${query.from}), 0)::text as debit,
             coalesce(sum(l.credit_minor) filter (where e.entry_date >= ${query.from}), 0)::text as credit
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.entry_date <= ${query.to} and ${inBranches(sql`e.branch_id`, filter)}
      group by a.code, a.name, a.type, a.normal_side
      order by a.code`);
    let debitTotal = 0;
    let creditTotal = 0;
    let openingNet = 0;
    const result = rows.flatMap((r) => {
      const opening = num(r.opening);
      const debit = num(r.debit);
      const credit = num(r.credit);
      if (opening === 0 && debit === 0 && credit === 0) return [];
      debitTotal += debit;
      creditTotal += credit;
      openingNet += opening;
      const sign = r.normal_side === 'debit' ? 1 : -1;
      return [
        {
          accountCode: r.code,
          accountName: r.name,
          type: r.type,
          openingMinor: sign * opening + 0,
          debitMinor: debit,
          creditMinor: credit,
          closingMinor: sign * (opening + debit - credit) + 0,
        },
      ];
    });
    return {
      from: query.from,
      to: query.to,
      rows: result,
      totals: { debitMinor: debitTotal, creditMinor: creditTotal },
      balanced: debitTotal === creditTotal && openingNet === 0,
    };
  });
}

// ─── Evidence screen ─────────────────────────────────────────────────────────

/** GET /v1/sync/evidence (23 › شاشة الدليل): what one device sent and what became of it. */
export async function syncEvidence(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof syncEvidenceQuery>,
): Promise<SyncEvidence> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [device] = await tx.execute<{
      id: string;
      name: string;
      code: string;
      branch_id: string;
      branch_code: string;
    }>(
      sql`select d.id, d.name, d.code, d.branch_id, b.code as branch_code
          from devices d join branches b on b.id = d.branch_id where d.id = ${query.deviceId}`,
    );
    if (!device) throw notFound('هذا الجهاز غير موجود.');
    const scope = await permissionScope(tx, auth.userId, 'devices.view');
    if (!inScope(scope, device.branch_id)) throw forbidden();
    const day = query.date ? sql`and business_date = ${query.date}` : sql``;
    const [counts] = await tx.execute<Record<string, string>>(sql`
      select count(*)::text as sent,
             count(*) filter (where status in ('accepted', 'pending_link'))::text as accepted,
             coalesce(sum(duplicate_count), 0)::text as duplicate,
             count(*) filter (where status = 'rejected')::text as rejected,
             count(*) filter (where status = 'quarantined')::text as quarantined
      from sync_inbox where device_id = ${device.id} ${day}`);
    const sequences = await tx.execute<{ series: string; announced: number; received: number }>(sql`
      select series, last_announced as announced, last_received as received
      from doc_sequences where device_id = ${device.id} order by series`);
    const numberOf = (series: string, sequence: number) =>
      sequence > 0
        ? formatDocNumber({ series, branchCode: device.branch_code, deviceCode: device.code, sequence })
        : null;
    return {
      deviceId: device.id,
      deviceName: device.name,
      sent: num(counts?.sent),
      accepted: num(counts?.accepted),
      duplicate: num(counts?.duplicate),
      rejected: num(counts?.rejected),
      quarantined: num(counts?.quarantined),
      lastAnnouncedNumber: Object.fromEntries(
        sequences.map((s) => [s.series, numberOf(s.series, s.announced)]),
      ),
      lastReceivedNumber: Object.fromEntries(
        sequences.map((s) => [s.series, numberOf(s.series, s.received)]),
      ),
    };
  });
}
