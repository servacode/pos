import type { CurrencyCode } from './currencies';
import type {
  ExpenseInput,
  ExpensePayFrom,
  ManualEntryInput,
  PnlAccount,
  ProfitLoss,
} from './contracts/ledger-docs';
import type { TradeRate } from './contracts/common';
import { convert } from './money';

/**
 * The pure rules behind statements, expenses, manual entries and the profit and loss (29). They
 * return the lines the posting mechanism writes (the same shape as its DraftLine: base amounts
 * signed, + debit and - credit) and never touch a database, so the same function backs the server
 * and its tests. Every entry is balanced here before the database checks it again.
 */

export type LedgerAccountRef = { code: string } | { cash: '1110' | '1120'; currency: string };

export interface LedgerLine {
  account: LedgerAccountRef;
  /** Signed in the base currency: positive is a debit, negative a credit */
  baseMinor: number;
  currency: string;
  /** Signed like baseMinor, in `currency` */
  amountMinor: number;
  rate: TradeRate | null;
  memo?: string | null;
}

// ─── Statements ──────────────────────────────────────────────────────────────

export interface StatementMovement {
  debitMinor: number;
  creditMinor: number;
}

/**
 * The running balance of an account's lines. `side` is the side that makes the balance positive: a
 * customer's account is a debit balance (what they owe), a supplier's a credit balance (what is
 * owed to them). `closing` equals `opening` plus every line, so the statement always adds up.
 */
export function runStatement<T extends StatementMovement>(
  openingMinor: number,
  movements: readonly T[],
  side: 'debit' | 'credit',
): {
  lines: (T & { balanceMinor: number })[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  closingMinor: number;
} {
  const sign = side === 'debit' ? 1 : -1;
  let running = openingMinor;
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  const lines = movements.map((m) => {
    running += sign * (m.debitMinor - m.creditMinor);
    totalDebitMinor += m.debitMinor;
    totalCreditMinor += m.creditMinor;
    return { ...m, balanceMinor: running };
  });
  return { lines, totalDebitMinor, totalCreditMinor, closingMinor: running };
}

/** What a movement is called on a statement. */
export const STATEMENT_SOURCE_LABEL: Record<string, string> = {
  sale: 'فاتورة آجل',
  return: 'مرتجع مبيعات',
  receipt: 'سند قبض',
  cheque: 'شيك',
  purchase: 'فاتورة شراء',
  supplier_payment: 'سند دفع',
  supplier_return: 'مرتجع إلى المورد',
  manual: 'قيد يدوي',
  reversal: 'قيد عكسي',
};

// ─── Expenses ────────────────────────────────────────────────────────────────

const PAY_ACCOUNT = (payFrom: ExpensePayFrom, currency: string): LedgerAccountRef => {
  switch (payFrom) {
    case 'safe':
      return { cash: '1120', currency };
    case 'bank':
      return { code: '1130' };
    case 'wallet':
      return { code: '1150' };
    case 'card':
      return { code: '1140' };
  }
};

/** The amount in the base currency: itself, or converted at the rate (half away from zero). */
export function toBase(
  amountMinor: number,
  currency: CurrencyCode,
  base: CurrencyCode,
  rate: TradeRate | null | undefined,
): number {
  if (currency === base) return amountMinor;
  return convert(amountMinor, currency, base, rate ?? undefined);
}

/** An expense: Dr the expense account (base currency), Cr where it was paid from (its own currency). */
export function expenseLines(
  e: Pick<ExpenseInput, 'accountCode' | 'amountMinor' | 'currency' | 'payFrom' | 'note'>,
  base: CurrencyCode,
  rate: TradeRate | null,
): LedgerLine[] {
  const baseMinor = toBase(e.amountMinor, e.currency, base, rate);
  const foreign = e.currency !== base;
  return [
    {
      account: { code: e.accountCode },
      baseMinor,
      currency: base,
      amountMinor: baseMinor,
      rate: null,
      memo: e.note ?? null,
    },
    {
      account: PAY_ACCOUNT(e.payFrom, e.currency),
      baseMinor: -baseMinor,
      currency: e.currency,
      amountMinor: -e.amountMinor,
      rate: foreign ? rate : null,
    },
  ];
}

// ─── Manual entries ──────────────────────────────────────────────────────────

export type ManualCheck =
  { ok: true; lines: LedgerLine[]; totalMinor: number } | { ok: false; message: string; field?: string };

/**
 * The lines of a manual entry in the base currency, or why it cannot post: debit must equal credit
 * in the base currency (the database enforces the same), and a foreign line needs its rate.
 */
export function manualEntryLines(
  input: Pick<ManualEntryInput, 'lines'>,
  base: CurrencyCode,
  rateOf: (currency: CurrencyCode) => TradeRate | null,
): ManualCheck {
  const lines: LedgerLine[] = [];
  let debit = 0;
  let credit = 0;
  for (const [i, l] of input.lines.entries()) {
    const currency = (l.currency ?? base) as CurrencyCode;
    const amount = l.debitMinor > 0 ? l.debitMinor : l.creditMinor;
    const rate = currency === base ? null : (l.rate ?? rateOf(currency));
    if (currency !== base && !rate) {
      return { ok: false, message: `لا سعر صرف للعملة ${currency}`, field: `lines.${i}.currency` };
    }
    const baseAmount = toBase(amount, currency, base, rate);
    if (baseAmount === 0) {
      return { ok: false, message: 'مبلغ السطر صغير جداً بالعملة الأساسية', field: `lines.${i}.debitMinor` };
    }
    const isDebit = l.debitMinor > 0;
    if (isDebit) debit += baseAmount;
    else credit += baseAmount;
    lines.push({
      // The safe is a group of one account per currency: a line on 1120 goes to its currency's account.
      account: l.accountCode === '1120' ? { cash: '1120', currency } : { code: l.accountCode },
      baseMinor: isDebit ? baseAmount : -baseAmount,
      currency,
      amountMinor: isDebit ? amount : -amount,
      rate,
      memo: l.memo ?? null,
    });
  }
  if (debit !== credit) {
    return { ok: false, message: 'القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن' };
  }
  return { ok: true, lines, totalMinor: debit };
}

/** A posted entry's lines turned around: what it debited it now credits, with the same parties. */
export function reversalLines<T extends LedgerLine>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, baseMinor: -l.baseMinor, amountMinor: -l.amountMinor }));
}

// ─── Profit and loss ─────────────────────────────────────────────────────────

export interface PnlSourceRow {
  code: string;
  name: string;
  debitMinor: number;
  creditMinor: number;
}

/** Names of the expense groups (the chart's two-digit parents). */
export const EXPENSE_GROUP_NAME: Record<string, string> = {
  '61': 'المصروفات التشغيلية والإدارية',
  '62': 'فروقات الصندوق والمخزون والتقريب',
  '65': 'فروقات الصرف',
  '66': 'عمولات الوسطاء',
  '67': 'الولاء',
  '68': 'النزاعات والاحتيال',
  '69': 'الديون المعدومة وضريبة الدخل',
};

const section = (rows: PnlAccount[]) => ({
  accounts: rows,
  totalMinor: rows.reduce((sum, r) => sum + r.amountMinor, 0),
});

/**
 * The profit and loss of a period from its accounts' movements: revenue (4100 and its siblings, less the
 * discounts 4200 and returns 4300 that sit on the debit side), cost of sales (5xxx), gross profit, other income (49xx)
 * and the expenses (6xxx) by group, and the net. An account with no movement is left out.
 */
export function buildProfitLoss(
  rows: readonly PnlSourceRow[],
  head: Pick<ProfitLoss, 'from' | 'to' | 'branchId' | 'baseCurrency'>,
): ProfitLoss {
  const creditNet = (r: PnlSourceRow) => r.creditMinor - r.debitMinor;
  const debitNet = (r: PnlSourceRow) => r.debitMinor - r.creditMinor;
  const pick = (match: (code: string) => boolean, amount: (r: PnlSourceRow) => number): PnlAccount[] =>
    rows
      .filter((r) => match(r.code) && amount(r) !== 0)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => ({ accountCode: r.code, accountName: r.name, amountMinor: amount(r) }));

  const revenue = section(pick((c) => c.startsWith('4') && !c.startsWith('49'), creditNet));
  const costOfSales = section(pick((c) => c.startsWith('5'), debitNet));
  const otherIncome = section(pick((c) => c.startsWith('49'), creditNet));
  const expenseAccounts = pick((c) => c.startsWith('6'), debitNet);
  const groups = new Map<string, PnlAccount[]>();
  for (const a of expenseAccounts) {
    const key = a.accountCode.slice(0, 2);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const expenseGroups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, accounts]) => ({
      code,
      name: EXPENSE_GROUP_NAME[code] ?? 'مصروفات أخرى',
      accounts,
      totalMinor: accounts.reduce((sum, a) => sum + a.amountMinor, 0),
    }));
  const expensesTotal = expenseGroups.reduce((sum, g) => sum + g.totalMinor, 0);
  const grossProfitMinor = revenue.totalMinor - costOfSales.totalMinor;
  return {
    ...head,
    revenue,
    costOfSales,
    grossProfitMinor,
    otherIncome,
    expenses: { groups: expenseGroups, totalMinor: expensesTotal },
    netProfitMinor: grossProfitMinor + otherIncome.totalMinor - expensesTotal,
  };
}
