import {
  BakeryIcon,
  BuildingMaterialsIcon,
  CafeIcon,
  MedicalSuppliesIcon,
  PharmacyIcon,
  ProduceIcon,
  ProductsIcon,
  RestaurantIcon,
  ShirtIcon,
  SupermarketIcon,
  WholesaleIcon,
  type Icon,
} from '@serva/ui';

/** Words of a category (or of the item itself) that tell what kind of thing it is, first match wins */
const BY_WORD: readonly (readonly [RegExp, Icon])[] = [
  [/ملابس|قميص|بنطال|جاكيت|فستان|حذاء|أحذية|تيشرت|بلوزة|عباية/, ShirtIcon],
  [/دواء|أدوية|صيدلية|شراب|حبوب|مضاد|فيتامين/, PharmacyIcon],
  [/كمامة|قفاز|ضماد|مستلزمات طبية|حقنة|جهاز طبي/, MedicalSuppliesIcon],
  [/خبز|معجنات|حلويات|كعك|كيك/, BakeryIcon],
  [/خضار|فواكه|فاكهة|بندورة|تفاح/, ProduceIcon],
  [/قهوة|مشروب|عصير|شاي|مياه/, CafeIcon],
  [/وجبة|مطعم|ساندويش|شاورما|بيتزا/, RestaurantIcon],
  [/إسمنت|حديد|دهان|بلاط|أدوات بناء|بناء/, BuildingMaterialsIcon],
  [/مواد غذائية|معلبات|ألبان|زيت|سكر|أرز/, SupermarketIcon],
];

/** The store's business type when nothing else says what the item is */
const BY_SECTOR: Readonly<Record<string, Icon>> = {
  clothing: ShirtIcon,
  pharmacy: PharmacyIcon,
  medical_supplies: MedicalSuppliesIcon,
  bakery: BakeryIcon,
  produce: ProduceIcon,
  cafe: CafeIcon,
  restaurant: RestaurantIcon,
  building_materials: BuildingMaterialsIcon,
  supermarket: SupermarketIcon,
  wholesale: WholesaleIcon,
};

/**
 * The icon of an item that has no photo: by its category's (or its own) name, else by the store's
 * business type, else a plain box. One place, so the list, the shop and the till agree.
 */
export function placeholderIconFor(opts: {
  categoryName?: string | null;
  name?: string | null;
  sectors?: readonly string[];
}): Icon {
  for (const text of [opts.categoryName, opts.name]) {
    if (!text) continue;
    const hit = BY_WORD.find(([word]) => word.test(text));
    if (hit) return hit[1];
  }
  for (const sector of opts.sectors ?? []) {
    const icon = BY_SECTOR[sector];
    if (icon) return icon;
  }
  return ProductsIcon;
}
