import type { SectorKey } from '@serva/core';

/**
 * Which screens and fields each business type uses (هوية 2: a clothing shop sees no expiry dates,
 * weights or IMEI). A store with no business type set sees everything.
 */
export function storeSells(
  storeSectors: readonly SectorKey[] | undefined,
  sectors: readonly SectorKey[],
): boolean {
  if (!storeSectors || storeSectors.length === 0) return true;
  return sectors.some((sector) => storeSectors.includes(sector));
}

/** Stock with expiry dates: the «الصلاحية» screen. */
export const EXPIRY_SECTORS: readonly SectorKey[] = [
  'supermarket',
  'pharmacy',
  'bakery',
  'cosmetics',
  'medical_supplies',
  'produce',
  'wholesale',
  'restaurant',
  'cafe',
  'general',
];

/** Medicines and medical supplies: the prescription, the medicine return policy and the controlled register. */
export const MEDICINAL_SECTORS: readonly SectorKey[] = ['pharmacy', 'medical_supplies'];

/** The hall and the kitchen: tables, a waiter and cancellations after the kitchen. */
export const HALL_SECTORS: readonly SectorKey[] = ['restaurant', 'cafe'];

/** Pieces sold by their serial number or IMEI, with a warranty. */
export const SERIAL_SECTORS: readonly SectorKey[] = [
  'electronics',
  'building_materials',
  'medical_supplies',
  'general',
];

/** Warranty and maintenance claims on serial-tracked pieces. */
export const WARRANTY_SECTORS: readonly SectorKey[] = ['electronics', 'medical_supplies'];

/** Customers who pay with cheques. */
export const CHEQUE_SECTORS: readonly SectorKey[] = [
  'wholesale',
  'building_materials',
  'electronics',
  'supermarket',
  'pharmacy',
  'medical_supplies',
  'general',
];

/** Goods sold by weight («0.250 كغ»). */
export const WEIGHED_SECTORS: readonly SectorKey[] = [
  'supermarket',
  'produce',
  'bakery',
  'restaurant',
  'cafe',
  'building_materials',
  'wholesale',
  'general',
];

/** Items with choices and extras for the kitchen. */
export const MODIFIER_SECTORS: readonly SectorKey[] = ['restaurant', 'cafe', 'bakery'];

/** Example category names for an empty categories page, by business type. */
const CATEGORY_EXAMPLES: Record<SectorKey, readonly string[]> = {
  clothing: ['قمصان', 'بناطيل', 'أحذية رجالي', 'أحذية نسائي', 'إكسسوارات'],
  supermarket: ['ألبان وأجبان', 'منظفات', 'معلبات', 'مشروبات'],
  restaurant: ['مقبلات', 'أطباق رئيسية', 'مشروبات', 'حلويات'],
  cafe: ['قهوة', 'شاي', 'عصائر', 'حلويات'],
  pharmacy: ['مسكنات', 'مضادات حيوية', 'فيتامينات', 'عناية بالطفل'],
  electronics: ['جوالات', 'إكسسوارات جوال', 'سماعات', 'شواحن'],
  bakery: ['خبز', 'معجنات', 'حلويات شرقية', 'كعك'],
  building_materials: ['أدوات كهربائية', 'دهانات', 'أنابيب', 'عدد يدوية'],
  cosmetics: ['عطور', 'مكياج', 'عناية بالبشرة', 'عناية بالشعر'],
  medical_supplies: ['مستهلكات', 'أجهزة قياس', 'كراسي متحركة', 'ضمادات'],
  produce: ['خضار', 'فواكه', 'ورقيات', 'أعشاب'],
  wholesale: ['مواد غذائية', 'منظفات', 'ورقيات', 'مشروبات'],
  general: ['ألبان وأجبان', 'منظفات', 'قرطاسية', 'أدوات منزلية'],
};

/** Up to four example category names for the store's business types; a few for each type it sells. */
export function categoryExamples(storeSectors: readonly SectorKey[] | undefined): string[] {
  const keys = storeSectors && storeSectors.length > 0 ? storeSectors : (['general'] as SectorKey[]);
  const per = keys.length === 1 ? 5 : 3;
  return [...new Set(keys.flatMap((k) => CATEGORY_EXAMPLES[k].slice(0, per)))];
}
