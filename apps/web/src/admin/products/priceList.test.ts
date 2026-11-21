import { afterEach, describe, expect, it } from 'vitest';
import type { PriceListItem } from '@serva/core';
import {
  columnsReady,
  detectHeaderRow,
  group,
  guessColumns,
  NO_COLUMNS,
  queueLabels,
  rowsOf,
  tableAt,
  takeLabelQueue,
} from './priceList';

const rows = [
  ['نشرة الأسعار — وزارة الصحة', null, null],
  ['الباركود', 'الاسم التجاري', 'سعر المستهلك'],
  ['6291003012345', 'بنادول', '١٢٬٥٠٠'],
  [null, 'أموكسيسيلين', 9000],
  ['6291003012352', null, 'غير متوفر'],
  [null, null, 500],
];

describe('reading the sheet', () => {
  it('finds the header row below a title and guesses the columns', () => {
    expect(detectHeaderRow(rows)).toBe(1);
    expect(detectHeaderRow([['a', 'b']])).toBe(0);
    const table = tableAt(rows, 1);
    expect(guessColumns(table.headers)).toEqual({ barcode: 0, name: 1, generic: null, price: 2 });
  });

  it('turns rows into requests with the line the owner sees, and sets aside unusable ones', () => {
    const table = tableAt(rows, 1);
    const out = rowsOf(table, { barcode: 0, name: 1, generic: null, price: 2 }, 0, 1);
    expect(out.rows).toEqual([
      { row: 3, barcode: '6291003012345', name: 'بنادول', generic: null, priceMinor: 12_500 },
      { row: 4, barcode: null, name: 'أموكسيسيلين', generic: null, priceMinor: 9000 },
    ]);
    // A price that is not a number, and a row with nothing to find the piece by
    expect(out.invalid).toEqual([5, 6]);
    // A mapping without a price column sends nothing
    expect(rowsOf(table, NO_COLUMNS, 0, 1).rows).toEqual([]);
  });

  it('needs a price and one way to find the piece', () => {
    expect(columnsReady(NO_COLUMNS)).toBe(false);
    expect(columnsReady({ ...NO_COLUMNS, price: 2 })).toBe(false);
    expect(columnsReady({ ...NO_COLUMNS, price: 2, generic: 1 })).toBe(true);
  });
});

describe('grouping and the label queue', () => {
  afterEach(() => sessionStorage.clear());

  it('groups by what the owner decides on, in file order', () => {
    const item = (row: number, status: PriceListItem['status']): PriceListItem => ({
      row,
      status,
      source: '',
      matchedBy: null,
      productId: null,
      variantId: null,
      name: null,
      currency: null,
      oldMinor: null,
      newMinor: 1,
    });
    const g = group([item(5, 'unmatched'), item(2, 'change'), item(3, 'same'), item(4, 'duplicate')]);
    expect(g.change.map((i) => i.row)).toEqual([2]);
    expect(g.same.map((i) => i.row)).toEqual([3]);
    expect(g.rest.map((i) => i.row)).toEqual([4, 5]);
  });

  it('hands the products to the labels screen once, without repeats', () => {
    expect(queueLabels(['a', 'b', 'a'])).toBe(2);
    expect(takeLabelQueue()).toEqual(['a', 'b']);
    expect(takeLabelQueue()).toEqual([]);
    sessionStorage.setItem('serva.labels.queue', '{"x":1}');
    expect(takeLabelQueue()).toEqual([]);
    sessionStorage.setItem('serva.labels.queue', 'not json');
    expect(takeLabelQueue()).toEqual([]);
  });
});
