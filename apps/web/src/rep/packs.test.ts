import { describe, expect, it } from 'vitest';
import { cartonText, packsOf } from './packs';

const pack = { packQty: 12_000, name: 'كرتونة' };

describe('cartons and pieces', () => {
  it('says cartons and the pieces left', () => {
    expect(cartonText(30_000, pack)).toBe('2 كرتونة + 6 قطعة');
    expect(cartonText(24_000, pack)).toBe('2 كرتونة');
  });
  it('says nothing under one carton, without a pack or for a weighed quantity', () => {
    expect(cartonText(11_000, pack)).toBeNull();
    expect(cartonText(30_000, undefined)).toBeNull();
    expect(cartonText(30_500, pack)).toBeNull();
  });
  it('takes the biggest pack of each variant and names it «كرتونة» unless the product did', () => {
    const barcode = (variantId: string, packQty: number, packName: string | null) => ({
      item: { variantId } as never,
      barcode: { packQty, packName } as never,
    });
    const map = new Map([
      ['a', barcode('v1', 1000, null)],
      ['b', barcode('v1', 12_000, 'عبوة')],
      ['c', barcode('v1', 24_000, 'صندوق')],
      ['d', barcode('v2', 6000, 'عبوة')],
    ]);
    const packs = packsOf({ byBarcode: map });
    expect(packs.get('v1')).toEqual({ packQty: 24_000, name: 'صندوق' });
    expect(packs.get('v2')).toEqual({ packQty: 6000, name: 'كرتونة' });
  });
});
