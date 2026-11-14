import {
  STATEMENT_SOURCE_LABEL,
  type CurrencyCode,
  type ExpenseListResponse,
  type PartyStatement,
  type ProfitLoss,
} from '@serva/core';
import { csvField, minorToDecimal } from '../accounting/csv';

const BOM = '﻿';
const join = (rows: string[][]) => `${BOM}${rows.map((cells) => cells.join(',')).join('\r\n')}\r\n`;

/** What a statement line is called: its document's kind, falling back to the entry's memo. */
export const statementWhat = (line: { sourceType: string; memo: string }) =>
  // A manual entry says what it is in its memo: «سند قبض …», «رصيد افتتاحي — …»
  line.sourceType === 'manual' && line.memo
    ? line.memo
    : (STATEMENT_SOURCE_LABEL[line.sourceType] ?? line.memo);

/**
 * A party's statement as CSV for Excel: the party and the period first, then the opening balance,
 * every movement with its running balance, the totals and the closing balance. The balance is on
 * the account's own side (a customer: what they owe; a supplier: what the store owes).
 */
export function statementCsv(s: PartyStatement): string {
  const n = (minor: number) => csvField(minorToDecimal(minor, s.baseCurrency), true);
  const text = (value: string) => csvField(value);
  const head = [
    'التاريخ',
    'البيان',
    'الرقم',
    'ملاحظات',
    s.type === 'customer' ? 'عليه' : 'عليه',
    'له',
    'الرصيد',
  ];
  return join([
    [text(s.type === 'customer' ? 'كشف حساب زبون' : 'كشف حساب مورد'), text(s.party.name)],
    [text('من'), text(s.from), text('إلى'), text(s.to)],
    head.map(text),
    [text(s.from), text('رصيد أول المدة'), text(''), text(''), n(0), n(0), n(s.openingMinor)],
    ...s.lines.map((l) => [
      text(l.date),
      text(statementWhat(l)),
      text(l.number ?? ''),
      text(l.memo),
      n(l.debitMinor),
      n(l.creditMinor),
      n(l.balanceMinor),
    ]),
    [
      text(s.to),
      text('المجموع'),
      text(''),
      text(''),
      n(s.totalDebitMinor),
      n(s.totalCreditMinor),
      n(s.closingMinor),
    ],
  ]);
}

/** The expenses of a filter as CSV, the cancelled marked and left out of the total. */
export function expensesCsv(list: ExpenseListResponse, rows: ExpenseListResponse['items']): string {
  const base: CurrencyCode = list.baseCurrency;
  const text = (value: string) => csvField(value);
  const n = (minor: number, currency: CurrencyCode = base) => csvField(minorToDecimal(minor, currency), true);
  return join([
    ['الرقم', 'التاريخ', 'الحساب', 'المبلغ', 'العملة', 'بالعملة الأساسية', 'الحالة', 'ملاحظة'].map(text),
    ...rows.map((e) => [
      text(e.number),
      text(e.date),
      text(`${e.accountCode} ${e.accountName}`),
      n(e.amountMinor, e.currency),
      text(e.currency),
      n(e.baseAmountMinor),
      text(e.voided ? 'ملغى' : ''),
      text(e.note ?? ''),
    ]),
    [text(''), text(''), text('المجموع'), text(''), text(''), n(list.totalMinor), text(''), text('')],
  ]);
}

/** The profit and loss as CSV: each section's accounts and totals, then the net. */
export function profitLossCsv(p: ProfitLoss): string {
  const text = (value: string) => csvField(value);
  const n = (minor: number) => csvField(minorToDecimal(minor, p.baseCurrency), true);
  const section = (title: string, accounts: ProfitLoss['revenue']['accounts'], total: number) => [
    [text(title), text(''), n(total)],
    ...accounts.map((a) => [text(a.accountCode), text(a.accountName), n(a.amountMinor)]),
  ];
  return join([
    [text('قائمة الدخل'), text(`${p.from} - ${p.to}`), text('')],
    ...section('الإيرادات (بعد الحسميات والمردودات)', p.revenue.accounts, p.revenue.totalMinor),
    ...section('كلفة المبيعات', p.costOfSales.accounts, p.costOfSales.totalMinor),
    [text('مجمل الربح'), text(''), n(p.grossProfitMinor)],
    ...section('إيرادات أخرى', p.otherIncome.accounts, p.otherIncome.totalMinor),
    ...p.expenses.groups.flatMap((g) => section(g.name, g.accounts, g.totalMinor)),
    [text('مجموع المصروفات'), text(''), n(p.expenses.totalMinor)],
    [text('صافي الربح'), text(''), n(p.netProfitMinor)],
  ]);
}
