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

describe('sortByOptions', () => {
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
