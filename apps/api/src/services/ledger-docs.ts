import { eq, sql, type SQL } from 'drizzle-orm';
import {
  buildProfitLoss,
  expenseLines,
  manualEntryLines,
  reversalLines,
  runStatement,
  type CurrencyCode,
  type ExpenseInput,
  type ExpenseListResponse,
  type ExpensePayFrom,
  type ExpenseRow,
  type LedgerLine,
  type ManualEntryInput,
  type ManualEntryRow,
  type PartyStatement,
  type Permission,
  type ProfitLoss,
  type TradeRate,
  type expenseListQuery,
  type profitLossQuery,
  type statementRangeQuery,
} from '@serva/core';
import { documentSequences, expenses, withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import type { z } from 'zod';
import { forbidden, inScope, permissionScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { postEntry, type DraftLine } from './posting';

/**
 * Statements, expenses, manual journal entries and the profit and loss (29 › المحاسبة المتقدمة;
 * packages/core › contracts/ledger-docs.ts). Statements and the profit and loss only read the
 * journal. An expense is a document that posts one automatic entry through postEntry, once; a manual
 * entry and a reversal go through the same postEntry, so numbering, the balance check and the
 * database's own checks are the ones every document gets. Nothing posted is ever changed: cancelling
 * is a reversing entry dated as the original.
 */

const newId = createUuidV7();
const num = (value: unknown) => Number(value ?? 0);
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

async function baseCurrencyOf(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

/** The latest rate of the pair, or null: one `unit` is worth `rate` of `quote` (the stored form). */
async function latestRate(tx: Transaction, a: CurrencyCode, b: CurrencyCode): Promise<TradeRate | null> {
  const [row] = await tx.execute<{ unit: string; quote: string; rate: string }>(sql`
    select unit, quote, rate from exchange_rates
    where (unit = ${a} and quote = ${b}) or (unit = ${b} and quote = ${a})
    order by effective_at desc, id desc limit 1`);
  return row ? ({ unit: row.unit, quote: row.quote, rate: row.rate } as TradeRate) : null;
}

/** The branches a read may cover: the one asked for, or every branch the caller holds the key in. */
async function readBranches(
  tx: Transaction,
  auth: AccessClaims,
  permission: Permission,
  branchId: string | undefined,
): Promise<string[] | null> {
  const scope = await permissionScope(tx, auth.userId, permission);
  if (branchId) {
    if (!inScope(scope, branchId)) throw forbidden();
    const [branch] = await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`);
    if (!branch) throw new AppError(404, 'not_found', 'هذا الفرع غير موجود.');
    return [branchId];
  }
  if (scope.all) return null;
  if (scope.branchIds.size === 0) throw forbidden();
  return [...scope.branchIds];
}

const inList = (column: SQL, ids: string[] | null): SQL =>
  ids === null
    ? sql`true`
    : sql`${column} in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;

function checkRange(range: { from: string; to: string }) {
  if (range.from > range.to) throw invalid({ to: 'تاريخ النهاية قبل تاريخ البداية' });
}

// ─── Statements ──────────────────────────────────────────────────────────────

type StatementRange = z.output<typeof statementRangeQuery>;

/**
 * One party's account between two days: the opening balance (every line before `from`), each
 * movement with its running balance, and the closing balance. A customer's is account 1200 (debit
 * balance: what they owe), a supplier's 2100 (credit balance: what the store owes).
 */
export async function partyStatement(
  db: Database,
  auth: AccessClaims,
  type: 'customer' | 'supplier',
  partyId: string,
  range: StatementRange,
): Promise<PartyStatement> {
  checkRange(range);
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, type === 'customer' ? 'customers.view' : 'purchases.manage');
    const [party] =
      type === 'customer'
        ? await tx.execute<{ id: string; name: string; phone: string | null }>(
            sql`select id, name, phone from customers where id = ${partyId}`,
          )
        : await tx.execute<{ id: string; name: string; phone: string | null }>(
            sql`select id, name, phone from suppliers where id = ${partyId}`,
          );
    if (!party) {
      throw new AppError(
        404,
        'not_found',
        type === 'customer' ? 'هذا الزبون غير موجود.' : 'هذا المورد غير موجود.',
      );
    }
    const code = type === 'customer' ? '1200' : '2100';
    const side = type === 'customer' ? 'debit' : 'credit';
    const [opening] = await tx.execute<{ net: string }>(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as net
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where a.code = ${code} and l.party_type = ${type} and l.party_id = ${partyId}
        and e.entry_date < ${range.from}`);
    const rows = await tx.execute<{
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
      where a.code = ${code} and l.party_type = ${type} and l.party_id = ${partyId}
        and e.entry_date >= ${range.from} and e.entry_date <= ${range.to}
      order by e.entry_date, e.year, e.seq, l.line_no`);
    const debitSigned = num(opening?.net);
    const openingMinor = side === 'debit' ? debitSigned : -debitSigned;
    const run = runStatement(
      openingMinor,
      rows.map((r) => ({
        date: r.date,
        sourceType: r.source_type,
        sourceId: r.source_id,
        number: r.number,
        memo: r.memo,
        debitMinor: num(r.debit),
        creditMinor: num(r.credit),
      })),
      side,
    );
    return {
      type,
      party: { id: party.id, name: party.name, phone: party.phone },
      from: range.from,
      to: range.to,
      openingMinor,
      lines: run.lines,
      totalDebitMinor: run.totalDebitMinor,
      totalCreditMinor: run.totalCreditMinor,
      closingMinor: run.closingMinor,
      baseCurrency: await baseCurrencyOf(tx),
    };
  });
}

// ─── Accounts a hand may post to ─────────────────────────────────────────────

/** Accounts tied to a sub-ledger or a stock/drawer count: only their own documents move them. */
const DOCUMENT_ONLY: Record<string, string> = {
  '1200': 'حساب الزبائن: استخدم سند قبض أو فاتورة آجل',
  '2100': 'حساب الموردين: استخدم فاتورة شراء أو سند دفع',
  '2300': 'حساب عربون الزبائن: له مستنداته',
  '1300': 'حساب المخزون: تعدّله حركات المخزون والجرد',
  '1310': 'حساب البضاعة في الطريق: يعدّله التحويل بين الفروع',
  '1160': 'حساب الشيكات: له إجراءاته',
};

interface AccountInfo {
  code: string;
  name: string;
  type: string;
  isGroup: boolean;
  parentCode: string | null;
}

/** An account of this store, or of the chart (made on first use by the posting). */
async function accountInfo(tx: Transaction, code: string): Promise<AccountInfo | null> {
  const [own] = await tx.execute<{
    code: string;
    name: string;
    type: string;
    is_group: boolean;
    parent_code: string | null;
  }>(
    sql`select code, name, type, is_group, parent_code from accounts where code = ${code} and archived_at is null`,
  );
  if (own)
    return {
      code: own.code,
      name: own.name,
      type: own.type,
      isGroup: own.is_group,
      parentCode: own.parent_code,
    };
  const [chart] = await tx.execute<{
    code: string;
    name: string;
    type: string;
    is_group: boolean;
    parent_code: string | null;
  }>(sql`select code, name, type, is_group, parent_code from account_chart() where code = ${code}`);
  return chart
    ? {
        code: chart.code,
        name: chart.name,
        type: chart.type,
        isGroup: chart.is_group,
        parentCode: chart.parent_code,
      }
    : null;
}

// ─── Expenses ────────────────────────────────────────────────────────────────

/** «EXP-2026-000001»: the series, the year and the next number of that year without gaps. */
async function nextNumber(tx: Transaction, tenantId: string, series: string, date: string): Promise<string> {
  const year = Number(date.slice(0, 4));
  const [row] = await tx
    .insert(documentSequences)
    .values({ tenantId, series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.tenantId, documentSequences.series, documentSequences.year],
      set: { lastNumber: sql`${documentSequences.lastNumber} + 1` },
    })
    .returning({ n: documentSequences.lastNumber });
  return `${series}-${year}-${String(row!.n).padStart(6, '0')}`;
}

type ExpenseDbRow = {
  id: string;
  number: string;
  business_date: string;
  branch_id: string;
  account_code: string;
  account_name: string | null;
  currency: CurrencyCode;
  amount_minor: string;
  base_amount_minor: string;
  rate: TradeRate | null;
  pay_from: ExpensePayFrom;
  note: string | null;
  entry_number: string | null;
  void_reason: string | null;
  voided: boolean;
};

const expenseSelect = sql`
  select x.id, x.number, x.business_date::text, x.branch_id, x.account_code, a.name as account_name, x.currency,
         x.amount_minor::text, x.base_amount_minor::text, x.rate, x.pay_from, x.note,
         e.number as entry_number, r.memo as void_reason, (r.id is not null) as voided
  from expenses x
  left join accounts a on a.tenant_id = x.tenant_id and a.code = x.account_code
  left join journal_entries e on e.tenant_id = x.tenant_id and e.source_type = 'expense' and e.source_id = x.id and e.kind = 'auto'
  left join journal_entries r on r.tenant_id = x.tenant_id and r.kind = 'reversal' and r.reverses_id = e.id`;

const toExpenseRow = (r: ExpenseDbRow): ExpenseRow => ({
  id: r.id,
  number: r.number,
  date: r.business_date,
  branchId: r.branch_id,
  accountCode: r.account_code,
  accountName: r.account_name ?? r.account_code,
  currency: r.currency,
  amountMinor: num(r.amount_minor),
  baseAmountMinor: num(r.base_amount_minor),
  rate: r.rate,
  payFrom: r.pay_from,
  note: r.note,
  entryNumber: r.entry_number,
  voided: r.voided,
  voidReason: r.voided ? r.void_reason : null,
});

async function readExpense(tx: Transaction, id: string): Promise<ExpenseRow | null> {
  const [row] = await tx.execute<ExpenseDbRow>(sql`${expenseSelect} where x.id = ${id}`);
  return row ? toExpenseRow(row) : null;
}

export async function createExpense(
  db: Database,
  auth: AccessClaims,
  input: ExpenseInput,
  meta: RequestMeta,
): Promise<ExpenseRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'expenses.manage', input.branchId);
    // Sent again with the same id (a lost answer): the expense that is already there answers.
    if (input.id) {
      const known = await readExpense(tx, input.id);
      if (known) return known;
    }
    const [branch] = await tx.execute<{ id: string }>(
      sql`select id from branches where id = ${input.branchId}`,
    );
    if (!branch) throw invalid({ branchId: 'الفرع غير موجود' });
    const account = await accountInfo(tx, input.accountCode);
    if (!account || account.type !== 'expense' || account.isGroup) {
      throw invalid({ accountCode: 'اختر حساب مصروف من الدليل' });
    }
    const base = await baseCurrencyOf(tx);
    let rate: TradeRate | null = null;
    if (input.currency !== base) {
      const [settings] = await tx.execute<{ enabled: string[] }>(
        sql`select enabled_currencies as enabled from tenant_settings`,
      );
      if (!settings?.enabled?.includes(input.currency))
        throw invalid({ currency: 'هذه العملة غير مفعّلة في المتجر' });
      rate = input.rate ?? (await latestRate(tx, input.currency, base));
      if (!rate) throw invalid({ rate: `لا سعر صرف بين ${input.currency} و${base}` });
    }
    const lines = expenseLines(input, base, rate);
    const baseAmount = lines[0]!.baseMinor;
    if (baseAmount <= 0) throw invalid({ amountMinor: 'المبلغ صغير جداً بالعملة الأساسية' });

    const id = input.id ?? newId();
    const number = await nextNumber(tx, auth.tenantId, 'EXP', input.date);
    await tx.insert(expenses).values({
      tenantId: auth.tenantId,
      id,
      number,
      branchId: input.branchId,
      businessDate: input.date,
      accountCode: input.accountCode,
      currency: input.currency,
      amountMinor: input.amountMinor,
      baseAmountMinor: baseAmount,
      rate,
      payFrom: input.payFrom,
      note: input.note ?? null,
      createdBy: auth.userId,
    });
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: input.branchId,
      date: input.date,
      sourceType: 'expense',
      sourceId: id,
      sourceNumber: number,
      memo: `مصروف ${number}: ${account.name}${input.note ? ` — ${input.note}` : ''}`,
      baseCurrency: base,
      lines: lines as DraftLine[],
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'expense.create',
        entity: 'expense',
        entityId: id,
        changes: { accountCode: [null, input.accountCode], amountMinor: [null, input.amountMinor] },
      },
      meta,
    );
    return (await readExpense(tx, id))!;
  });
}

export async function listExpenses(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof expenseListQuery>,
): Promise<ExpenseListResponse> {
  if (query.from && query.to) checkRange({ from: query.from, to: query.to });
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'expenses.manage', query.branchId);
    const where: SQL[] = [inList(sql`x.branch_id`, branches)];
    if (query.from) where.push(sql`x.business_date >= ${query.from}`);
    if (query.to) where.push(sql`x.business_date <= ${query.to}`);
    if (query.accountCode) where.push(sql`x.account_code = ${query.accountCode}`);
    const filter = sql.join(where, sql` and `);

    const cursor = decodeCursor(query.cursor);
    const page = cursor
      ? sql`${filter} and (x.business_date, x.number) < (${cursor.date}::date, ${cursor.number})`
      : filter;
    const rows = await tx.execute<ExpenseDbRow>(
      sql`${expenseSelect} where ${page} order by x.business_date desc, x.number desc limit ${query.limit + 1}`,
    );
    const items = rows.slice(0, query.limit).map(toExpenseRow);
    const last = items.at(-1);

    // The totals are of the whole filter, not of the page, and leave out the cancelled.
    const totals = await tx.execute<{
      account_code: string;
      account_name: string | null;
      total: string;
      n: string;
    }>(sql`
      select x.account_code, a.name as account_name, sum(x.base_amount_minor)::text as total, count(*)::text as n
      from expenses x
      left join accounts a on a.tenant_id = x.tenant_id and a.code = x.account_code
      left join journal_entries e on e.tenant_id = x.tenant_id and e.source_type = 'expense' and e.source_id = x.id and e.kind = 'auto'
      where ${filter} and not exists (
        select 1 from journal_entries r where r.tenant_id = x.tenant_id and r.kind = 'reversal' and r.reverses_id = e.id)
      group by x.account_code, a.name order by x.account_code`);
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.date, last.number) : null,
      totalMinor: totals.reduce((sum, t) => sum + num(t.total), 0),
      byAccount: totals.map((t) => ({
        accountCode: t.account_code,
        accountName: t.account_name ?? t.account_code,
        totalMinor: num(t.total),
        count: num(t.n),
      })),
      baseCurrency: await baseCurrencyOf(tx),
    };
  });
}

const encodeCursor = (date: string, number: string) => Buffer.from(`${date}|${number}`).toString('base64url');
function decodeCursor(cursor: string | undefined): { date: string; number: string } | null {
  if (!cursor) return null;
  const [date, number] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!date || !number || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw invalid({ cursor: 'مؤشر الصفحة غير صالح' });
  return { date, number };
}

// ─── Reversal ────────────────────────────────────────────────────────────────

/**
 * Posts the reversing entry of `entryId`: the same lines turned around, the original's date and
 * branch, the reason in its memo. One reversal per entry (the source is unique), and a reversal is
 * never reversed.
 */
async function reverseEntry(tx: Transaction, auth: AccessClaims, entryId: string, reason: string) {
  const [entry] = await tx.execute<{
    id: string;
    number: string;
    kind: string;
    source_type: string;
    entry_date: string;
    branch_id: string | null;
    base_currency: string;
  }>(
    sql`select id, number, kind, source_type, entry_date::text, branch_id, base_currency from journal_entries where id = ${entryId}`,
  );
  if (!entry) throw new AppError(404, 'not_found', 'هذا القيد غير موجود.');
  if (entry.kind === 'reversal') throw new AppError(409, 'conflict', 'القيد العكسي لا يُعكس مرة ثانية.');
  const [done] = await tx.execute<{ number: string }>(
    sql`select number from journal_entries where kind = 'reversal' and reverses_id = ${entryId}`,
  );
  if (done) throw new AppError(409, 'conflict', `هذا القيد معكوس أصلاً بالقيد ${done.number}.`);
  const lines = await tx.execute<{
    code: string;
    base: string;
    currency: string;
    amount: string;
    rate: TradeRate | null;
    shift_id: string | null;
    party_type: 'customer' | 'supplier' | 'user' | null;
    party_id: string | null;
    memo: string | null;
  }>(sql`
    select a.code, (l.debit_minor - l.credit_minor)::text as base, l.currency, l.amount_minor::text as amount,
           l.rate, l.shift_id, l.party_type, l.party_id, l.memo
    from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where l.entry_id = ${entryId} order by l.line_no`);
  const original: (LedgerLine & { shiftId: string | null; party: DraftLine['party'] })[] = lines.map((l) => ({
    account: { code: l.code },
    baseMinor: num(l.base),
    currency: l.currency,
    amountMinor: num(l.amount),
    rate: l.rate,
    memo: l.memo,
    shiftId: l.shift_id,
    party: l.party_type && l.party_id ? { type: l.party_type, id: l.party_id } : null,
  }));
  await postEntry(tx, {
    tenantId: auth.tenantId,
    branchId: entry.branch_id,
    date: entry.entry_date,
    sourceType: 'reversal',
    sourceId: entry.id,
    sourceNumber: entry.number,
    memo: `عكس القيد ${entry.number}: ${reason}`,
    baseCurrency: entry.base_currency,
    lines: reversalLines(original) as DraftLine[],
    kind: 'reversal',
    reversesId: entry.id,
    createdBy: auth.userId,
  });
  const [reversal] = await tx.execute<{ id: string; number: string; total: string }>(
    sql`select id, number, total_minor::text as total from journal_entries where kind = 'reversal' and reverses_id = ${entry.id}`,
  );
  return { entry, reversal: reversal! };
}

export async function voidExpense(
  db: Database,
  auth: AccessClaims,
  id: string,
  reason: string,
  meta: RequestMeta,
): Promise<ExpenseRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [expense] = await tx
      .select({ branchId: expenses.branchId })
      .from(expenses)
      .where(eq(expenses.id, id));
    if (!expense) throw new AppError(404, 'not_found', 'هذا المصروف غير موجود.');
    await requirePermission(tx, auth.userId, 'expenses.manage', expense.branchId);
    const [entry] = await tx.execute<{ id: string }>(
      sql`select id from journal_entries where source_type = 'expense' and source_id = ${id} and kind = 'auto'`,
    );
    if (!entry) throw new AppError(404, 'not_found', 'قيد هذا المصروف غير موجود.');
    await reverseEntry(tx, auth, entry.id, reason);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'expense.void',
        entity: 'expense',
        entityId: id,
        changes: { reason: [null, reason] },
      },
      meta,
    );
    return (await readExpense(tx, id))!;
  });
}

// ─── Manual entries ──────────────────────────────────────────────────────────

const toEntryRow = (r: {
  id: string;
  number: string;
  entry_date: string;
  kind: string;
  memo: string;
  total: string;
  reverses_id: string | null;
}): ManualEntryRow => ({
  id: r.id,
  number: r.number,
  date: r.entry_date,
  kind: r.kind === 'reversal' ? 'reversal' : 'manual',
  memo: r.memo,
  totalMinor: num(r.total),
  reversesId: r.reverses_id,
});

const entrySelect = sql`select id, number, entry_date::text, kind, memo, total_minor::text as total, reverses_id from journal_entries`;

export async function createManualEntry(
  db: Database,
  auth: AccessClaims,
  input: ManualEntryInput,
  meta: RequestMeta,
): Promise<ManualEntryRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'accounting.post', input.branchId);
    if (input.id) {
      const [known] = await tx.execute<Parameters<typeof toEntryRow>[0]>(
        sql`${entrySelect} where source_type = 'manual' and source_id = ${input.id} and kind = 'manual'`,
      );
      if (known) return toEntryRow(known);
    }
    const [branch] = await tx.execute<{ id: string }>(
      sql`select id from branches where id = ${input.branchId}`,
    );
    if (!branch) throw invalid({ branchId: 'الفرع غير موجود' });
    const base = await baseCurrencyOf(tx);

    // Each account must exist, must not be a group, and must be one a hand may move.
    for (const [i, line] of input.lines.entries()) {
      const account = await accountInfo(tx, line.accountCode);
      if (!account || (account.isGroup && account.code !== '1120')) {
        throw invalid({ [`lines.${i}.accountCode`]: 'اختر حساباً تفصيلياً من الدليل' });
      }
      const reason = DOCUMENT_ONLY[account.code];
      if (reason || account.parentCode === '1110') {
        throw invalid({
          [`lines.${i}.accountCode`]: reason ?? 'أدراج الورديات تعدّلها الورديات والمصاريف من الدرج فقط',
        });
      }
    }
    const rates = new Map<CurrencyCode, TradeRate | null>();
    for (const line of input.lines) {
      const currency = (line.currency ?? base) as CurrencyCode;
      if (currency !== base && !rates.has(currency))
        rates.set(currency, await latestRate(tx, currency, base));
    }
    const checked = manualEntryLines(input, base, (currency) => rates.get(currency) ?? null);
    if (!checked.ok) throw invalid({ [checked.field ?? 'lines']: checked.message });

    const id = input.id ?? newId();
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: input.branchId,
      date: input.date,
      sourceType: 'manual',
      sourceId: id,
      sourceNumber: null,
      memo: input.memo,
      baseCurrency: base,
      lines: checked.lines as DraftLine[],
      kind: 'manual',
      createdBy: auth.userId,
    });
    const [row] = await tx.execute<Parameters<typeof toEntryRow>[0]>(
      sql`${entrySelect} where source_type = 'manual' and source_id = ${id} and kind = 'manual'`,
    );
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'journal.manual',
        entity: 'journal_entry',
        entityId: row!.id,
        changes: { totalMinor: [null, checked.totalMinor] },
      },
      meta,
    );
    return toEntryRow(row!);
  });
}

/** Reverses a manual entry (an automatic one is corrected through its own document). */
export async function reverseManualEntry(
  db: Database,
  auth: AccessClaims,
  entryId: string,
  reason: string,
  meta: RequestMeta,
): Promise<ManualEntryRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [entry] = await tx.execute<{ kind: string; branch_id: string | null }>(
      sql`select kind, branch_id from journal_entries where id = ${entryId}`,
    );
    if (!entry) throw new AppError(404, 'not_found', 'هذا القيد غير موجود.');
    await requirePermission(tx, auth.userId, 'accounting.post', entry.branch_id ?? undefined);
    if (entry.kind !== 'manual') {
      throw new AppError(409, 'conflict', 'يُعكس هنا القيد اليدوي فقط؛ القيد الآلي يُصحَّح من مستنده.');
    }
    const { reversal } = await reverseEntry(tx, auth, entryId, reason);
    const [row] = await tx.execute<Parameters<typeof toEntryRow>[0]>(
      sql`${entrySelect} where id = ${reversal.id}`,
    );
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'journal.reverse',
        entity: 'journal_entry',
        entityId: entryId,
        changes: { reason: [null, reason] },
      },
      meta,
    );
    return toEntryRow(row!);
  });
}

// ─── Profit and loss ─────────────────────────────────────────────────────────

export async function profitLoss(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof profitLossQuery>,
): Promise<ProfitLoss> {
  checkRange(query);
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'accounting.view', query.branchId);
    const rows = await tx.execute<{ code: string; name: string; debit: string; credit: string }>(sql`
      select a.code, a.name, sum(l.debit_minor)::text as debit, sum(l.credit_minor)::text as credit
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where e.entry_date >= ${query.from} and e.entry_date <= ${query.to}
        and a.code ~ '^[456]' and ${inList(sql`e.branch_id`, branches)}
      group by a.code, a.name order by a.code`);
    return buildProfitLoss(
      rows.map((r) => ({ code: r.code, name: r.name, debitMinor: num(r.debit), creditMinor: num(r.credit) })),
      {
        from: query.from,
        to: query.to,
        branchId: query.branchId ?? null,
        baseCurrency: await baseCurrencyOf(tx),
      },
    );
  });
}
