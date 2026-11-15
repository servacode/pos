import {
  AccessoryIcon,
  BagIcon,
  BakeryIcon,
  BandageIcon,
  BeltIcon,
  BuildingMaterialsIcon,
  CafeIcon,
  CoatIcon,
  DressIcon,
  DropIcon,
  GlassesIcon,
  GloveIcon,
  HeartPulseIcon,
  KidsIcon,
  KeyIcon,
  MedicalSuppliesIcon,
  PerfumeIcon,
  PharmacyIcon,
  ProduceIcon,
  ProductsIcon,
  RestaurantIcon,
  ScarfIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoeIcon,
  SkirtIcon,
  SleepIcon,
  SockIcon,
  SupermarketIcon,
  TopIcon,
  TrousersIcon,
  SyringeIcon,
  ThermometerIcon,
  TubeIcon,
  WheelchairIcon,
  WatchIcon,
  WholesaleIcon,
  WinterIcon,
  WrenchIcon,
  type Icon,
} from '@serva/ui';

type Rule = readonly [RegExp, Icon];

/** What a garment or accessory is (clothing shops, and any shop that sells clothes): first match wins */
const CLOTHING_WORDS: readonly Rule[] = [
  [/جوارب|جورب|كلسات/, SockIcon],
  [/حذاء|أحذية|صندل|جزمة|بوت|نعل|شحاطة|سكربين|كوتشي|سنيكرز/, ShoeIcon],
  [/حقيبة|حقائب|شنطة|شنط|محفظة|جزدان/, BagIcon],
  [/نظارة|نظارات/, GlassesIcon],
  [/ساعة|ساعات/, WatchIcon],
  [/عطر|عطور|كولونيا|بخاخ/, PerfumeIcon],
  [/حزام|أحزمة|احزمة|زنار/, BeltIcon],
  [/وشاح|شال|ايشارب|إيشارب|كوفية|طرحة|حجاب/, ScarfIcon],
  [/إكسسوار|اكسسوار|مجوهرات|خاتم|سوار|قلادة|قبعة|ربطة عنق/, AccessoryIcon],
  [/بيجاما|منامة|قميص نوم|بيجامة/, SleepIcon],
  [/جاكيت|جاكت|معطف|بالطو|سترة/, CoatIcon],
  [/بنطال|بنطلون|سروال|جينز|ترينج|شورت|بنطلونات/, TrousersIcon],
  [/تنورة|جيبة|تنانير/, SkirtIcon],
  [/فستان|فساتين|عباية|عبايات|جلابية|قفطان|ثوب/, DressIcon],
  [/بلوزة|بلوزات|بلوز|توب|كاميسول/, TopIcon],
  [/كنزة|بلوفر|صوف|شتوي|شتوية/, WinterIcon],
  [/ملابس|قميص|قمصان|تيشرت|تيشيرت|بدلة|هودي|لباس/, ShirtIcon],
  [/أطفال|اطفال|طفل|رضع|مواليد|بيبي/, KidsIcon],
];

/** Medical and pharmacy words: only where the shop sells them («قطن» alone is a fabric, not cotton wool) */
const MEDICAL_WORDS: readonly Rule[] = [
  [/كرسي متحرك|كراسي متحركة|عكاز|مشاية/, WheelchairIcon],
  [/حقنة|حقن|سرنجة|سرنغات|سرنجات|محقن/, SyringeIcon],
  [/قفاز|قفازات|كفوف|كفّ/, GloveIcon],
  [/ضماد|ضمادات|شاش|لاصق|رباط|جبيرة/, BandageIcon],
  [/سيروم|محلول|محاليل|وريدي|كيس سيروم/, DropIcon],
  [/قسطرة|قساطر|أنبوب|أنابيب|خرطوم|مصل/, TubeIcon],
  [/محرار|ميزان حرارة|ترمومتر/, ThermometerIcon],
  [/جهاز|أجهزة|سماعة طبية|ضغط|سكري|قياس/, HeartPulseIcon],
  [/دواء|أدوية|صيدلية|شراب|حبوب|مضاد|فيتامين/, PharmacyIcon],
  [/كمامة|كمامات|مستلزمات طبية|قطن طبي|معقم/, MedicalSuppliesIcon],
];

/** Everything else a shop can sell */
const GENERAL_WORDS: readonly Rule[] = [
  [/خبز|معجنات|حلويات|كعك|كيك/, BakeryIcon],
  [/خضار|فواكه|فاكهة|بندورة|تفاح/, ProduceIcon],
  [/قهوة|مشروب|عصير|شاي|مياه/, CafeIcon],
  [/وجبة|مطعم|ساندويش|شاورما|بيتزا/, RestaurantIcon],
  [/إسمنت|حديد|دهان|بلاط|أدوات بناء|بناء/, BuildingMaterialsIcon],
  [/مواد غذائية|معلبات|ألبان|زيت|سكر|أرز/, SupermarketIcon],
];

const MEDICAL_SECTORS = ['pharmacy', 'medical_supplies'];

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
  // Sector first: a clothing shop never draws medical things («قطن» there is a fabric); a medical or
  // pharmacy shop reads its own words first. Then the item's own name, before its category's.
  const sectors = opts.sectors ?? [];
  const medicalShop = sectors.some((s) => MEDICAL_SECTORS.includes(s));
  const clothingShop = sectors.includes('clothing');
  const maps: readonly (readonly Rule[])[] = medicalShop
    ? [MEDICAL_WORDS, CLOTHING_WORDS, GENERAL_WORDS]
    : clothingShop
      ? [CLOTHING_WORDS, GENERAL_WORDS]
      : [CLOTHING_WORDS, MEDICAL_WORDS, GENERAL_WORDS];
  for (const text of [opts.name, opts.categoryName]) {
    if (!text) continue;
    for (const map of maps) {
      const hit = map.find(([word]) => word.test(text));
      if (hit) return hit[1];
    }
  }
  for (const sector of sectors) {
    const icon = BY_SECTOR[sector];
    if (icon) return icon;
  }
  return ProductsIcon;
}
