import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  CASH_FLOW_LABEL,
  type AccountLedger,
  type BalanceSheet,
  type BalanceSheetSection,
  type CashFlow,
  type CurrencyCode,
  type JournalSourceType,
  type SupplierAgeingReport,
  type TaxReport,
} from '@serva/core';
import { minorToDecimal } from '../accounting/csv';
import { sourceLabel } from '../reports/labels';

/** A table for Excel: the headers and rows `downloadCsv` writes (BOM, CRLF), amounts as plain decimals. */
export interface CsvTable {
  headers: string[];
  rows: (string | number)[][];
}

const dec = (minor: number, currency: CurrencyCode) => minorToDecimal(minor, currency);

/** Text a spreadsheet would run as a formula (a supplier named «=1+1») gets a leading apostrophe. */
const safe = (text: string) => (/^[=+@\t\r-]/.test(text) ? `'${text}` : text);

function sectionRows(title: string, s: BalanceSheetSection, compare: boolean, base: CurrencyCode) {
  const rows: (string | number)[][] = [];
  const amounts = (now: number, before: number | null): (string | number)[] =>
    compare ? [dec(now, base), dec(before ?? 0, base)] : [dec(now, base)];
  rows.push([title, '', ...amounts(s.totalMinor, s.previousTotalMinor)]);
  for (const g of s.groups) {
    rows.push([`  ${g.name}`, '', ...amounts(g.totalMinor, g.previousTotalMinor)]);
    for (const a of g.accounts) {
      rows.push([`    ${safe(a.accountName)}`, a.accountCode, ...amounts(a.amountMinor, a.previousMinor)]);
    }
  }
  return rows;
}

/** «الميزانية العمومية»: assets, then liabilities and equity, each total on its own line. */
export function balanceSheetTable(b: BalanceSheet): CsvTable {
  const compare = b.compareTo !== null;
  const base = b.baseCurrency;
  const headers = ['البند', 'رمز الحساب', `في ${b.asOf}`, ...(compare ? [`في ${b.compareTo}`] : [])];
  const total = (label: string, now: number, before: number | null): (string | number)[] => [
    label,
    '',
    dec(now, base),
    ...(compare ? [dec(before ?? 0, base)] : []),
  ];
  return {
    headers,
    rows: [
      ...sectionRows('الأصول', b.assets, compare, base),
      ...sectionRows('الخصوم', b.liabilities, compare, base),
      ...sectionRows('حقوق الملكية', b.equity, compare, base),
      total('الخصوم وحقوق الملكية', b.liabilitiesAndEquityMinor, b.previousLiabilitiesAndEquityMinor),
    ],
  };
}

/** «التدفق النقدي»: the receipts and payments by kind, then each cash account's opening and closing. */
export function cashFlowTable(c: CashFlow): CsvTable {
  const base = c.baseCurrency;
  return {
    headers: ['البند', 'رمز الحساب', 'رصيد أول المدة', 'قبض', 'دفع', 'رصيد آخر المدة'],
    rows: [
      ...c.categories.map((k) => [
        CASH_FLOW_LABEL[k.category],
        '',
        '',
        dec(k.inMinor, base),
        dec(k.outMinor, base),
        '',
      ]),
      [
        'المجموع',
        '',
        dec(c.totals.openingMinor, base),
        dec(c.totals.inMinor, base),
        dec(c.totals.outMinor, base),
        dec(c.totals.closingMinor, base),
      ],
      ...c.accounts.map((a) => [
        safe(a.accountName),
        a.accountCode,
        dec(a.openingMinor, base),
        dec(a.inMinor, base),
        dec(a.outMinor, base),
        dec(a.closingMinor, base),
      ]),
    ],
  };
}

/** «دفتر الأستاذ» of one account with its running balance. */
export function accountLedgerTable(l: AccountLedger): CsvTable {
  const base = l.baseCurrency;
  return {
    headers: ['التاريخ', 'رقم القيد', 'الحساب', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'],
    rows: [
      [l.from, '', '', '', 'رصيد أول المدة', '', '', dec(l.openingMinor, base)],
      ...l.lines.map((x) => [
        x.date,
        x.entryNumber,
        x.accountCode,
        `${sourceLabel(x.sourceType as JournalSourceType)} ${x.sourceNumber ?? ''}`.trim(),
        safe(x.memo),
        dec(x.debitMinor, base),
        dec(x.creditMinor, base),
        dec(x.balanceMinor, base),
      ]),
      [
        l.to,
        '',
        '',
        '',
        'المجموع',
        dec(l.totalDebitMinor, base),
        dec(l.totalCreditMinor, base),
        dec(l.closingMinor, base),
      ],
    ],
  };
}

/** «تقرير الضريبة»: per rate, what was sold, returned and the tax on each, then the totals. */
export function taxTable(t: TaxReport): CsvTable {
  const base = t.baseCurrency;
  return {
    headers: [
      'الضريبة',
      'النسبة %',
      'مبيعات بدون ضريبة',
      'ضريبة المبيعات',
      'مرتجعات بدون ضريبة',
      'ضريبة المرتجعات',
      'الصافي بدون ضريبة',
      'صافي الضريبة',
    ],
    rows: [
      ...t.rows.map((r) => [
        r.name,
        r.rateBp / 100,
        dec(r.salesTaxableMinor, base),
        dec(r.salesTaxMinor, base),
        dec(r.returnsTaxableMinor, base),
        dec(r.returnsTaxMinor, base),
        dec(r.netTaxableMinor, base),
        dec(r.netTaxMinor, base),
      ]),
      [
        'المجموع',
        '',
        dec(t.totals.salesTaxableMinor, base),
        dec(t.totals.salesTaxMinor, base),
        dec(t.totals.returnsTaxableMinor, base),
        dec(t.totals.returnsTaxMinor, base),
        dec(t.totals.netTaxableMinor, base),
        dec(t.totals.netTaxMinor, base),
      ],
      ['ضريبة المشتريات (مدخلات)', '', '', '', '', '', '', dec(t.inputTaxMinor, base)],
      ['الصافي المستحق للدولة', '', '', '', '', '', '', dec(t.netPayableMinor, base)],
    ],
  };
}

/** «أعمار ديون الموردين»: one row per supplier and a totals row. */
export function supplierAgeingTable(r: SupplierAgeingReport): CsvTable {
  const base = r.baseCurrency;
  return {
    headers: ['المورد', 'الجوال', ...AGEING_BUCKETS.map((b) => AGEING_LABELS[b]), 'الإجمالي'],
    rows: [
      ...r.items.map((i) => [
        safe(i.name),
        i.phone ?? '',
        ...AGEING_BUCKETS.map((b) => dec(i.buckets[b], base)),
        dec(i.balanceMinor, base),
      ]),
      [
        'الإجمالي',
        '',
        ...AGEING_BUCKETS.map((b) => dec(r.totals[b], base)),
        dec(r.totals.balanceMinor, base),
      ],
    ],
  };
}
