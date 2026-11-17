import { IMPORT_FIELDS, normalizeArabic, toLatinDigits, type ImportType } from '@serva/core';
import { initialMapping, tableOf, type Branch, type Mapping, type Table } from './mapping';
import type { FileCell } from './file';

/**
 * «انقل من برنامجك القديم»: what each old program's reports look like and how to ask them for
 * Excel. We have no copy of these programs, so the menu names below are what their own users call
 * the reports (docs/specs/05-migration.md), said honestly as «غالباً»; the generic path always works.
 */
export type ProgramId = 'ameen' | 'mizan' | 'rashid' | 'other';

export const PROGRAM_IDS: readonly ProgramId[] = ['ameen', 'mizan', 'rashid', 'other'];

export interface Program {
  id: ProgramId;
  label: string;
  maker: string;
  /** Report names, per type, as the program's users call them (not confirmed on a real copy) */
  reports: Record<ImportType, string>;
}

export const PROGRAMS: Record<ProgramId, Program> = {
  ameen: {
    id: 'ameen',
    label: 'الأمين',
    maker: 'الأمين سوفت',
    reports: { products: 'جرد المواد', customers: 'أرصدة الزبائن', suppliers: 'أرصدة الموردين' },
  },
  mizan: {
    id: 'mizan',
    label: 'الميزان',
    maker: 'الحضارة للأنظمة',
    reports: { products: 'جرد المستودع', customers: 'أرصدة العملاء', suppliers: 'أرصدة الموردين' },
  },
  rashid: {
    id: 'rashid',
    label: 'الرشيد',
    maker: 'الرشيد للحواسب',
    reports: { products: 'قائمة المواد', customers: 'أرصدة الزبائن', suppliers: 'أرصدة الموردين' },
  },
  other: {
    id: 'other',
    label: 'برنامج آخر أو ملف إكسل',
    maker: 'أي برنامج يصدّر إلى إكسل',
    reports: { products: 'قائمة الأصناف', customers: 'أرصدة الزبائن', suppliers: 'أرصدة الموردين' },
  },
};

/** What the owner is asked to put in the report, per type: said once, the same for every program. */
const WANTED: Record<ImportType, string> = {
  products: 'اسم المادة، الباركود، الوحدة، الكمية، سعر الشراء (التكلفة)، سعر المفرق، سعر الجملة، المجموعة',
  customers: 'اسم الزبون، الجوال، الرصيد (أو عمودا مدين ودائن)',
  suppliers: 'اسم المورد، الجوال، الرصيد (أو عمودا مدين ودائن)',
};

/** The steps to follow in the old program, short and plain. */
export function exportSteps(program: ProgramId, type: ImportType): string[] {
  const p = PROGRAMS[program];
  if (program === 'other') {
    return [
      `في برنامجك افتح أي تقرير يعرض ${type === 'products' ? 'الأصناف' : type === 'customers' ? 'الزبائن' : 'الموردين'} (مثل «${p.reports[type]}»).`,
      `تأكد أن فيه الأعمدة: ${WANTED[type]}.`,
      'اضغط زر التصدير إلى إكسل (Excel) أو الطباعة ثم «حفظ بصيغة Excel»، واحفظ الملف على سطح المكتب.',
      'إن لم يوجد زر تصدير: انسخ الجدول كله والصقه في إكسل واحفظه.',
      'اسحب الملف هنا أو اختره.',
    ];
  }
  return [
    `افتح ${p.label}، ثم قائمة «التقارير».`,
    `ابحث عن تقرير «${p.reports[type]}» (هذا الاسم غالباً، وقد يختلف بين الإصدارات. لم نجرّبه على نسخة حقيقية).`,
    `اجعله يعرض الأعمدة: ${WANTED[type]}. اختر «كل المواد» ولا تحدد مستودعاً أو مجموعة واحدة.`,
    'اضغط تصدير إلى إكسل (Excel)، واحفظ الملف على سطح المكتب.',
    `لم تجد التقرير باسمه؟ افتح أي تقرير يعرض ${type === 'products' ? 'المواد' : type === 'customers' ? 'الزبائن' : 'الموردين'} بالأعمدة نفسها وصدّره، فيكفي.`,
    'اسحب الملف هنا أو اختره.',
  ];
}

// ─── What the programs call their columns ────────────────────────────────────

type Preset = Record<string, readonly string[]>;

const BASE: Record<ImportType, Preset> = {
  products: {
    name: ['اسم المادة', 'اسم المادة بالعربي', 'البيان', 'اسم الصنف', 'المادة', 'اسم الصنف بالعربية'],
    barcode: ['الباركود', 'باركود المادة', 'الباركود الأساسي', 'رمز المادة', 'رقم المادة', 'كود المادة'],
    unit: ['الوحدة', 'الوحدة الأساسية', 'وحدة المادة', 'وحدة القياس'],
    cost: ['سعر الشراء', 'آخر سعر شراء', 'متوسط التكلفة', 'التكلفة المتوسطة', 'سعر التكلفة', 'الكلفة'],
    price: [
      'سعر المفرق',
      'سعر المستهلك',
      'السعر الإفرادي',
      'السعر الافرادي',
      'مفرق',
      'سعر البيع',
      'سعر البيع 1',
    ],
    wholesalePrice: ['سعر الجملة', 'جملة', 'الجملة', 'سعر الجملة 1'],
    category: ['المجموعة', 'اسم المجموعة', 'مجموعة المادة', 'الفئة', 'التصنيف', 'القسم'],
    quantity: ['الكمية', 'الرصيد', 'الكمية المتوفرة', 'الرصيد الحالي', 'الكمية الحالية', 'كمية المخزون'],
  },
  customers: {
    name: ['اسم الحساب', 'اسم العميل', 'اسم الزبون', 'العميل', 'الزبون'],
    phone: ['الجوال', 'الموبايل', 'رقم الجوال', 'رقم الهاتف', 'هاتف', 'تلفون', 'الهاتف'],
    address: ['العنوان', 'المنطقة'],
    balance: ['الرصيد', 'الرصيد الحالي', 'الرصيد النهائي', 'المتبقي', 'الرصيد المدين', 'رصيد الحساب'],
  },
  suppliers: {
    name: ['اسم الحساب', 'اسم المورد', 'المورد', 'اسم الشركة'],
    phone: ['الجوال', 'الموبايل', 'رقم الجوال', 'رقم الهاتف', 'هاتف', 'تلفون', 'الهاتف'],
    notes: ['العنوان', 'ملاحظات'],
    balance: ['الرصيد', 'الرصيد الحالي', 'الرصيد النهائي', 'المتبقي', 'الرصيد الدائن', 'رصيد الحساب'],
  },
};

/** What one program adds or says differently (kept small: only names we have reason to expect). */
const EXTRA: Record<ProgramId, Partial<Record<ImportType, Preset>>> = {
  ameen: {
    products: {
      name: ['اسم المادة'],
      barcode: ['رمز المادة'],
      price: ['سعر المفرق'],
      wholesalePrice: ['سعر الجملة'],
    },
  },
  mizan: {
    products: {
      name: ['اسم الصنف'],
      barcode: ['رقم الصنف'],
      price: ['سعر البيع 1'],
      wholesalePrice: ['سعر البيع 2'],
    },
  },
  rashid: {
    products: { name: ['اسم الصنف'], barcode: ['رقم الصنف'], price: ['السعر'], quantity: ['الكمية الحالية'] },
  },
  other: {},
};

/** header (as compared) → field, for one program and type. */
export function presetFor(program: ProgramId, type: ImportType): Map<string, string> {
  const merged = new Map<string, string>();
  const add = (preset: Preset | undefined) => {
    for (const [field, headers] of Object.entries(preset ?? {}))
      for (const header of headers) merged.set(normalizeArabic(header), field);
  };
  add(BASE[type]);
  add(EXTRA[program][type]);
  return merged;
}

// ─── Reading a report as it comes out of an old program ──────────────────────

const TOTAL_ROW = /^(المجموع|الاجمالي|الإجمالي|مجموع|total)/i;

const isBlank = (c: FileCell | undefined) => c === null || c === undefined || String(c).trim() === '';

/** How many cells of a row read as a known column name of the type (any program). */
function headerScore(type: ImportType, row: readonly FileCell[]): number {
  const known = new Set<string>();
  for (const field of IMPORT_FIELDS[type])
    for (const alias of [field.label, ...field.aliases]) known.add(normalizeArabic(alias));
  for (const header of presetFor('other', type).keys()) known.add(header);
  return row.filter((c) => !isBlank(c) && known.has(normalizeArabic(String(c)))).length;
}

/**
 * The table of a report. Old programs print a title (and the shop's name, the date) above the
 * columns and a «المجموع» row under them: the header row is the first of the top ten rows that
 * names at least two known columns, and totals rows are dropped.
 */
export function reportTable(type: ImportType, rows: FileCell[][]): Table {
  let at = 0;
  let best = 0;
  rows.slice(0, 10).forEach((row, i) => {
    const score = headerScore(type, row);
    if (score > best) {
      best = score;
      at = i;
    }
  });
  if (best < 2) at = 0;
  const table = tableOf(rows.slice(at));
  const body = table.body.filter((r) => !TOTAL_ROW.test(String(r.find((c) => !isBlank(c)) ?? '').trim()));
  return { headers: table.headers, body, offset: at };
}

const DEBIT = new Set(['مدين', 'المدين', 'عليه', 'عليهم', 'debit', 'dr'].map(normalizeArabic));
const CREDIT = new Set(['دائن', 'الدائن', 'له', 'لهم', 'credit', 'cr'].map(normalizeArabic));

function amountOf(cell: FileCell | undefined): number | null {
  if (isBlank(cell)) return 0;
  if (typeof cell === 'number') return cell;
  const n = Number(toLatinDigits(String(cell)).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Old programs list an account's balance as two columns, مدين and دائن. The import wants one
 * signed number: for a customer what he owes us (مدين − دائن), for a supplier what we owe him
 * (دائن − مدين). The new column is added at the end; the two it came from are left alone.
 */
export function withBalanceColumn(
  type: ImportType,
  table: Table,
): { table: Table; debit: number; credit: number; balance: number } | null {
  if (type === 'products') return null;
  const find = (set: Set<string>) => table.headers.findIndex((h) => set.has(normalizeArabic(h)));
  const debit = find(DEBIT);
  const credit = find(CREDIT);
  if (debit < 0 || credit < 0) return null;
  const header = type === 'customers' ? 'الرصيد (مدين − دائن)' : 'الرصيد (دائن − مدين)';
  const body = table.body.map((row) => {
    const d = amountOf(row[debit]);
    const c = amountOf(row[credit]);
    if (isBlank(row[debit]) && isBlank(row[credit])) return [...row, null];
    if (d === null || c === null) return [...row, String(row[debit] ?? row[credit])];
    const value = type === 'customers' ? d - c : c - d;
    return [...row, Math.round(value * 100) / 100];
  });
  return {
    table: { ...table, headers: [...table.headers, header], body },
    debit,
    credit,
    balance: table.headers.length,
  };
}

/**
 * Everything the wizard does when a file of a known program arrives: finds the header row, makes
 * a single balance column from مدين and دائن, and maps the columns (the owner's remembered choices
 * first, then this program's names, then the generic guess).
 */
export function openReport(
  program: ProgramId,
  type: ImportType,
  rows: FileCell[][],
  branches: readonly Branch[],
  store?: string,
): { table: Table; mapping: Mapping; recognised: number; derivedBalance: boolean } {
  let table = reportTable(type, rows);
  const preset = presetFor(program, type);
  let mapping = initialMapping(type, table.headers, branches, preset, store);
  const derived = withBalanceColumn(type, table);
  // A balance the file already gives as one column wins; مدين and دائن are only combined when no other column is the balance
  const own = mapping.findIndex((k, c) => k === 'balance' && c !== derived?.debit && c !== derived?.credit);
  let derivedBalance = false;
  if (derived && own < 0) {
    table = derived.table;
    mapping = initialMapping(type, table.headers, branches, preset, store);
    mapping = mapping.map((k, c) =>
      c === derived.debit || c === derived.credit
        ? null
        : c === derived.balance
          ? 'balance'
          : k === 'balance'
            ? null
            : k,
    );
    derivedBalance = true;
  } else if (derived) {
    mapping = mapping.map((k, c) => (c === derived.debit || c === derived.credit ? null : k));
  }
  return { table, mapping, recognised: mapping.filter((k) => k !== null).length, derivedBalance };
}
