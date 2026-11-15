import { describe, expect, it } from 'vitest';
import {
  AccessoryIcon,
  BagIcon,
  BandageIcon,
  DropIcon,
  GloveIcon,
  ThermometerIcon,
  TubeIcon,
  KidsIcon,
  SleepIcon,
  WinterIcon,
  HeartPulseIcon,
  KeyIcon,
  PerfumeIcon,
  ProductsIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoeIcon,
  SockIcon,
  TrousersIcon,
  SkirtIcon,
  DressIcon,
  MaskIcon,
  RobeIcon,
  TopIcon,
  BeltIcon,
  ScarfIcon,
  CoatIcon,
  WheelchairIcon,
  WrenchIcon,
} from '@serva/ui';
import { placeholderIconFor } from './productPlaceholder';

describe('placeholderIconFor', () => {
  it('draws what the item is, not the shop it sits in', () => {
    const clothing = ['clothing'];
    expect(placeholderIconFor({ name: 'حذاء رياضي', sectors: clothing })).toBe(ShoeIcon);
    expect(placeholderIconFor({ name: 'جوارب قطن', sectors: clothing })).toBe(SockIcon);
    expect(placeholderIconFor({ name: 'بنطال جينز', sectors: clothing })).toBe(TrousersIcon);
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

  it('never draws a medical icon in a clothing shop: cotton is a fabric', () => {
    const clothing = ['clothing'];
    expect(placeholderIconFor({ name: 'تيشيرت قطن رجالي', sectors: clothing })).toBe(ShirtIcon);
    expect(
      placeholderIconFor({ name: 'تيشيرت قطن رجالي', categoryName: 'مستهلكات', sectors: clothing }),
    ).toBe(ShirtIcon);
    expect(placeholderIconFor({ name: 'جوارب قطن', sectors: clothing })).toBe(SockIcon);
    expect(placeholderIconFor({ name: 'جهاز', sectors: clothing })).toBe(ShirtIcon);
  });

  it('tells garments apart where the icon set allows', () => {
    const clothing = ['clothing'];
    expect(placeholderIconFor({ name: 'جاكيت شتوي', sectors: clothing })).toBe(CoatIcon);
    expect(placeholderIconFor({ name: 'كنزة شتوية', sectors: clothing })).toBe(WinterIcon);
    expect(placeholderIconFor({ name: 'حزام جلد', sectors: clothing })).toBe(BeltIcon);
    expect(placeholderIconFor({ name: 'وشاح حرير', sectors: clothing })).toBe(ScarfIcon);
    expect(placeholderIconFor({ name: 'فستان سهرة', sectors: clothing })).toBe(DressIcon);
    // An abaya is a robe, not a dress; water and solutions are a droplet; a mask is its own glyph
    expect(placeholderIconFor({ name: 'عباية سوداء', sectors: clothing })).toBe(RobeIcon);
    expect(placeholderIconFor({ name: 'ماء معقم', sectors: ['medical_supplies'] })).toBe(DropIcon);
    expect(placeholderIconFor({ name: 'كمامة جراحية', sectors: ['medical_supplies'] })).toBe(MaskIcon);
    expect(placeholderIconFor({ name: 'بلوزة قطن', sectors: clothing })).toBe(TopIcon);
    expect(placeholderIconFor({ name: 'بيجاما أطفال', sectors: clothing })).toBe(SleepIcon);
    expect(placeholderIconFor({ name: 'حقيبة يد', sectors: clothing })).toBe(BagIcon);
    expect(placeholderIconFor({ name: 'تنورة طويلة', sectors: clothing })).toBe(SkirtIcon);
    expect(placeholderIconFor({ name: 'سروال', sectors: clothing })).toBe(TrousersIcon);
    expect(placeholderIconFor({ name: 'لعبة', categoryName: 'ملابس أطفال', sectors: clothing })).toBe(
      ShirtIcon,
    );
    expect(placeholderIconFor({ name: 'طقم مواليد', sectors: clothing })).toBe(KidsIcon);
  });

  it('tells medical supplies apart by kind (the till tiles), the stethoscope only as the generic fallback', () => {
    const medical = ['medical_supplies'];
    expect(placeholderIconFor({ name: 'قفازات طبية', sectors: medical })).toBe(GloveIcon);
    expect(placeholderIconFor({ name: 'شاش معقم', sectors: medical })).toBe(BandageIcon);
    expect(placeholderIconFor({ name: 'ضماد لاصق', sectors: medical })).toBe(BandageIcon);
    expect(placeholderIconFor({ name: 'سيروم ملحي 500', sectors: medical })).toBe(DropIcon);
    expect(placeholderIconFor({ name: 'قسطرة بولية', sectors: medical })).toBe(TubeIcon);
    expect(placeholderIconFor({ name: 'محرار رقمي', sectors: medical })).toBe(ThermometerIcon);
    expect(placeholderIconFor({ name: 'كمامة', sectors: medical })).toBe(MaskIcon);
  });

  it('keeps cotton wool and the medical words for a medical store', () => {
    expect(placeholderIconFor({ name: 'قطن طبي', sectors: ['medical_supplies'] })).not.toBe(ShirtIcon);
    expect(placeholderIconFor({ name: 'سرنغات 5 مل', sectors: ['medical_supplies'] })).not.toBe(ProductsIcon);
  });

  it('falls back to a box', () => {
    expect(placeholderIconFor({ name: 'شيء', sectors: [] })).toBe(ProductsIcon);
  });
});
