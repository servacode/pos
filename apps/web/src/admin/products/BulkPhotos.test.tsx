import { describe, expect, it } from 'vitest';
import { photoKey } from './BulkPhotos';
import { matrixFits } from './PriceMatrix';
import { serialSwitchLabel, serialWord } from '../../lib/sectors';

describe('photoKey', () => {
  it('reads a product name from the file name', () => {
    expect(photoKey('قميص أزرق.jpg')).toEqual({ code: null, name: 'قميص أزرق' });
    expect(photoKey('قميص_أزرق (2).PNG')).toEqual({ code: null, name: 'قميص أزرق' });
  });

  it('reads a barcode when the name is only digits', () => {
    expect(photoKey('6281007035105.jpeg')).toEqual({ code: '6281007035105', name: '6281007035105' });
    expect(photoKey('12.jpg').code).toBeNull();
  });
});

describe('matrixFits', () => {
  const variant = (key: string, currency: 'SYP' | 'USD' = 'SYP', archived = false) =>
    ({ key, currency, archived, attributes: [], barcodes: [] }) as never;
  const axes = [{ key: 'a', name: 'المقاس', values: ['S', 'M'] }];
  it('needs two or more live variants in one currency and values on every option', () => {
    expect(matrixFits(axes, [variant('1'), variant('2')])).toBe(true);
    expect(matrixFits(axes, [variant('1'), variant('2', 'USD')])).toBe(false);
    expect(matrixFits(axes, [variant('1'), variant('2', 'SYP', true)])).toBe(false);
    expect(matrixFits([{ key: 'a', name: 'المقاس', values: [] }], [variant('1'), variant('2')])).toBe(false);
    expect(matrixFits([], [variant('1'), variant('2')])).toBe(false);
  });
});

describe('serial wording', () => {
  it('says IMEI only to a store that sells phones, or has no type set', () => {
    expect(serialWord(['medical_supplies'])).toBe('الرقم التسلسلي');
    expect(serialWord(['electronics'])).toBe('الرقم التسلسلي أو IMEI');
    expect(serialWord([])).toBe('الرقم التسلسلي أو IMEI');
    expect(serialSwitchLabel(['medical_supplies'])).toBe('له رقم تسلسلي');
  });
});
