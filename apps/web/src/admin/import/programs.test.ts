import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, parseDelimited, tidy, type FileCell } from './file';
import { prepareRows, saveMapping } from './mapping';
import { applyOldPound } from './oldPound';
import { exportSteps, openReport, presetFor, reportTable, withBalanceColumn } from './programs';

beforeEach(() => localStorage.clear());

const branches = [{ id: 'b1', name: 'الرئيسي' }];
const SAMPLES = 'D:/serva-work/mig27/samples/';
const csv = (name: string): FileCell[][] => {
  const bytes = readFileSync(SAMPLES + name);
  const text = decodeText(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return tidy(parseDelimited(text, detectDelimiter(text)));
};

const AMEEN_PRODUCTS: FileCell[][] = [
  ['شركة النور'],
  ['تقرير جرد المواد'],
  [],
  ['رمز المادة', 'اسم المادة', 'الوحدة', 'الكمية', 'سعر الشراء', 'سعر المفرق', 'سعر الجملة', 'المجموعة'],
  ['628100010001', 'شاي', 'قطعة', 10, 20000, 25000, 22000, 'شاي'],
  ['628100010002', 'سكر', 'كيلو', 5, 27000, 34000, 30000, 'مواد'],
  ['المجموع', null, null, 15],
];
const ALL = ['barcode', 'name', 'unit', 'quantity', 'cost', 'price', 'wholesalePrice', 'category'];

describe('opening a report of an old program', () => {
  it('finds the header under the title lines, drops the totals row and keeps the lines true to the file', () => {
    const t = reportTable('products', AMEEN_PRODUCTS);
    expect(t.headers[1]).toBe('اسم المادة');
    expect(t.body).toHaveLength(2);
    expect(t.offset).toBe(3);
    const rows = prepareRows(
      'products',
      t,
      openReport('ameen', 'products', AMEEN_PRODUCTS, branches).mapping,
    );
    expect(rows.map((r) => r.line)).toEqual([5, 6]);
  });

  it('maps the columns of the three programs to the fields', () => {
    const a = openReport('ameen', 'products', AMEEN_PRODUCTS, branches);
    expect(a.mapping).toEqual(ALL);
    expect(a.recognised).toBe(8);
    const mizan = openReport(
      'mizan',
      'products',
      [
        [
          'رقم الصنف',
          'اسم الصنف',
          'الوحدة الأساسية',
          'الكمية المتوفرة',
          'التكلفة',
          'سعر البيع 1',
          'سعر البيع 2',
          'اسم المجموعة',
        ],
      ],
      branches,
    );
    expect(mizan.mapping).toEqual(ALL);
    const rashid = openReport('rashid', 'products', csv('الرشيد-قائمة-المواد.csv'), branches);
    expect(rashid.mapping).toEqual(ALL);
  });

  it('reads an English Excel report with the generic program', () => {
    const m = openReport(
      'other',
      'products',
      [['Item Name', 'Barcode', 'Unit', 'Qty', 'Cost', 'Price', 'Wholesale', 'Category']],
      branches,
    );
    expect(m.mapping).toEqual([
      'name',
      'barcode',
      'unit',
      'quantity',
      'cost',
      'price',
      'wholesalePrice',
      'category',
    ]);
  });

  it('makes one balance from مدين and دائن: for a customer what he owes, for a supplier what we owe', () => {
    const rows: FileCell[][] = [
      ['رقم الحساب', 'اسم الحساب', 'الموبايل', 'مدين', 'دائن'],
      [1, 'أحمد', '0933111222', 500, 100],
      [2, 'سامر', '0944111222', 0, 40],
      [3, 'ليلى', '0955111222', '1,000', null],
      ['المجموع', null, null, 1500, 140],
    ];
    const c = openReport('ameen', 'customers', rows, branches);
    expect(c.derivedBalance).toBe(true);
    expect(c.mapping).toEqual([null, 'name', 'phone', null, null, 'balance']);
    expect(c.table.body.map((r) => r[5])).toEqual([400, -40, 1000]);
    const s = openReport('ameen', 'suppliers', rows, branches);
    expect(s.table.body.map((r) => r[5])).toEqual([-400, 40, -1000]);
  });

  it('keeps a single balance column when the file has one', () => {
    const rows: FileCell[][] = [
      ['اسم العميل', 'رقم الهاتف', 'الرصيد'],
      ['أحمد', '0933111222', 500],
    ];
    const c = openReport('mizan', 'customers', rows, branches);
    expect(c.mapping).toEqual(['name', 'phone', 'balance']);
    expect(c.derivedBalance).toBe(false);
  });

  it('does not make a balance from text it cannot read: the server refuses it by name', () => {
    const t = reportTable('customers', [
      ['الاسم', 'مدين', 'دائن'],
      ['أحمد', 'abc', 5],
    ]);
    expect(withBalanceColumn('customers', t)!.table.body[0]![3]).toBe('abc');
  });

  it('puts the old-pound switch on the balance as on every other amount', () => {
    const rows: FileCell[][] = [
      ['الاسم', 'مدين', 'دائن'],
      ['أحمد', 250000, 50000],
    ];
    const o = openReport('ameen', 'customers', rows, branches);
    const prepared = applyOldPound(prepareRows('customers', o.table, o.mapping));
    expect(prepared[0]!.values.balance).toBe('2000');
  });

  it('reads the sample Rashid files saved in Windows-1256', () => {
    const c = openReport('rashid', 'customers', csv('الرشيد-أرصدة-الزبائن.csv'), branches);
    expect(c.mapping).toEqual(['name', 'phone', 'balance']);
    const s = openReport('rashid', 'suppliers', csv('الرشيد-أرصدة-الموردين.csv'), branches);
    expect(s.mapping).toEqual(['name', 'phone', 'balance']);
  });
});

describe('remembering per store', () => {
  it('the owner choice beats the program names, and another store does not see it', () => {
    const rows: FileCell[][] = [
      ['اسم المادة', 'سعر المفرق', 'سعر الجملة'],
      ['شاي', 1, 2],
    ];
    saveMapping('products', rows[0] as string[], ['name', 'wholesalePrice', 'price'], 'store-1');
    expect(openReport('ameen', 'products', rows, branches, 'store-1').mapping).toEqual([
      'name',
      'wholesalePrice',
      'price',
    ]);
    expect(openReport('ameen', 'products', rows, branches, 'store-2').mapping).toEqual([
      'name',
      'price',
      'wholesalePrice',
    ]);
  });
});

describe('the steps shown to the owner', () => {
  it('say honestly that the report name is not confirmed, and give the generic way out', () => {
    for (const program of ['ameen', 'mizan', 'rashid'] as const) {
      const text = exportSteps(program, 'products').join(' ');
      expect(text).toContain('لم نجرّبه على نسخة حقيقية');
      expect(text).toContain('لم تجد التقرير');
    }
    expect(exportSteps('other', 'customers').join(' ')).toContain('انسخ الجدول');
  });
  it('knows the names every program uses for the price columns', () => {
    expect(presetFor('ameen', 'products').get('سعر المفرق')).toBe('price');
  });
});
