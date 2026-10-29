/** Business types a store can enable. A store may enable more than one (e.g. a mall with a café). */
export const SECTORS = [
  { key: 'clothing', labelAr: 'ألبسة وأحذية' },
  { key: 'supermarket', labelAr: 'سوبرماركت ومولات' },
  { key: 'restaurant', labelAr: 'مطعم' },
  { key: 'cafe', labelAr: 'مقهى وكافتيريا' },
  { key: 'pharmacy', labelAr: 'صيدلية' },
  { key: 'electronics', labelAr: 'إلكترونيات وجوالات' },
  { key: 'bakery', labelAr: 'مخبز وحلويات' },
  { key: 'building_materials', labelAr: 'مواد بناء وأدوات' },
  { key: 'cosmetics', labelAr: 'تجميل وعطور' },
  { key: 'produce', labelAr: 'خضار وفواكه' },
  { key: 'wholesale', labelAr: 'جملة وتوزيع' },
  { key: 'general', labelAr: 'متجر عام' },
] as const;

export type SectorKey = (typeof SECTORS)[number]['key'];

export const SECTOR_KEYS = SECTORS.map((s) => s.key) as [SectorKey, ...SectorKey[]];

export function sectorLabel(key: SectorKey): string {
  return SECTORS.find((s) => s.key === key)?.labelAr ?? key;
}
