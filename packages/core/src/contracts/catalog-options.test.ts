import { describe, expect, it } from 'vitest';
import {
  catalogOptionsOf,
  catalogOptionsSchema,
  DEFAULT_CATALOG_OPTIONS,
  sizeRunSchema,
} from './catalog-options';

describe('catalog options', () => {
  it('starts with no barcodes made for new variants and two ready size runs', () => {
    expect(catalogOptionsOf(null)).toEqual(DEFAULT_CATALOG_OPTIONS);
    expect(catalogOptionsOf(undefined).autoBarcode).toBe(false);
    expect(catalogOptionsOf(null).sizeRuns[0]).toEqual({ name: 'طقم 1-2-2-1', counts: [1, 2, 2, 1] });
  });

  it('keeps what the store chose, a part at a time', () => {
    expect(catalogOptionsOf({ autoBarcode: true })).toEqual({
      autoBarcode: true,
      sizeRuns: DEFAULT_CATALOG_OPTIONS.sizeRuns,
    });
    expect(catalogOptionsOf({ sizeRuns: [] })).toEqual({ autoBarcode: false, sizeRuns: [] });
  });

  it('refuses a run with no pieces, a long name and too many runs, in Arabic', () => {
    expect(sizeRunSchema.safeParse({ name: 'فارغ', counts: [0, 0] }).error?.issues[0]?.message).toBe(
      'اكتب عدد قطعة واحدة على الأقل',
    );
    expect(sizeRunSchema.safeParse({ name: ' ', counts: [1] }).success).toBe(false);
    expect(sizeRunSchema.safeParse({ name: 'x'.repeat(31), counts: [1] }).success).toBe(false);
    expect(sizeRunSchema.safeParse({ name: 'طقم', counts: [100] }).success).toBe(false);
    const run = { name: 'طقم', counts: [1] };
    expect(
      catalogOptionsSchema.safeParse({ autoBarcode: false, sizeRuns: Array(11).fill(run) }).success,
    ).toBe(false);
    expect(catalogOptionsSchema.safeParse({ autoBarcode: false, sizeRuns: [run] }).success).toBe(true);
  });
});
