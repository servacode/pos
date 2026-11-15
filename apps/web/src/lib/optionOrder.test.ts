import { describe, expect, it } from 'vitest';
import { orderValues, sortByOptions } from './optionOrder';

describe('orderValues', () => {
  it('puts letters, then numbers, then the rest by their own list order', () => {
    const out = orderValues('المقاس', ['XL', '44', 'S', 'M', '30', 'L', 'غريب']);
    expect(out.map((o) => o.value)).toEqual(['S', 'M', 'L', 'XL', '30', '44', 'غريب']);
    expect(out[0]?.group).toBe('بالحروف');
    expect(out[4]?.group).toBe('بالأرقام');
    expect(out[6]?.group).toBeNull();
  });

  it('keeps unknown values after the known ones in natural order', () => {
    expect(orderValues('اللون', ['نيلي', 'أبيض', 'نيلي10', 'نيلي2']).map((o) => o.value)).toEqual([
      'أبيض',
      'نيلي',
      'نيلي2',
      'نيلي10',
    ]);
  });
});

describe('numbers', () => {
  it('reads shoe numbers by their number, even those the lists do not know', () => {
    expect(orderValues('النمرة', ['40', '42', '44', '41', '43']).map((o) => o.value)).toEqual([
      '40',
      '41',
      '42',
      '43',
      '44',
    ]);
  });
});

describe('sortByOptions', () => {
  it('keeps each model together even when the rows of two models are mixed', () => {
    const piece = (productId: string, size: string) => ({
      productId,
      attributes: [{ name: 'المقاس', value: size }],
    });
    const rows = [piece('a', '40'), piece('b', '38'), piece('a', '41'), piece('b', '37'), piece('a', '39')];
    expect(sortByOptions(rows).map((r) => `${r.productId}${r.attributes[0]!.value}`)).toEqual([
      'a39',
      'a40',
      'a41',
      'b37',
      'b38',
    ]);
  });

  it('lists the sizes of one model as a shop reads them, and keeps the models in their order', () => {
    const piece = (productId: string, size: string) => ({
      productId,
      attributes: [{ name: 'المقاس', value: size }],
    });
    const rows = [
      piece('a', 'XL'),
      piece('a', 'S'),
      piece('a', 'L'),
      piece('a', 'M'),
      piece('b', '6 سنوات'),
      piece('b', '2 سنة'),
      piece('b', '4 سنوات'),
    ];
    expect(sortByOptions(rows).map((r) => r.attributes[0]!.value)).toEqual([
      'S',
      'M',
      'L',
      'XL',
      '2 سنة',
      '4 سنوات',
      '6 سنوات',
    ]);
  });
});
