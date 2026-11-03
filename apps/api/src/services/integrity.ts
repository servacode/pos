import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Transaction } from '@serva/db';

/**
 * «فحص السلامة» (task M0-5): canonical fingerprints of a store's books, and the first
 * reconciliations of the architecture review (question 8) between independent sources. Read only:
 * nothing here writes, posts or corrects. A problem is reported, never repaired silently.
 *
 * Fingerprints. Two databases that hold the same documents must hold the same books, whatever
 * order the documents arrived in, whatever ids or entry numbers the server gave them, and after a
 * backup and restore or an upgrade. So a fingerprint covers what the books say and nothing that
 * depends on arrival: an entry is known by its source document (type, id, kind), never by its id or
 * its number (2026-0000154 is the order of arrival); memos are wording and are left out. Entries
 * and their lines are sorted before hashing, in code-unit order, so row order never counts.
 *
 * Checks:
 *   entries_balanced   every entry: Σ debit = Σ credit = its total, two lines at least
 *   journal_numbering  each year's entry numbers run 1…n with no gap, but for the ranges a
 *                      restore skipped on purpose (counter_jumps, task M0-8)
 *   stock_movements    (reconciliation 2) every stock level = Σ of its movements
 *   drawer_ledger      (reconciliation 3) per shift and currency, the drawer's account moved by
 *                      what the documents say went in and out of it; and after the close, by the
 *                      counted amount less the expected one as the server works it out
 *   day_report_ledger  (reconciliation 4) per branch and day, the day report read from the
 *                      invoices equals the sale entries: net sales (4100−4200−4300), tax (22xx),
 *                      tips (2550), cash rounding (6400), and each payment method
 *                      (1110 drawers, 1140 card, 1150 wallet, 1130 transfer, 1200 credit)
 *
 * Every query names the store explicitly, so the result is the same under row-level security
 * (withTenant) and under the owner role that bypasses it (the command line tool).
 */

export const FINGERPRINT_VERSION = 'serva-books-v1';

export type IntegrityCheckName =
  'entries_balanced' | 'journal_numbering' | 'stock_movements' | 'drawer_ledger' | 'day_report_ledger';

export const INTEGRITY_CHECKS: readonly IntegrityCheckName[] = [
  'entries_balanced',
  'journal_numbering',
  'stock_movements',
  'drawer_ledger',
  'day_report_ledger',
];

export interface IntegrityCheck {
  name: IntegrityCheckName;
  ok: boolean;
  /** One line per problem, naming what disagrees and by how much; empty when ok */
  problems: string[];
}

export interface Fingerprint {
  /** sha256 hex of the canonical rows, prefixed with FINGERPRINT_VERSION */
  hash: string;
  /** How many rows went into it */
  rows: number;
}

export interface IntegrityReport {
  tenantId: string;
  ledger: Fingerprint;
  stock: Fingerprint;
  checks: IntegrityCheck[];
  ok: boolean;
}

/** Code-unit order: the same on every machine and locale, unlike localeCompare. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function fingerprintOf(rows: string[]): Fingerprint {
  const hash = createHash('sha256');
  hash.update(FINGERPRINT_VERSION);
  for (const row of [...rows].sort(byCodeUnit)) hash.update(`\n${row}`);
  return { hash: hash.digest('hex'), rows: rows.length };
}

/**
 * The journal: one canonical row per entry, its lines sorted inside it. A reversal points at the
 * entry it reverses by that entry's source, not by its id.
 */
export async function ledgerFingerprint(tx: Transaction, tenantId: string): Promise<Fingerprint> {
  const rows = await tx.execute<{ entry: string; lines: string[] }>(sql`
    select concat_ws('|', e.source_type, e.source_id, e.kind, e.entry_date, e.posting_date,
                     coalesce(e.branch_id::text, ''), e.base_currency, e.total_minor,
                     coalesce(r.source_type || ':' || r.source_id || ':' || r.kind, '')) as entry,
           array_agg(concat_ws('|', a.code, l.debit_minor, l.credit_minor, l.currency, l.amount_minor,
                               coalesce(l.rate::text, ''), coalesce(l.branch_id::text, ''),
                               coalesce(l.shift_id::text, ''), coalesce(l.party_type, ''),
                               coalesce(l.party_id::text, ''))) as lines
    from journal_entries e
    join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    left join journal_entries r on r.tenant_id = e.tenant_id and r.id = e.reverses_id
    where e.tenant_id = ${tenantId}
    group by e.tenant_id, e.id, r.tenant_id, r.id`);
  return fingerprintOf(rows.map((r) => [r.entry, ...[...r.lines].sort(byCodeUnit)].join('\n  ')));
}

/** Stock: every movement by its document and line, and every level. */
export async function stockFingerprint(tx: Transaction, tenantId: string): Promise<Fingerprint> {
  const rows = await tx.execute<{ row: string }>(sql`
    select concat_ws('|', 'move', m.branch_id, m.variant_id, m.kind, m.doc_id, m.line_no, m.qty,
                     m.business_date) as row
    from stock_movements m where m.tenant_id = ${tenantId}
    union all
    select concat_ws('|', 'level', s.branch_id, s.variant_id, s.qty, s.reserved_qty)
    from stock_levels s where s.tenant_id = ${tenantId}`);
  return fingerprintOf(rows.map((r) => r.row));
}

const check = (name: IntegrityCheckName, problems: string[]): IntegrityCheck => ({
  name,
  ok: problems.length === 0,
  problems,
});

async function entriesBalanced(tx: Transaction, tenantId: string): Promise<IntegrityCheck> {
  const rows = await tx.execute<{
    number: string;
    debit: string;
    credit: string;
    total: string;
    n: number;
  }>(sql`
    select e.number, coalesce(sum(l.debit_minor), 0)::text as debit,
           coalesce(sum(l.credit_minor), 0)::text as credit, e.total_minor::text as total,
           count(l.id)::int as n
    from journal_entries e
    left join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
    where e.tenant_id = ${tenantId}
    group by e.id, e.number, e.total_minor
    having coalesce(sum(l.debit_minor), 0) <> coalesce(sum(l.credit_minor), 0)
        or coalesce(sum(l.debit_minor), 0) <> e.total_minor or count(l.id) < 2
    order by e.number`);
  return check(
    'entries_balanced',
    rows.map(
      (r) => `القيد ${r.number}: مدين ${r.debit}، دائن ${r.credit}، الإجمالي ${r.total}، عدد الأسطر ${r.n}`,
    ),
  );
}

async function journalNumbering(tx: Transaction, tenantId: string): Promise<IntegrityCheck> {
  // Every number of each year from 1 to the last one is an entry or lies in a range a restore
  // skipped on purpose (counter_jumps, task M0-8), and never both. Any other gap is a lost entry.
  const rows = await tx.execute<{ year: number; problem: string; low: number; high: number }>(sql`
    with taken as (
      select year, seq as low, seq as high, 'entry' as what from journal_entries where tenant_id = ${tenantId}
      union all
      select year, from_number, to_number, 'jump' from counter_jumps
      where tenant_id = ${tenantId} and counter = 'journal'
    ),
    ordered as (
      select year, low, high,
             max(high) over (partition by year order by low, high
                             rows between unbounded preceding and 1 preceding) as previous
      from taken
    )
    select year, 'gap' as problem, coalesce(previous, 0) + 1 as low, low - 1 as high
    from ordered where low > coalesce(previous, 0) + 1
    union all
    select year, 'overlap', low, least(high, previous)
    from ordered where previous is not null and low <= previous
    order by 1, 3`);
  return check(
    'journal_numbering',
    rows.map((r) =>
      r.problem === 'gap'
        ? `سنة ${r.year}: لا قيد بالأرقام من ${r.low} إلى ${r.high}`
        : `سنة ${r.year}: الأرقام من ${r.low} إلى ${r.high} مستعملة مرتين (قيد وقفزة استعادة، أو قيدان)`,
    ),
  );
}

async function stockMovements(tx: Transaction, tenantId: string): Promise<IntegrityCheck> {
  const rows = await tx.execute<{ branch: string; variant: string; level: string; moved: string }>(sql`
    with moved as (
      select branch_id, variant_id, sum(qty) as qty from stock_movements
      where tenant_id = ${tenantId} group by branch_id, variant_id
    ),
    levels as (select branch_id, variant_id, qty from stock_levels where tenant_id = ${tenantId})
    select coalesce(l.branch_id, m.branch_id) as branch, coalesce(l.variant_id, m.variant_id) as variant,
           coalesce(l.qty, 0)::text as level, coalesce(m.qty, 0)::text as moved
    from levels l full join moved m on m.branch_id = l.branch_id and m.variant_id = l.variant_id
    where coalesce(l.qty, 0) <> coalesce(m.qty, 0)
    order by 1, 2`);
  return check(
    'stock_movements',
    rows.map((r) => `الفرع ${r.branch}، الصنف ${r.variant}: الرصيد ${r.level} ومجموع الحركات ${r.moved}`),
  );
}

async function drawerLedger(tx: Transaction, tenantId: string): Promise<IntegrityCheck> {
  // What went in and out of each drawer by the documents, and the close's counted amount less the
  // expected one; against the drawer accounts (children of 1110) by shift. The float itself is not
  // on the books (posting.ts), so it is part of the expected amount and not of the comparison.
  const rows = await tx.execute<{
    shift: string;
    number: string | null;
    currency: string;
    documents: string;
    ledger: string;
    close_documents: string | null;
    close_ledger: string;
  }>(sql`
    with flows as (
      select i.shift_id, p.currency, p.amount_minor as amount
      from invoice_payments p join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
      where p.tenant_id = ${tenantId} and p.method = 'cash' and i.shift_id is not null
      union all
      select i.shift_id, i.payload -> 'change' ->> 'currency', -(i.payload -> 'change' ->> 'amountMinor')::bigint
      from invoices i
      where i.tenant_id = ${tenantId} and i.shift_id is not null and jsonb_typeof(i.payload -> 'change') = 'object'
      union all
      select m.shift_id, m.currency, case when m.kind = 'pay_in' then m.amount_minor else -m.amount_minor end
      from cash_movements m where m.tenant_id = ${tenantId} and m.shift_id is not null
    ),
    docs as (select shift_id, currency, sum(amount) as amount from flows group by shift_id, currency),
    opening as (
      select s.id as shift_id, o ->> 'currency' as currency, (o ->> 'amountMinor')::bigint as amount
      from shifts s, jsonb_array_elements(case when jsonb_typeof(s.opening) = 'array' then s.opening else '[]'::jsonb end) o
      where s.tenant_id = ${tenantId}
      union all
      select s.id, c ->> 'currency', (c ->> 'openingMinor')::bigint
      from shifts s, jsonb_array_elements(case when jsonb_typeof(s.closing -> 'cash') = 'array'
                                               then s.closing -> 'cash' else '[]'::jsonb end) c
      where s.tenant_id = ${tenantId} and jsonb_typeof(s.opening) is distinct from 'array'
    ),
    counted as (
      select s.id as shift_id, c ->> 'currency' as currency, (c ->> 'countedMinor')::bigint as amount
      from shifts s, jsonb_array_elements(case when jsonb_typeof(s.closing -> 'cash') = 'array'
                                               then s.closing -> 'cash' else '[]'::jsonb end) c
      where s.tenant_id = ${tenantId} and s.close_doc_id is not null
    ),
    books as (
      select l.shift_id, l.currency,
             coalesce(sum(l.amount_minor) filter (where e.source_type <> 'shift_close'), 0) as flows,
             coalesce(sum(l.amount_minor) filter (where e.source_type = 'shift_close'), 0) as close
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${tenantId} and l.shift_id is not null and a.parent_code = '1110'
      group by l.shift_id, l.currency
    ),
    keys as (
      select shift_id, currency from docs union select shift_id, currency from books
      union select shift_id, currency from counted
    )
    select k.shift_id as shift, s.number, k.currency,
           coalesce(d.amount, 0)::text as documents, coalesce(b.flows, 0)::text as ledger,
           (c.amount - (coalesce(o.amount, 0) + coalesce(d.amount, 0)))::text as close_documents,
           coalesce(b.close, 0)::text as close_ledger
    from keys k
    left join docs d on d.shift_id = k.shift_id and d.currency = k.currency
    left join books b on b.shift_id = k.shift_id and b.currency = k.currency
    left join counted c on c.shift_id = k.shift_id and c.currency = k.currency
    left join (select shift_id, currency, sum(amount) as amount from opening group by 1, 2) o
      on o.shift_id = k.shift_id and o.currency = k.currency
    left join shifts s on s.tenant_id = ${tenantId} and s.id = k.shift_id
    order by k.shift_id, k.currency`);
  const problems: string[] = [];
  for (const r of rows) {
    const name = `الوردية ${r.number ?? r.shift} (${r.currency})`;
    if (r.documents !== r.ledger) {
      problems.push(`${name}: حركة الدرج حسب المستندات ${r.documents} وحسب الدفتر ${r.ledger}`);
    }
    if (r.close_documents !== null && r.close_documents !== r.close_ledger) {
      problems.push(
        `${name}: فرق الإغلاق حسب الخادم (المعدود ناقص المتوقع) ${r.close_documents} والمرحّل ${r.close_ledger}`,
      );
    }
  }
  return check('drawer_ledger', problems);
}

const MEASURES: Record<string, string> = {
  net: 'صافي المبيعات',
  tax: 'الضريبة',
  tips: 'الإكراميات',
  rounding: 'تقريب النقد',
  'pay:cash': 'النقد',
  'pay:card': 'البطاقة',
  'pay:wallet': 'المحفظة',
  'pay:transfer': 'التحويل',
  'pay:credit': 'الآجل',
};

async function dayReportLedger(tx: Transaction, tenantId: string): Promise<IntegrityCheck> {
  const rows = await tx.execute<{
    branch: string;
    day: string;
    measure: string;
    amount: string;
    side: string;
  }>(sql`
    select 'documents' as side, branch_id as branch, business_date::text as day, measure, sum(amount)::text as amount
    from (
      select branch_id, business_date, 'net' as measure, total_minor - tax_minor as amount
      from invoices where tenant_id = ${tenantId}
      union all select branch_id, business_date, 'tax', tax_minor from invoices where tenant_id = ${tenantId}
      union all select branch_id, business_date, 'tips', tip_minor from invoices where tenant_id = ${tenantId}
      union all select branch_id, business_date, 'rounding', rounding_base_minor
      from invoices where tenant_id = ${tenantId}
      union all select branch_id, business_date, 'pay:cash', -change_base_minor
      from invoices where tenant_id = ${tenantId}
      union all
      select i.branch_id, i.business_date, 'pay:' || p.method, p.base_amount_minor
      from invoice_payments p join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
      where p.tenant_id = ${tenantId}
    ) x group by branch_id, business_date, measure
    union all
    select 'ledger', e.branch_id, e.entry_date::text, m.measure,
           sum(case when m.credit_side then l.credit_minor - l.debit_minor
                    else l.debit_minor - l.credit_minor end)::text
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    cross join lateral (
      select case
        when a.code in ('4100', '4200', '4300') then 'net'
        when a.code in ('2200', '2210', '2220') then 'tax'
        when a.code = '2550' then 'tips'
        when a.code = '6400' then 'rounding'
        when a.parent_code = '1110' then 'pay:cash'
        when a.code = '1140' then 'pay:card'
        when a.code = '1150' then 'pay:wallet'
        when a.code = '1130' then 'pay:transfer'
        when a.code = '1200' then 'pay:credit'
        else 'other:' || a.code
      end as measure,
      a.code in ('4100', '4200', '4300', '2200', '2210', '2220', '2550', '6400') as credit_side
    ) m
    where l.tenant_id = ${tenantId} and e.source_type = 'sale'
    group by e.branch_id, e.entry_date, m.measure`);
  const sides = new Map<string, { documents: number; ledger: number }>();
  for (const r of rows) {
    const key = `${r.branch}|${r.day}|${r.measure}`;
    const entry = sides.get(key) ?? { documents: 0, ledger: 0 };
    entry[r.side === 'documents' ? 'documents' : 'ledger'] += Number(r.amount);
    sides.set(key, entry);
  }
  const problems: string[] = [];
  for (const [key, v] of [...sides.entries()].sort(([a], [b]) => byCodeUnit(a, b))) {
    if (v.documents === v.ledger) continue;
    const [branch, day, measure] = key.split('|') as [string, string, string];
    const label = MEASURES[measure] ?? `حساب غير متوقع ${measure.replace('other:', '')}`;
    problems.push(`الفرع ${branch}، يوم ${day}، ${label}: تقرير اليوم ${v.documents} والدفتر ${v.ledger}`);
  }
  return check('day_report_ledger', problems);
}

/** Every check and both fingerprints of one store. Read only. */
export async function checkIntegrity(tx: Transaction, tenantId: string): Promise<IntegrityReport> {
  const checks = [
    await entriesBalanced(tx, tenantId),
    await journalNumbering(tx, tenantId),
    await stockMovements(tx, tenantId),
    await drawerLedger(tx, tenantId),
    await dayReportLedger(tx, tenantId),
  ];
  return {
    tenantId,
    ledger: await ledgerFingerprint(tx, tenantId),
    stock: await stockFingerprint(tx, tenantId),
    checks,
    ok: checks.every((c) => c.ok),
  };
}
