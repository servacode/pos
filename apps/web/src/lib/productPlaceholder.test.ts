import { describe, expect, it } from 'vitest';
import {
  AccessoryIcon,
  HeartPulseIcon,
  KeyIcon,
  PerfumeIcon,
  ProductsIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoeIcon,
  WheelchairIcon,
  WrenchIcon,
} from '@serva/ui';
import { placeholderIconFor } from './productPlaceholder';

describe('placeholderIconFor', () => {
  it('draws what the item is, not the shop it sits in', () => {
    const clothing = ['clothing'];
    expect(placeholderIconFor({ name: 'حذاء رياضي', sectors: clothing })).toBe(ShoeIcon);
    expect(placeholderIconFor({ name: 'جوارب قطن', sectors: clothing })).toBe(ShoeIcon);
    expect(placeholderIconFor({ name: 'بنطال جينز', sectors: clothing })).toBe(ShirtIcon);
    expect(placeholderIconFor({ categoryName: 'إكسسوارات', name: 'x', sectors: clothing })).toBe(
      AccessoryIcon,
    );
    expect(placeholderIconFor({ name: 'عطر ورد', sectors: clothing })).toBe(PerfumeIcon);
    expect(placeholderIconFor({ name: 'قطعة', sectors: clothing })).toBe(ShirtIcon);
  });

  it('draws medical devices and wheelchairs for the medical store', () => {
    expect(placeholderIconFor({ name: 'جهاز ضغط', sectors: ['medical_supplies'] })).toBe(HeartPulseIcon);
    expect(placeholderIconFor({ name: 'كرسي متحرك', sectors: ['medical_supplies'] })).toBe(WheelchairIcon);
  });

  it('gives a service its own icon in any store', () => {
    expect(placeholderIconFor({ name: 'إيجار كرسي', isService: true, sectors: ['medical_supplies'] })).toBe(
      KeyIcon,
    );
    expect(placeholderIconFor({ name: 'عقد صيانة', isService: true, sectors: ['medical_supplies'] })).toBe(
      WrenchIcon,
    );
    expect(placeholderIconFor({ name: 'تقصير', isService: true, sectors: ['clothing'] })).toBe(ScissorsIcon);
    expect(placeholderIconFor({ name: 'خدمة', isService: true, sectors: ['clothing'] })).toBe(ScissorsIcon);
    expect(placeholderIconFor({ name: 'خدمة', isService: true, sectors: [] })).toBe(WrenchIcon);
  });

  it('falls back to a box', () => {
    expect(placeholderIconFor({ name: 'شيء', sectors: [] })).toBe(ProductsIcon);
  });
});
