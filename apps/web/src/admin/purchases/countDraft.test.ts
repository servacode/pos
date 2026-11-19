import { describe, expect, it } from 'vitest';
import type { CountSheet } from '@serva/core';
import {
  addCount,
  clearSaved,
  countedItems,
  countOf,
  editRowsOf,
  findInSheet,
  linesOf,
  loadSaved,
  newDraft,
  save,
  saveDraftOnly,
  setCount,
  stocktakeOf,
} from './countDraft';

const sheet: CountSheet = {
  branchId: 'br-1',
  categoryId: null,
  at: '2026-11-19T08:00:00.000Z',
  categories: [],
  items: [
    {
      variantId: 'v-milk',
      name: 'حليب',
      categoryId: null,
      allowsFraction: false,
      qty: 10_000,
      barcodes: [
        { code: '6281000000011', packQty: 1000 },
        { code: '6281000000099', packQty: 6000 },
      ],
    },
    { variantId: 'v-rice', name: 'رز', categoryId: null, allowsFraction: true, qty: 5000, barcodes: [] },
    { variantId: 'v-tea', name: 'شاي', categoryId: null, allowsFraction: false, qty: 3000, barcodes: [] },
  ],
};

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
};

describe('the phone count draft', () => {
  it('finds an item by any of its barcodes, a pack counting its pieces, in Arabic digits too', () => {
    expect(findInSheet(sheet, '6281000000011')).toMatchObject({ item: { variantId: 'v-milk' }, add: 1000 });
    expect(findInSheet(sheet, ' ٦٢٨١٠٠٠٠٠٠٠٩٩ ')).toMatchObject({ item: { variantId: 'v-milk' }, add: 6000 });
    expect(findInSheet(sheet, '000')).toBeNull();
    expect(findInSheet(sheet, '')).toBeNull();
  });

  it('adds each scan to what was counted and lets a hand-typed figure replace it', () => {
    let d = newDraft(sheet, 'id-1');
    d = addCount(d, 'v-milk', 1000);
    d = addCount(d, 'v-milk', 6000);
    expect(d.counts).toEqual({ 'v-milk': 7000 });
    d = setCount(d, 'v-milk', 9000);
    expect(d.counts['v-milk']).toBe(9000);
    d = setCount(d, 'v-milk', null);
    expect(d.counts).toEqual({});
    expect(countedItems(d)).toBe(0);
  });

  it('reads a typed figure: whole pieces for a piece item, decimals for a weighed one', () => {
    expect(countOf('12', false)).toBe(12_000);
    expect(countOf('12.5', false)).toBeNull();
    expect(countOf('12.5', true)).toBe(12_500);
    expect(countOf('١٢', false)).toBe(12_000);
    expect(countOf('-1', false)).toBeNull();
  });

  it('a partial count posts only what was counted; «the rest is zero» adds the others', () => {
    let d = addCount(newDraft(sheet, 'id-2'), 'v-milk', 8000);
    const partial = stocktakeOf(d, sheet, '2026-11-19');
    expect(partial).toMatchObject({
      id: 'id-2',
      branchId: 'br-1',
      date: '2026-11-19',
      lines: [{ variantId: 'v-milk', countedQty: 8000 }],
    });
    d = { ...d, restZero: true };
    expect(stocktakeOf(d, sheet, '2026-11-19').lines).toHaveLength(3);
    // Biggest differences first: the milk (−2) is behind the rice (−5)
    expect(linesOf(d, sheet).map((l) => l.item.variantId)).toEqual(['v-rice', 'v-tea', 'v-milk']);
  });

  it('keeps the draft and the sheet on the phone, and survives a full phone or a broken one', () => {
    const store = memory();
    const d = addCount(newDraft(sheet, 'id-3'), 'v-tea', 1000);
    expect(save(d, sheet, store)).toBe(true);
    expect(loadSaved(store)).toEqual({ draft: d, sheet });
    expect(saveDraftOnly({ ...d, queued: true }, store)).toBe(true);
    expect(loadSaved(store)?.draft.queued).toBe(true);
    clearSaved(store);
    expect(loadSaved(store)).toBeNull();
    // No room: it says so, it does not throw
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(save(d, sheet, full)).toBe(false);
    expect(loadSaved(null)).toBeNull();
    store.data.set('serva.count.draft', '{not json');
    expect(loadSaved(store)).toBeNull();
  });
});

describe('the rows on screen keep their place while typing (round 39)', () => {
  it('editing three rows in turn never moves a row, so each count lands on its own product', () => {
    let d = newDraft(sheet, 'id-order');
    d = addCount(d, 'v-tea', 1000);
    d = addCount(d, 'v-milk', 1000);
    d = addCount(d, 'v-rice', 1000);
    const names = (x: typeof d) => editRowsOf(x, sheet).map((r) => r.item.variantId);
    expect(names(d)).toEqual(['v-tea', 'v-milk', 'v-rice']);
    // 10 in the first row, 20 in the second, 30 in the third: the diffs differ so a sort by difference would shuffle
    d = setCount(d, 'v-tea', 10_000);
    expect(names(d)).toEqual(['v-tea', 'v-milk', 'v-rice']);
    d = setCount(d, 'v-milk', 20_000);
    expect(names(d)).toEqual(['v-tea', 'v-milk', 'v-rice']);
    d = setCount(d, 'v-rice', 30_000);
    expect(names(d)).toEqual(['v-tea', 'v-milk', 'v-rice']);
    expect(d.counts).toEqual({ 'v-tea': 10_000, 'v-milk': 20_000, 'v-rice': 30_000 });
    // a further scan of the first item does not move it either, and an old draft with no order still lists its items
    expect(names(addCount(d, 'v-tea', 1000))).toEqual(['v-tea', 'v-milk', 'v-rice']);
    const { order: _o, ...old } = d;
    expect(names(old)).toHaveLength(3);
  });
});
