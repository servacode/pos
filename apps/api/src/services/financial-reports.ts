import { sql, type SQL } from 'drizzle-orm';
import {
  ACCOUNT_LEDGER_LIMIT,
  ageDebt,
  CASH_FLOW_CATEGORIES,
  emptyAgeing,
  runStatement,
  type AccountLedger,
  type AccountType,
  type BalanceSheet,
  type BalanceSheetAccount,
  type BalanceSheetGroup,
  type BalanceSheetSection,
  type CashFlow,
  type CashFlowAccount,
  type CashFlowCategory,
  type Permission,
  type SupplierAgeingReport,
  type SupplierAgeingRow,
  type TaxReport,
  type TaxReportRow,
  type accountLedgerQuery,
  type balanceSheetQuery,
  type cashFlowQuery,
  type supplierAgeingQuery,
  type taxReportQuery,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { forbidden, inScope, permissionScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import { baseCurrencyOf, storeToday } from './contracts-common';

/**
 * The financial statements of packages/core › contracts/financial-reports.ts. Read-only: every
 * number comes from the journal (and, for the tax report, the invoice lines it is checked against),
 * in the store's base currency. Nothing here posts, changes an account or opens a period.
 */

const num = (value: unknown) => Number(value ?? 0);
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

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

// ─── Balance sheet ───────────────────────────────────────────────────────────

interface ChartNode {
  name: string;
  parent: string | null;
  type: AccountType;
}

/** One line of a snapshot: where it sits and what it holds on one day. */
interface SnapLine {
  section: 'assets' | 'liabilities' | 'equity';
  groupCode: string;
  groupName: string;
  accountCode: string;
  accountName: string;
  amountMinor: number;
}

/** The level-2 group an account sits under («11» الأصول المتداولة), found by the explicit parent field. */
function groupOf(chart: Map<string, ChartNode>, code: string): { code: string; name: string } {
  let current = code;
  for (let guard = 0; guard < 8; guard += 1) {
    const node = chart.get(current);
    if (!node) break;
    const parent = node.parent ? chart.get(node.parent) : undefined;
    // The group is the last node whose parent is a top-level class («1»)
    if (!parent || parent.parent === null) return { code: current, name: node.name };
    current = node.parent!;
  }
  return { code, name: chart.get(code)?.name ?? code };
}

const PROFIT_GROUP = { code: 'P', name: 'ربح الفترة غير المرحّل' };

/**
 * The books on one day: each balance-sheet account's balance, plus the profit made so far split
 * into the years before this one and this year (no closing entry carries it to 3200, so the sheet
 * shows it as its own lines rather than leaving equity short). A customer who paid more than he
 * owed (a credit balance on 1200) is shown under the liabilities, and a supplier who owes the
 * store (a debit balance on 2100) under the assets, as 10 › 1200 asks.
 */
async function snapshot(
  tx: Transaction,
  chart: Map<string, ChartNode>,
  day: string,
  yearStart: string,
  branches: string[] | null,
): Promise<SnapLine[]> {
  const rows = await tx.execute<{
    code: string;
    name: string;
    type: AccountType;
    net: string;
    net_year: string;
  }>(sql`
    select a.code, a.name, a.type,
           sum(l.debit_minor - l.credit_minor)::text as net,
           coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.posting_date >= ${yearStart}), 0)::text as net_year
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where e.posting_date <= ${day}::date and ${inList(sql`e.branch_id`, branches)}
    group by a.code, a.name, a.type
    order by a.code`);
  const parties = await tx.execute<{ code: string; owed: string }>(sql`
    select code, coalesce(sum(case when code = '1200' then -n else n end), 0)::text as owed
    from (
      select a.code, l.party_id, sum(l.debit_minor - l.credit_minor) as n
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where e.posting_date <= ${day}::date and ${inList(sql`e.branch_id`, branches)}
        and l.party_id is not null
        and ((a.code = '1200' and l.party_type = 'customer') or (a.code = '2100' and l.party_type = 'supplier'))
      group by a.code, l.party_id
    ) t
    where (code = '1200' and n < 0) or (code = '2100' and n > 0)
    group by code`);
  // Credit balances of customers (R1) and debit balances of suppliers (R2), as positive amounts
  const reclass = (code: string) => num(parties.find((p) => p.code === code)?.owed);
  const r1 = reclass('1200');
  const r2 = reclass('2100');

  const lines: SnapLine[] = [];
  let profitTotal = 0;
  let profitYear = 0;
  const push = (
    section: SnapLine['section'],
    code: string,
    name: string,
    accountCode: string,
    accountName: string,
    amountMinor: number,
  ) => lines.push({ section, groupCode: code, groupName: name, accountCode, accountName, amountMinor });
  for (const r of rows) {
    const net = num(r.net);
    if (r.type === 'revenue' || r.type === 'expense') {
      profitTotal -= net;
      profitYear -= num(r.net_year);
      continue;
    }
    const group = groupOf(chart, r.code);
    if (r.type === 'asset') {
      const adjusted = r.code === '1200' ? net + r1 : net;
      push('assets', group.code, group.name, r.code, r.name, adjusted);
    } else {
      const credit = -net;
      const adjusted = r.code === '2100' ? credit + r2 : credit;
      push(
        r.type === 'liability' ? 'liabilities' : 'equity',
        group.code,
        group.name,
        r.code,
        r.name,
        adjusted,
      );
    }
  }
  if (r1 !== 0) {
    const g = groupOf(chart, '2100');
    push('liabilities', g.code, g.name, '1200', 'أرصدة دائنة للزبائن (دفعوا أكثر من دينهم)', r1);
  }
  if (r2 !== 0) {
    const g = groupOf(chart, '1200');
    push('assets', g.code, g.name, '2100', 'أرصدة مدينة عند الموردين (دفعنا أكثر)', r2);
  }
  push(
    'equity',
    PROFIT_GROUP.code,
    PROFIT_GROUP.name,
    '',
    'أرباح السنوات السابقة غير المرحّلة',
    profitTotal - profitYear,
  );
  push('equity', PROFIT_GROUP.code, PROFIT_GROUP.name, '', 'ربح السنة الحالية حتى التاريخ', profitYear);
  return lines;
}

function sectionOf(
  current: SnapLine[],
  previous: SnapLine[] | null,
  section: SnapLine['section'],
): BalanceSheetSection {
  const key = (l: SnapLine) => `${l.groupCode}|${l.accountCode}|${l.accountName}`;
  const before = new Map((previous ?? []).filter((l) => l.section === section).map((l) => [key(l), l]));
  const merged = new Map<string, SnapLine & { previous: number | null }>();
  for (const l of current.filter((x) => x.section === section)) {
    merged.set(key(l), { ...l, previous: previous ? (before.get(key(l))?.amountMinor ?? 0) : null });
  }
  for (const [k, l] of before) {
    if (!merged.has(k)) merged.set(k, { ...l, amountMinor: 0, previous: l.amountMinor });
  }
  const groups = new Map<string, BalanceSheetGroup>();
  for (const l of merged.values()) {
    if (l.amountMinor === 0 && (l.previous ?? 0) === 0) continue;
    const g = groups.get(l.groupCode) ?? {
      code: l.groupCode,
      name: l.groupName,
      accounts: [],
      totalMinor: 0,
      previousTotalMinor: previous ? 0 : null,
    };
    const account: BalanceSheetAccount = {
      accountCode: l.accountCode,
      accountName: l.accountName,
      amountMinor: l.amountMinor,
      previousMinor: l.previous,
    };
    g.accounts.push(account);
    g.totalMinor += l.amountMinor;
    if (g.previousTotalMinor !== null) g.previousTotalMinor += l.previous ?? 0;
    groups.set(l.groupCode, g);
  }
  const list = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const g of list) g.accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return {
    groups: list,
    totalMinor: list.reduce((s, g) => s + g.totalMinor, 0),
    previousTotalMinor: previous ? list.reduce((s, g) => s + (g.previousTotalMinor ?? 0), 0) : null,
  };
}

async function chartOf(tx: Transaction): Promise<Map<string, ChartNode>> {
  const rows = await tx.execute<{
    code: string;
    name: string;
    parent_code: string | null;
    type: AccountType;
  }>(sql`select code, name, parent_code, type from accounts`);
  return new Map(rows.map((r) => [r.code, { name: r.name, parent: r.parent_code, type: r.type }]));
}

/** GET /v1/reports/balance-sheet: assets, liabilities and equity on a day, with an optional second day beside it. */
export async function balanceSheet(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof balanceSheetQuery>,
): Promise<BalanceSheet> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'accounting.view', query.branchId);
    const chart = await chartOf(tx);
    const yearStart = `${query.asOf.slice(0, 4)}-01-01`;
    const current = await snapshot(tx, chart, query.asOf, yearStart, branches);
    const previous = query.compareTo
      ? await snapshot(tx, chart, query.compareTo, `${query.compareTo.slice(0, 4)}-01-01`, branches)
      : null;
    const assets = sectionOf(current, previous, 'assets');
    const liabilities = sectionOf(current, previous, 'liabilities');
    const equity = sectionOf(current, previous, 'equity');
    const total = liabilities.totalMinor + equity.totalMinor;
    const previousTotal =
      previous && liabilities.previousTotalMinor !== null && equity.previousTotalMinor !== null
        ? liabilities.previousTotalMinor + equity.previousTotalMinor
        : null;
    return {
      asOf: query.asOf,
      compareTo: query.compareTo ?? null,
      branchId: query.branchId ?? null,
      baseCurrency: await baseCurrencyOf(tx, auth.tenantId),
      yearStart,
      assets,
      liabilities,
      equity,
      liabilitiesAndEquityMinor: total,
      previousLiabilitiesAndEquityMinor: previousTotal,
      differenceMinor: assets.totalMinor - total,
      balanced: assets.totalMinor === total,
    };
  });
}

// ─── Cash flow ───────────────────────────────────────────────────────────────

/** The accounts money sits in: drawers (and their currency sub-accounts), reps' cash, the safe, banks, wallets. */
const CASH_CODES = '^(1110|1115|1120|1130|1150)';

/** Where a cash movement came from: its document first, then what stands against the cash in the entry. */
function classifyCash(source: string, counters: readonly string[]): CashFlowCategory {
  switch (source) {
    case 'sale':
    case 'return':
    case 'gift_voucher':
      return 'sales';
    case 'receipt':
    case 'deposit':
      return 'customer_receipts';
    case 'purchase':
    case 'supplier_payment':
    case 'supplier_return':
      return 'supplier_payments';
    case 'expense':
      return 'expenses';
    default:
  }
  const has = (test: (code: string) => boolean) => counters.some(test);
  if (has((c) => c === '3100' || c === '3150' || c === '3160')) return 'owner';
  if (has((c) => c === '1200' || c === '1160' || c === '2300')) return 'customer_receipts';
  if (has((c) => c === '2100' || c === '2150' || c === '1460')) return 'supplier_payments';
  if (counters.length > 0 && counters.every((c) => c === '6200')) return 'other';
  if (has((c) => c.startsWith('6'))) return 'expenses';
  if (has((c) => c.startsWith('4'))) return 'sales';
  return 'other';
}

/** GET /v1/reports/cash-flow: the direct method, from the cash, bank and wallet accounts alone. */
export async function cashFlow(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof cashFlowQuery>,
): Promise<CashFlow> {
  checkRange(query);
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'accounting.view', query.branchId);
    const accountRows = await tx.execute<{
      code: string;
      name: string;
      opening: string;
      din: string;
      dout: string;
    }>(sql`
      select a.code, a.name,
             coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.posting_date < ${query.from}::date), 0)::text as opening,
             coalesce(sum(l.debit_minor) filter (where e.posting_date >= ${query.from}::date), 0)::text as din,
             coalesce(sum(l.credit_minor) filter (where e.posting_date >= ${query.from}::date), 0)::text as dout
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where a.code ~ ${CASH_CODES} and a.is_group = false
        and e.posting_date <= ${query.to}::date and ${inList(sql`e.branch_id`, branches)}
      group by a.code, a.name
      order by a.code`);
    const accounts: CashFlowAccount[] = accountRows
      .map((r) => {
        const openingMinor = num(r.opening);
        const inMinor = num(r.din);
        const outMinor = num(r.dout);
        return {
          accountCode: r.code,
          accountName: r.name,
          openingMinor,
          inMinor,
          outMinor,
          closingMinor: openingMinor + inMinor - outMinor,
        };
      })
      .filter((a) => a.openingMinor !== 0 || a.inMinor !== 0 || a.outMinor !== 0);

    const entries = await tx.execute<{
      source_type: string;
      d: string;
      c: string;
      n: string;
      counters: string[];
    }>(sql`
      select e.source_type, x.d::text as d, x.c::text as c, x.n::text as n,
             coalesce((
               select array_agg(distinct a2.code)
               from journal_lines l2
               join accounts a2 on a2.tenant_id = l2.tenant_id and a2.id = l2.account_id
               where l2.entry_id = x.entry_id and a2.code !~ ${CASH_CODES}
             ), '{}') as counters
      from (
        select l.entry_id, sum(l.debit_minor) as d, sum(l.credit_minor) as c, count(distinct l.account_id) as n
        from journal_lines l
        join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
        join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
        where a.code ~ ${CASH_CODES} and a.is_group = false
          and e.posting_date >= ${query.from}::date and e.posting_date <= ${query.to}::date
          and ${inList(sql`e.branch_id`, branches)}
        group by l.entry_id
      ) x
      join journal_entries e on e.id = x.entry_id`);
    const byCategory = new Map<CashFlowCategory, { inMinor: number; outMinor: number }>(
      CASH_FLOW_CATEGORIES.map((c) => [c, { inMinor: 0, outMinor: 0 }]),
    );
    for (const e of entries) {
      const debit = num(e.d);
      const credit = num(e.c);
      const bucket = byCategory.get(
        num(e.n) >= 2 && debit === credit ? 'transfer' : classifyCash(e.source_type, e.counters),
      )!;
      // One entry's receipts and payments are netted (a sale's change is not a payment); a move between the store's own cash accounts is shown whole
      if (num(e.n) >= 2 && debit === credit) {
        bucket.inMinor += debit;
        bucket.outMinor += credit;
      } else if (debit >= credit) bucket.inMinor += debit - credit;
      else bucket.outMinor += credit - debit;
    }
    const categories = CASH_FLOW_CATEGORIES.map((category) => {
      const b = byCategory.get(category)!;
      return { category, inMinor: b.inMinor, outMinor: b.outMinor, netMinor: b.inMinor - b.outMinor };
    }).filter((c) => c.inMinor !== 0 || c.outMinor !== 0);
    const openingMinor = accounts.reduce((s, a) => s + a.openingMinor, 0);
    const closingMinor = accounts.reduce((s, a) => s + a.closingMinor, 0);
    const inMinor = categories.reduce((s, c) => s + c.inMinor, 0);
    const outMinor = categories.reduce((s, c) => s + c.outMinor, 0);
    return {
      from: query.from,
      to: query.to,
      branchId: query.branchId ?? null,
      baseCurrency: await baseCurrencyOf(tx, auth.tenantId),
      accounts,
      categories,
      totals: { openingMinor, inMinor, outMinor, closingMinor },
      balanced: closingMinor === openingMinor + inMinor - outMinor,
    };
  });
}

// ─── Account ledger ──────────────────────────────────────────────────────────

/** GET /v1/reports/account-ledger: every movement on one account (and the accounts under it) with a running balance. */
export async function accountLedger(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof accountLedgerQuery>,
): Promise<AccountLedger> {
  checkRange(query);
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'accounting.view', query.branchId);
    const [account] = await tx.execute<{
      code: string;
      name: string;
      type: AccountType;
      normal_side: 'debit' | 'credit';
      is_group: boolean;
    }>(sql`select code, name, type, normal_side, is_group from accounts where code = ${query.code}`);
    if (!account) throw new AppError(404, 'not_found', 'هذا الحساب غير موجود.');
    // The account and every account under it by the explicit parent field
    const family = sql`(
      with recursive tree(code) as (
        select ${query.code}::text
        union all
        select c.code from accounts c join tree t on c.parent_code = t.code
      ) select code from tree)`;
    const base = sql`
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where a.code in ${family} and ${inList(sql`e.branch_id`, branches)}`;
    const [opening] = await tx.execute<{ net: string }>(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as net ${base}
        and e.posting_date < ${query.from}::date`);
    const [totals] = await tx.execute<{ debit: string; credit: string }>(sql`
      select coalesce(sum(l.debit_minor), 0)::text as debit, coalesce(sum(l.credit_minor), 0)::text as credit ${base}
        and e.posting_date >= ${query.from}::date and e.posting_date <= ${query.to}::date`);
    const rows = await tx.execute<{
      date: string;
      entry_id: string;
      entry_number: string;
      code: string;
      name: string;
      source_type: string;
      source_id: string;
      source_number: string | null;
      memo: string;
      debit: string;
      credit: string;
    }>(sql`
      select e.entry_date::text as date, e.id as entry_id, e.number as entry_number, a.code, a.name,
             e.source_type, e.source_id, e.source_number, e.memo,
             l.debit_minor::text as debit, l.credit_minor::text as credit ${base}
        and e.posting_date >= ${query.from}::date and e.posting_date <= ${query.to}::date
      order by e.posting_date, e.entry_date, e.year, e.seq, l.line_no
      limit ${ACCOUNT_LEDGER_LIMIT + 1}`);
    const truncated = rows.length > ACCOUNT_LEDGER_LIMIT;
    const side = account.normal_side;
    const sign = side === 'debit' ? 1 : -1;
    const openingMinor = sign * num(opening?.net);
    const run = runStatement(
      openingMinor,
      rows.slice(0, ACCOUNT_LEDGER_LIMIT).map((r) => ({
        date: r.date,
        entryId: r.entry_id,
        entryNumber: r.entry_number,
        accountCode: r.code,
        accountName: r.name,
        sourceType: r.source_type,
        sourceId: r.source_id,
        sourceNumber: r.source_number,
        memo: r.memo,
        debitMinor: num(r.debit),
        creditMinor: num(r.credit),
      })),
      side,
    );
    const totalDebitMinor = num(totals?.debit);
    const totalCreditMinor = num(totals?.credit);
    return {
      account: { code: account.code, name: account.name, type: account.type, isGroup: account.is_group },
      from: query.from,
      to: query.to,
      branchId: query.branchId ?? null,
      baseCurrency: await baseCurrencyOf(tx, auth.tenantId),
      openingMinor,
      lines: run.lines,
      totalDebitMinor,
      totalCreditMinor,
      closingMinor: openingMinor + sign * (totalDebitMinor - totalCreditMinor),
      truncated,
    };
  });
}

// ─── Tax report ──────────────────────────────────────────────────────────────

/** GET /v1/reports/tax: output tax by rate from the invoice and return lines, checked against the tax accounts. */
export async function taxReport(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof taxReportQuery>,
): Promise<TaxReport> {
  checkRange(query);
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await readBranches(tx, auth, 'accounting.view', query.branchId);
    const sales = await tx.execute<{
      rate_id: string | null;
      bp: number;
      taxable: string;
      tax: string;
    }>(sql`
      select il.tax_rate_id as rate_id, il.tax_rate_bp as bp,
             sum(il.total_minor - il.tax_minor)::text as taxable, sum(il.tax_minor)::text as tax
      from invoice_lines il
      join invoices i on i.tenant_id = il.tenant_id and i.id = il.invoice_id
      where i.business_date >= ${query.from}::date and i.business_date <= ${query.to}::date
        and ${inList(sql`i.branch_id`, branches)}
      group by il.tax_rate_id, il.tax_rate_bp`);
    const returns = await tx.execute<{
      rate_id: string | null;
      bp: number | null;
      taxable: string;
      tax: string;
    }>(sql`
      select rl.tax_rate_id as rate_id, il.tax_rate_bp as bp,
             sum(rl.total_minor - rl.tax_minor)::text as taxable, sum(rl.tax_minor)::text as tax
      from sale_return_lines rl
      join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
      left join invoice_lines il on il.tenant_id = r.tenant_id and il.invoice_id = r.sale_id and il.line_no = rl.sale_line_no
      where r.business_date >= ${query.from}::date and r.business_date <= ${query.to}::date
        and ${inList(sql`r.branch_id`, branches)}
      group by rl.tax_rate_id, il.tax_rate_bp`);
    const rates = await tx.execute<{ id: string; name: string; kind: string }>(
      sql`select id, name, kind from tax_rates`,
    );
    const rateInfo = new Map(rates.map((r) => [r.id, r]));
    const table = new Map<string, TaxReportRow>();
    const rowFor = (rateId: string | null, bp: number): TaxReportRow => {
      const key = `${rateId ?? ''}|${bp}`;
      let row = table.get(key);
      if (!row) {
        const info = rateId ? rateInfo.get(rateId) : undefined;
        row = {
          rateId,
          name: info?.name ?? (bp === 0 ? 'بدون ضريبة' : `ضريبة ${bp / 100}%`),
          kind: (info?.kind as TaxReportRow['kind']) ?? null,
          rateBp: bp,
          salesTaxableMinor: 0,
          salesTaxMinor: 0,
          returnsTaxableMinor: 0,
          returnsTaxMinor: 0,
          netTaxableMinor: 0,
          netTaxMinor: 0,
        };
        table.set(key, row);
      }
      return row;
    };
    for (const s of sales) {
      const row = rowFor(s.rate_id, s.bp);
      row.salesTaxableMinor += num(s.taxable);
      row.salesTaxMinor += num(s.tax);
    }
    for (const r of returns) {
      const row = rowFor(r.rate_id, r.bp ?? 0);
      row.returnsTaxableMinor += num(r.taxable);
      row.returnsTaxMinor += num(r.tax);
    }
    const rows = [...table.values()]
      .map((r) => ({
        ...r,
        netTaxableMinor: r.salesTaxableMinor - r.returnsTaxableMinor,
        netTaxMinor: r.salesTaxMinor - r.returnsTaxMinor,
      }))
      .sort((a, b) => b.rateBp - a.rateBp || a.name.localeCompare(b.name, 'ar'));
    const totals = rows.reduce(
      (t, r) => ({
        salesTaxableMinor: t.salesTaxableMinor + r.salesTaxableMinor,
        salesTaxMinor: t.salesTaxMinor + r.salesTaxMinor,
        returnsTaxableMinor: t.returnsTaxableMinor + r.returnsTaxableMinor,
        returnsTaxMinor: t.returnsTaxMinor + r.returnsTaxMinor,
        netTaxableMinor: t.netTaxableMinor + r.netTaxableMinor,
        netTaxMinor: t.netTaxMinor + r.netTaxMinor,
      }),
      {
        salesTaxableMinor: 0,
        salesTaxMinor: 0,
        returnsTaxableMinor: 0,
        returnsTaxMinor: 0,
        netTaxableMinor: 0,
        netTaxMinor: 0,
      },
    );
    const [ledger] = await tx.execute<{ output: string; input: string }>(sql`
      select coalesce(sum(l.credit_minor - l.debit_minor) filter (
               where a.code in ('2200', '2210', '2220') and e.source_type in ('sale', 'return')), 0)::text as output,
             coalesce(sum(l.debit_minor - l.credit_minor) filter (where a.code = '1400'), 0)::text as input
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where a.code in ('2200', '2210', '2220', '1400')
        and e.entry_date >= ${query.from}::date and e.entry_date <= ${query.to}::date
        and ${inList(sql`e.branch_id`, branches)}`);
    const ledgerOutputTaxMinor = num(ledger?.output);
    const inputTaxMinor = num(ledger?.input);
    return {
      from: query.from,
      to: query.to,
      branchId: query.branchId ?? null,
      baseCurrency: await baseCurrencyOf(tx, auth.tenantId),
      rows,
      totals,
      inputTaxMinor,
      netPayableMinor: totals.netTaxMinor - inputTaxMinor,
      ledgerOutputTaxMinor,
      reconciled: ledgerOutputTaxMinor === totals.netTaxMinor,
    };
  });
}

// ─── Supplier ageing ─────────────────────────────────────────────────────────

/**
 * GET /v1/reports/supplier-ageing: what the store owes each supplier, by the age of the debt, from
 * the lines of 2100 that name him. A payment settles the oldest debt first (as the customers' ageing does).
 */
export function supplierAgeing(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof supplierAgeingQuery>,
): Promise<SupplierAgeingReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const day = query.asOf ?? (await storeToday(tx, auth.tenantId));
    const lines = await tx.execute<{
      supplier_id: string;
      name: string;
      phone: string | null;
      date: string;
      debit: string;
      credit: string;
    }>(sql`
      select l.party_id as supplier_id, s.name, s.phone, e.entry_date::text as date,
             l.debit_minor::text as debit, l.credit_minor::text as credit
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      join suppliers s on s.tenant_id = l.tenant_id and s.id = l.party_id
      where a.code = '2100' and l.party_type = 'supplier' and e.entry_date <= ${day}::date
      order by l.party_id, e.entry_date`);
    const bySupplier = new Map<
      string,
      {
        name: string;
        phone: string | null;
        lines: { date: string; debitMinor: number; creditMinor: number }[];
      }
    >();
    for (const l of lines) {
      const entry = bySupplier.get(l.supplier_id) ?? { name: l.name, phone: l.phone, lines: [] };
      // What the store owes grows on the credit side: the ageing is of the credits, paid off by the debits
      entry.lines.push({ date: l.date, debitMinor: num(l.credit), creditMinor: num(l.debit) });
      bySupplier.set(l.supplier_id, entry);
    }
    const totals = { ...emptyAgeing(), balanceMinor: 0 };
    const items: SupplierAgeingRow[] = [];
    for (const [supplierId, s] of bySupplier) {
      const buckets = ageDebt(s.lines, day);
      const balanceMinor = buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus;
      if (balanceMinor <= 0) continue;
      items.push({ supplierId, name: s.name, phone: s.phone, balanceMinor, buckets });
      totals.d0_30 += buckets.d0_30;
      totals.d31_60 += buckets.d31_60;
      totals.d61_90 += buckets.d61_90;
      totals.d90_plus += buckets.d90_plus;
      totals.balanceMinor += balanceMinor;
    }
    items.sort((a, b) => b.balanceMinor - a.balanceMinor || a.name.localeCompare(b.name, 'ar'));
    return { asOf: day, baseCurrency: await baseCurrencyOf(tx, auth.tenantId), items, totals };
  });
}
