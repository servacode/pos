import { describe, expect, it } from 'vitest';
import { lowestSentence, shortKinds, soldOutLabel, soldOutSentence } from './stockWords';

describe('the sold-out sentence', () => {
  it('says sizes and colours in a clothing store, with the products they belong to', () => {
    expect(soldOutSentence(12, 4, true)).toBe('12 مقاساً/لوناً نفد من 4 منتجات');
    expect(soldOutSentence(1, 1, true)).toBe('مقاس/لون واحد نفد من منتج واحد');
    expect(soldOutSentence(2, 2, true)).toBe('مقاسان/لونان نفد من منتجين');
    expect(soldOutSentence(5, undefined, true)).toBe('5 مقاسات/ألوان نفد');
  });

  it('says «أصناف» elsewhere and nothing when nothing is out', () => {
    expect(soldOutSentence(3, 3, false)).toBe('3 أصناف نفد');
    expect(soldOutSentence(0, 0, true)).toBe('');
  });

  it('reads the least stocked product as a word at zero', () => {
    expect(lowestSentence('جوارب قطن', '0', 0)).toBe('أقلّها: جوارب قطن — نفد');
    expect(lowestSentence('جوارب قطن', '3', 3000)).toBe('أقلّها: جوارب قطن — بقي 3');
  });
});

describe('one stock vocabulary', () => {
  it('says what the ran-out tile counts, and the shortage in sizes and colours for clothing', () => {
    expect(soldOutLabel(true)).toBe('نفد من المقاسات/الألوان');
    expect(soldOutLabel(false)).toBe('نفد من الأصناف');
    expect(shortKinds(4, true)).toBe('4 مقاسات/ألوان ناقصة');
    expect(shortKinds(1, true)).toBe('مقاس/لون واحد ناقص');
    expect(shortKinds(2, true)).toBe('مقاسان/لونان ناقصان');
    expect(shortKinds(4)).toBe('4 أصناف ناقصة');
  });
});
