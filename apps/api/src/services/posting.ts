import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  CashMovementPayload,
  JournalSourceType,
  SalePayload,
  ShiftClosePayload,
  TradeRate,
} from '@serva/core';
import {
  accounts,
  journalEntries,
  journalLines,
  journalSequences,
  taxRates,
  type Transaction,
} from '@serva/db';

/**
 * The automatic entries of tab 10 (› القيود التلقائية) for the phase-1 documents, posted inside
 * the document's own savepoint, once (the inbox answers replays, and an entry is unique by its
 * source). Each entry is a function of its own document only: it never reads another document,
 * the current rate or a balance, so the ledger is the same whatever order the documents arrive in
 * (a sale before its shift, a close before its sales).
 *
 * - sale: one entry per invoice.
 *     Dr 1110 drawer of each cash currency (tendered − change in it, at the payment's rate),
 *        1140 card, 1150 wallet, 1130 transfer, 1200 credit (the customer), 4200 discounts ex tax
 *     Cr 4100 sales ex tax before discount, the tax account of each rate (2200/2210/2220),
 *        2550 tips; ± 6400 cash rounding (a gain is a credit)
 *   Cost of sales is not posted per sale: 10 › الكلفة والربح makes it one daily entry per branch
 *   (5100/1300) from the daily weighted average, which needs purchase costs (phase 2). With no
 *   cost known, nothing is invented here.
 * - cash_movement: pay_in 1110 ← 1120; pay_out and safe_drop 1120 ← 1110; expense 61xx ← 1110.
 * - shift_close: per drawer currency, the counted difference: a shortage Dr 6200 (or 1250 when the
 *   owner charges it to the cashier) Cr 1110; a surplus Dr 1110 Cr 6200.
 *
 * Every line's debit and credit are in the base currency; a dollar line also keeps its dollars and
 * the rate used, so the dollar drawer's dollars can be counted from the ledger.
 */

type Side = 'debit' | 'credit';

/** An account of the chart by its number, or a drawer/safe sub-account for one currency. */
export type AccountRef = { code: string } | { cash: '1110' | '1120'; currency: string };

export interface DraftLine {
  account: AccountRef;
  /** Signed in the base currency: positive is a debit, negative a credit */
  baseMinor: number;
  currency: string;
  /** Signed like baseMinor, in `currency` */
  amountMinor: number;
  rate: TradeRate | null;
  shiftId?: string | null;
  party?: { type: 'customer' | 'user'; id: string } | null;
  memo?: string | null;
}

export interface DraftEntry {
  tenantId: string;
  branchId: string | null;
  date: string;
  sourceType: JournalSourceType;
  sourceId: string;
  sourceNumber: string | null;
  memo: string;
  baseCurrency: string;
  lines: DraftLine[];
}

const refKey = (ref: AccountRef) => ('code' in ref ? ref.code : `${ref.cash}:${ref.currency}`);

/** The account ids of these references, making optional accounts and currency drawers on demand. */
async function resolveAccounts(
  tx: Transaction,
  tenantId: string,
  refs: AccountRef[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const codes = [...new Set(refs.flatMap((r) => ('code' in r ? [r.code] : [])))];
  if (codes.length > 0) {
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.code, codes)));
    for (const row of rows) ids.set(row.code, row.id);
  }
  for (const ref of refs) {
    const key = refKey(ref);
    if (ids.has(key)) continue;
    const [row] =
      'code' in ref
        ? await tx.execute<{ id: string }>(sql`select account_ensure(${tenantId}, ${ref.code}) as id`)
        : await tx.execute<{ id: string }>(
            sql`select account_ensure_currency(${tenantId}, ${ref.cash}, ${ref.currency}) as id`,
          );
    ids.set(key, row!.id);
  }
  return ids;
}

/** «2026-0000154»: the year, and the next number of that year with no gaps. */
async function nextNumber(tx: Transaction, tenantId: string, year: number) {
  const [row] = await tx
    .insert(journalSequences)
    .values({ tenantId, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [journalSequences.tenantId, journalSequences.year],
      set: { lastNumber: sql`${journalSequences.lastNumber} + 1` },
    })
    .returning({ seq: journalSequences.lastNumber });
  const seq = row!.seq;
  return { seq, number: `${year}-${String(seq).padStart(7, '0')}` };
}

/**
 * Posts one entry: lines with nothing in them are left out, the rest must balance (the database
 * checks it again). Returns null when the document already has its entry, or nothing to post.
 */
export async function postEntry(tx: Transaction, draft: DraftEntry): Promise<string | null> {
  // Debits first, then credits, each in the order the document gave them.
  const isDebit = (l: DraftLine) => l.baseMinor > 0 || (l.baseMinor === 0 && l.amountMinor > 0);
  const kept = draft.lines.filter((l) => l.baseMinor !== 0 || l.amountMinor !== 0);
  const lines = [...kept.filter(isDebit), ...kept.filter((l) => !isDebit(l))];
  if (lines.length === 0) return null;
  const debit = lines.reduce((acc, l) => acc + Math.max(l.baseMinor, 0), 0);
  const credit = lines.reduce((acc, l) => acc + Math.max(-l.baseMinor, 0), 0);
  if (debit !== credit) {
    throw new Error(`entry for ${draft.sourceType} ${draft.sourceId} does not balance: ${debit} ≠ ${credit}`);
  }

  const [existing] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, draft.tenantId),
        eq(journalEntries.sourceType, draft.sourceType),
        eq(journalEntries.sourceId, draft.sourceId),
        eq(journalEntries.kind, 'auto'),
      ),
    );
  if (existing) return null;

  const ids = await resolveAccounts(
    tx,
    draft.tenantId,
    lines.map((l) => l.account),
  );
  const year = Number(draft.date.slice(0, 4));
  const { seq, number } = await nextNumber(tx, draft.tenantId, year);
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      tenantId: draft.tenantId,
      branchId: draft.branchId,
      year,
      seq,
      number,
      entryDate: draft.date,
      postingDate: draft.date,
      kind: 'auto',
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      sourceNumber: draft.sourceNumber,
      memo: draft.memo,
      baseCurrency: draft.baseCurrency,
      totalMinor: debit,
    })
    .returning({ id: journalEntries.id });
  await tx.insert(journalLines).values(
    lines.map((l, i) => {
      // A line whose base is zero keeps its side from its own amount (a few cents of a currency).
      const side: Side = isDebit(l) ? 'debit' : 'credit';
      const sign = side === 'debit' ? 1 : -1;
      return {
        tenantId: draft.tenantId,
        entryId: entry!.id,
        lineNo: i + 1,
        accountId: ids.get(refKey(l.account))!,
        debitMinor: side === 'debit' ? Math.abs(l.baseMinor) : 0,
        creditMinor: side === 'credit' ? Math.abs(l.baseMinor) : 0,
        currency: l.currency,
        amountMinor: sign * Math.abs(l.amountMinor),
        rate: l.rate,
        branchId: draft.branchId,
        shiftId: l.shiftId ?? null,
        partyType: l.party?.type ?? null,
        partyId: l.party?.id ?? null,
        memo: l.memo ?? null,
      };
    }),
  );
  return entry!.id;
}

/** A line in the base currency. */
const baseLine = (account: AccountRef, baseMinor: number, currency: string, memo?: string): DraftLine => ({
  account,
  baseMinor,
  currency,
  amountMinor: baseMinor,
  rate: null,
  memo: memo ?? null,
});

// ─── Sale ────────────────────────────────────────────────────────────────────

/** The liability account of a tax rate's kind (10 › نموذج الضرائب السوري). */
const TAX_ACCOUNTS: Record<string, string> = { sales: '2200', consumption: '2210', stamp: '2220' };
/** Non-cash methods and where they wait (10 › القيود التلقائية; contract Q6: no provider sub-accounts yet). */
const METHOD_ACCOUNTS = { card: '1140', wallet: '1150', transfer: '1130', credit: '1200' } as const;

const methodMemo: Record<string, string> = {
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  transfer: 'تحويل',
  credit: 'آجل',
};

export interface SaleSource {
  tenantId: string;
  branchId: string;
  docId: string;
  number: string;
  businessDate: string;
}

/** The lines of a sale's entry (exported for the property tests). */
export function saleLines(sale: SalePayload, taxAccountOf: (taxRateId: string) => string): DraftLine[] {
  const base = sale.currency;
  const lines: DraftLine[] = [];

  // Payments in the order taken; cash is one line per currency, at the place of its first
  // payment: what was handed over, less the change given back in that currency.
  const cash = new Map<string, DraftLine>();
  const addCash = (currency: string, amount: number, baseAmount: number, rate: TradeRate | null) => {
    const line = cash.get(currency);
    if (line) {
      line.amountMinor += amount;
      line.baseMinor += baseAmount;
      line.rate ??= currency === base ? null : rate;
      return;
    }
    const created: DraftLine = {
      account: { cash: '1110', currency },
      baseMinor: baseAmount,
      currency,
      amountMinor: amount,
      rate: currency === base ? null : rate,
      shiftId: sale.shiftId,
    };
    cash.set(currency, created);
    lines.push(created);
  };
  for (const p of sale.payments) {
    if (p.method === 'cash') {
      addCash(p.currency, p.amountMinor, p.baseAmountMinor, p.rate);
    } else {
      lines.push({
        account: { code: METHOD_ACCOUNTS[p.method] },
        baseMinor: p.baseAmountMinor,
        currency: p.currency,
        amountMinor: p.amountMinor,
        rate: p.rate,
        party: p.method === 'credit' && sale.customerId ? { type: 'customer', id: sale.customerId } : null,
        memo: [methodMemo[p.method], p.reference, p.cardLast4 ? `****${p.cardLast4}` : null]
          .filter(Boolean)
          .join(' '),
      });
    }
  }
  if (sale.change) {
    addCash(sale.change.currency, -sale.change.amountMinor, -sale.change.baseAmountMinor, sale.change.rate);
  }

  // Sales before discount and tax, the discount ex tax, the tax per account.
  let gross = 0;
  let discount = 0;
  const tax = new Map<string, number>();
  for (const line of sale.lines) {
    gross += line.priced.grossExTaxMinor;
    discount += line.priced.discountExTaxMinor;
    if (line.priced.taxMinor !== 0) {
      const code = line.taxRateId ? taxAccountOf(line.taxRateId) : '2200';
      tax.set(code, (tax.get(code) ?? 0) + line.priced.taxMinor);
    }
  }
  lines.push(baseLine({ code: '4200' }, discount, base));
  lines.push(baseLine({ code: '4100' }, -gross, base));
  for (const [code, amount] of [...tax.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(baseLine({ code }, -amount, base));
  }
  lines.push(baseLine({ code: '2550' }, -sale.tipMinor, base));
  // Rounding: roundingBaseMinor > 0 is what the customer paid above the exact amount, a gain.
  lines.push(baseLine({ code: '6400' }, -(sale.cashRounding?.roundingBaseMinor ?? 0), base));

  // A device whose totals disagree with its own lines (flagged totals_mismatch) cannot unbalance
  // the entry: what was received is the sale, and the gap shows on its own line of 4100.
  const gap = lines.reduce((acc, l) => acc + l.baseMinor, 0);
  if (gap !== 0) lines.push(baseLine({ code: '4100' }, -gap, base, 'فرق مجاميع الجهاز'));
  return lines;
}

export async function postSale(tx: Transaction, source: SaleSource, sale: SalePayload): Promise<void> {
  const rateIds = [
    ...new Set(sale.lines.flatMap((l) => (l.taxRateId && l.priced.taxMinor ? [l.taxRateId] : []))),
  ];
  const kinds = new Map<string, string>();
  if (rateIds.length > 0) {
    const rows = await tx
      .select({ id: taxRates.id, kind: taxRates.kind })
      .from(taxRates)
      .where(inArray(taxRates.id, rateIds));
    for (const row of rows) kinds.set(row.id, row.kind);
  }
  // A rate the server does not know (deleted, another store's) still owes tax: the general account.
  const taxAccountOf = (id: string) => TAX_ACCOUNTS[kinds.get(id) ?? 'sales'] ?? '2200';
  await postEntry(tx, {
    tenantId: source.tenantId,
    branchId: source.branchId,
    date: source.businessDate,
    sourceType: 'sale',
    sourceId: source.docId,
    sourceNumber: source.number,
    memo: `فاتورة مبيعات ${source.number}`,
    baseCurrency: sale.currency,
    lines: saleLines(sale, taxAccountOf),
  });
}

// ─── Cash movement ───────────────────────────────────────────────────────────

const MOVEMENT_MEMO: Record<CashMovementPayload['kind'], string> = {
  pay_in: 'إيداع في الدرج',
  pay_out: 'سحب من الدرج',
  expense: 'مصروف من الدرج',
  safe_drop: 'تحويل من الدرج إلى الخزنة',
};

/** The lines of a drawer movement (exported for the property tests). */
export function cashMovementLines(m: CashMovementPayload, expenseCode: string): DraftLine[] {
  const drawer: DraftLine = {
    account: { cash: '1110', currency: m.currency },
    baseMinor: m.baseAmountMinor,
    currency: m.currency,
    amountMinor: m.amountMinor,
    rate: m.rate,
    shiftId: m.shiftId,
  };
  const out = (line: DraftLine): DraftLine => ({
    ...line,
    baseMinor: -line.baseMinor,
    amountMinor: -line.amountMinor,
  });
  const safe: DraftLine = { ...drawer, account: { cash: '1120', currency: m.currency }, shiftId: null };
  switch (m.kind) {
    case 'pay_in':
      return [drawer, out(safe)];
    case 'pay_out':
    case 'safe_drop':
      return [safe, out(drawer)];
    case 'expense':
      return [baseLine({ code: expenseCode }, m.baseAmountMinor, m.baseCurrency, m.reason), out(drawer)];
  }
}

export async function postCashMovement(
  tx: Transaction,
  source: { tenantId: string; branchId: string; docId: string; number: string | null; businessDate: string },
  m: CashMovementPayload,
): Promise<void> {
  // The device's list of 61xx may hold a number this chart lacks: it goes to 6190 «مصاريف متنوعة».
  let expenseCode = '6190';
  if (m.expenseAccountCode) {
    const [known] = await tx.execute<{ ok: boolean }>(
      sql`select exists (select 1 from account_chart() c where c.code = ${m.expenseAccountCode} and not c.is_group) as ok`,
    );
    if (known?.ok) expenseCode = m.expenseAccountCode;
  }
  await postEntry(tx, {
    tenantId: source.tenantId,
    branchId: source.branchId,
    date: source.businessDate,
    sourceType: 'cash_movement',
    sourceId: source.docId,
    sourceNumber: source.number,
    memo: `${MOVEMENT_MEMO[m.kind]}: ${m.reason}`,
    baseCurrency: m.baseCurrency,
    lines: cashMovementLines(m, expenseCode),
  });
}

// ─── Shift close ─────────────────────────────────────────────────────────────

/** The lines of a shift's close: the counted difference of each drawer (exported for tests). */
export function shiftCloseLines(close: ShiftClosePayload): DraftLine[] {
  const lines: DraftLine[] = [];
  for (const c of close.cash) {
    // A difference too small to be worth a qirsh in the base currency moves nothing.
    if (c.differenceBaseMinor === 0) continue;
    const shortage = c.differenceMinor < 0;
    lines.push({
      account: { cash: '1110', currency: c.currency },
      baseMinor: c.differenceBaseMinor,
      currency: c.currency,
      amountMinor: c.differenceMinor,
      rate: c.rate,
      shiftId: close.shiftId,
    });
    // 10 › مطابقة الصندوق: a shortage is a loss (6200), or a debt of the cashier (1250) when the
    // owner chose so; a surplus is always 6200.
    const account = shortage && close.shortageTreatment === 'cashier_receivable' ? '1250' : '6200';
    lines.push({
      ...baseLine(
        { code: account },
        -c.differenceBaseMinor,
        close.baseCurrency,
        shortage ? `عجز الصندوق ${c.currency}` : `زيادة الصندوق ${c.currency}`,
      ),
      shiftId: close.shiftId,
    });
  }
  return lines;
}

export async function postShiftClose(
  tx: Transaction,
  source: { tenantId: string; branchId: string; docId: string; businessDate: string },
  close: ShiftClosePayload,
): Promise<void> {
  await postEntry(tx, {
    tenantId: source.tenantId,
    branchId: source.branchId,
    date: source.businessDate,
    sourceType: 'shift_close',
    sourceId: source.docId,
    sourceNumber: close.shiftNumber,
    memo: `إغلاق الوردية ${close.shiftNumber}: فرق الصندوق`,
    baseCurrency: close.baseCurrency,
    lines: shiftCloseLines(close),
  });
}
