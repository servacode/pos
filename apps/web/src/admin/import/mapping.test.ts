import { beforeEach, describe, expect, it } from 'vitest';
import { guessImportFields } from '@serva/core';
import { decodeText, detectDelimiter, parseDelimited, readSpreadsheet, tidy } from './file';
import {
  assign,
  chunkRows,
  csvField,
  initialMapping,
  missingRequired,
  prepareRows,
  reportCsv,
  saveMapping,
  tableOf,
  targetsOf,
  templateCsv,
} from './mapping';

beforeEach(() => localStorage.clear());

describe('guessing the columns from their headers', () => {
  it('reads Arabic and English headers, with other programs’ words', () => {
    expect(
      guessImportFields('products', [
        'اسم المادة',
        'الباركود',
        'سعر المبيع',
        'سعر الشراء',
        'الكمية',
        'المجموعة',
        'Unit',
        'ملاحظة غريبة',
      ]),
    ).toEqual(['name', 'barcode', 'price', 'cost', 'quantity', 'category', 'unit', null]);
    expect(
      guessImportFields('products', ['Product Name', 'EAN', 'Retail Price', 'Cost', 'Qty', 'Size', 'Colour']),
    ).toEqual(['name', 'barcode', 'price', 'cost', 'quantity', 'size', 'colour']);
    expect(guessImportFields('customers', ['اسم العميل', 'الموبايل', 'الرصيد', 'حد الدين'])).toEqual([
      'name',
      'phone',
      'balance',
      'creditLimit',
    ]);
    expect(guessImportFields('suppliers', ['المورد', 'تلفون', 'رصيد المورد'])).toEqual([
      'name',
      'phone',
      'balance',
    ]);
  });

  it('feeds a field from one column only, the first', () => {
    expect(guessImportFields('products', ['الاسم', 'اسم الصنف'])).toEqual(['name', null]);
  });

  it('matches letter variants and ignores punctuation', () => {
    expect(guessImportFields('products', ['الإسم الإنجليزي', 'سعر_البيع', 'ال ـ باركود'])).toEqual([
      'nameEn',
      'price',
      'barcode',
    ]);
  });
});

describe('the mapping', () => {
  const branches = [
    { id: 'b1', name: 'الرئيسي' },
    { id: 'b2', name: 'المزة' },
  ];

  it('starts from the guess, then from what the owner chose last time for the same header', () => {
    const headers = ['العمود س', 'الكمية', 'سعر'];
    expect(initialMapping('products', headers, branches)).toEqual([null, 'quantity', 'price']);
    saveMapping('products', headers, [null, 'qty:b2', 'wholesalePrice']);
    expect(initialMapping('products', headers, branches)).toEqual([null, 'qty:b2', 'wholesalePrice']);
    // Another type does not inherit it
    expect(initialMapping('customers', ['الكمية'], branches)).toEqual([null]);
  });

  it('survives a browser with no storage', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
    try {
      expect(() => saveMapping('products', ['a'], ['name'])).not.toThrow();
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('a field has one column: choosing it again frees the first', () => {
    expect(assign(['name', 'price', null], 2, 'name')).toEqual([null, 'price', 'name']);
    expect(assign(['name', 'price'], 1, null)).toEqual(['name', null]);
  });

  it('names the required fields still unmapped', () => {
    expect(missingRequired('products', ['price'])).toEqual(['اسم المنتج']);
    expect(missingRequired('products', ['name'])).toEqual([]);
  });

  it('offers a quantity column per branch only when there are several', () => {
    expect(targetsOf('products', [branches[0]!]).some((t) => t.key.startsWith('qty:'))).toBe(false);
    expect(
      targetsOf('products', branches)
        .filter((t) => t.key.startsWith('qty:'))
        .map((t) => t.label),
    ).toEqual(['الكمية الافتتاحية — الرئيسي', 'الكمية الافتتاحية — المزة']);
  });
});

describe('rows to send', () => {
  const table = tableOf([
    ['الاسم', 'الباركود', 'المقاس', 'السعر'],
    ['قميص', '111', 'M', 5],
    ['', '', '', ''],
    ['بنطال', '222', null, 9],
    ['قميص', '112', 'L', 5],
    ['شاي', '111', null, 3],
    ['قميص', '113', 'XL', 5],
  ]);
  const mapping = ['name', 'barcode', 'size', 'price'];

  it('numbers rows by their line in the file, skips empty ones, marks a repeated barcode', () => {
    const rows = prepareRows('products', table, mapping);
    expect(rows.map((r) => r.line).sort((a, b) => a - b)).toEqual([2, 4, 5, 6, 7]);
    expect(rows.find((r) => r.line === 6)).toMatchObject({ duplicateOf: 2 });
    expect(rows.find((r) => r.line === 2)!.values).toEqual({
      name: 'قميص',
      barcode: '111',
      size: 'M',
      price: 5,
    });
  });

  it('brings the sizes of one product together, in the order the product first appears', () => {
    const rows = prepareRows('products', table, mapping);
    expect(rows.map((r) => r.line)).toEqual([2, 5, 7, 4, 6]);
  });

  it('chunks never split one product’s sizes, and never exceed the cap', () => {
    const rows = prepareRows('products', table, mapping).filter((r) => r.duplicateOf === undefined);
    expect(chunkRows('products', rows, 1).map((c) => c.map((r) => r.line))).toEqual([[2, 5, 7], [4]]);
    expect(chunkRows('products', rows, 1, 2).map((c) => c.map((r) => r.line))).toEqual([[2, 5], [7], [4]]);
    const many = Array.from({ length: 1050 }, (_, i) => ({ line: i + 2, values: { name: `س${String(i)}` } }));
    expect(chunkRows('customers', many).map((c) => c.length)).toEqual([200, 200, 200, 200, 200, 50]);
  });

  it('repeats a phone for customers the same way', () => {
    const t = tableOf([
      ['الاسم', 'الجوال'],
      ['أ', '0912345678'],
      ['ب', '٠٩١٢٣٤٥٦٧٨'],
    ]);
    expect(prepareRows('customers', t, ['name', 'phone']).map((r) => r.duplicateOf)).toEqual([undefined, 2]);
  });

  it('names unnamed and repeated headers', () => {
    expect(tableOf([['اسم', '', 'اسم'], ['x']]).headers).toEqual(['اسم', 'عمود 2', 'اسم (2)']);
  });
});

describe('files out', () => {
  it('quotes CSV fields and defangs formulas', () => {
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField('=1+1')).toBe(`"'=1+1"`);
    expect(csvField('-5')).toBe('"-5"');
  });

  it('the template has the field names, a sample row and a byte-order mark', () => {
    const csv = templateCsv('customers');
    expect(csv.startsWith('﻿"اسم الزبون","الجوال"')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('the errors file names the line, the field and the reason', () => {
    const csv = reportCsv('products', [
      { line: 7, status: 'خطأ', field: 'price', message: 'سعر البيع ليس رقماً' },
    ]);
    expect(csv).toContain('"السطر في الملف","الحالة","الحقل","السبب"');
    expect(csv).toContain('"7","خطأ","سعر البيع","سعر البيع ليس رقماً"');
  });
});

describe('reading files', () => {
  it('parses quotes, doubled quotes, line breaks inside quotes, CRLF', () => {
    expect(parseDelimited('a,"b,c","d""e"\r\n"x\ny",z\r\n', ',')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['x\ny', 'z'],
    ]);
  });

  it('finds the delimiter an Arabic-locale Excel uses', () => {
    expect(detectDelimiter('الاسم;السعر\nقميص;5000')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b\n1,2')).toBe(',');
  });

  it('decodes UTF-8 and falls back to Windows-1256', () => {
    const utf8 = new TextEncoder().encode('﻿قميص');
    expect(decodeText(utf8.buffer as ArrayBuffer)).toBe('قميص');
    // «قميص» in windows-1256
    const legacy = new Uint8Array([0xde, 0xe3, 0xed, 0xd5]);
    expect(decodeText(legacy.buffer)).toBe('قميص');
  });

  it('drops empty rows and trailing empty cells', () => {
    expect(tidy([['a', null, ''], [null, ''], ['b']])).toEqual([['a'], ['b']]);
  });

  it('reads a CSV file and refuses the old xls and unknown types in Arabic', async () => {
    const csv = new File(['﻿الاسم;السعر\r\nقميص;5000\r\n'], 'منتجات.csv', { type: 'text/csv' });
    expect(await readSpreadsheet(csv)).toEqual([
      {
        name: 'CSV',
        rows: [
          ['الاسم', 'السعر'],
          ['قميص', '5000'],
        ],
      },
    ]);
    await expect(readSpreadsheet(new File(['x'], 'a.xls'))).rejects.toThrow('xls');
    await expect(readSpreadsheet(new File(['x'], 'a.pdf'))).rejects.toThrow('xlsx أو csv');
    await expect(readSpreadsheet(new File([''], 'a.csv'))).rejects.toThrow('فارغ');
  });
});
