import {
  AccessoryIcon,
  BakeryIcon,
  BuildingMaterialsIcon,
  CafeIcon,
  HeartPulseIcon,
  KeyIcon,
  MedicalSuppliesIcon,
  PerfumeIcon,
  PharmacyIcon,
  ProduceIcon,
  ProductsIcon,
  RestaurantIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoeIcon,
  SupermarketIcon,
  SyringeIcon,
  WheelchairIcon,
  WholesaleIcon,
  WrenchIcon,
  type Icon,
} from '@serva/ui';

/** Words of a category (or of the item itself) that tell what kind of thing it is, first match wins */
const BY_WORD: readonly (readonly [RegExp, Icon])[] = [
  [/كرسي متحرك|كراسي متحركة|عكاز|مشاية/, WheelchairIcon],
  [/حقنة|حقن|سرنجة|محقن/, SyringeIcon],
  [/جهاز|أجهزة|سماعة طبية|ضغط|سكري|قياس|ميزان حرارة/, HeartPulseIcon],
  [/حذاء|أحذية|صندل|جزمة|بوت|نعل|جوارب|كلسات|شحاطة/, ShoeIcon],
  [/عطر|عطور|كولونيا|بخاخ/, PerfumeIcon],
  [/إكسسوار|اكسسوار|مجوهرات|ساعة|حزام|حقيبة|نظارة|خاتم|سوار|قلادة/, AccessoryIcon],
  [/ملابس|قميص|بنطال|جينز|جاكيت|فستان|تيشرت|بلوزة|عباية|تنورة|معطف|بيجاما/, ShirtIcon],
  [/دواء|أدوية|صيدلية|شراب|حبوب|مضاد|فيتامين/, PharmacyIcon],
  [/كمامة|قفاز|ضماد|مستلزمات طبية|قطن|شاش|معقم/, MedicalSuppliesIcon],
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
  /** A service (rental, maintenance, tailoring) has no goods to draw: its own kind of icon */
  isService?: boolean;
}): Icon {
  if (opts.isService) {
    for (const text of [opts.name, opts.categoryName]) {
      if (!text) continue;
      if (/إيجار|تأجير|ايجار|كراء/.test(text)) return KeyIcon;
      if (/صيانة|تصليح|إصلاح|عقد/.test(text)) return WrenchIcon;
      if (/تقصير|خياطة|تفصيل|تضييق|تعديل/.test(text)) return ScissorsIcon;
    }
    // Tailoring belongs to the clothing shop; every other service is work done for the customer
    return (opts.sectors ?? []).includes('clothing') ? ScissorsIcon : WrenchIcon;
  }
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
