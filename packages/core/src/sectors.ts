/**
 * Business types («الأنشطة») and the feature switches the setup wizard suggests for them (03 › كيف
 * تعمل الأوضاع; 04 › الميزات; 13 › الأنشطة). A store may enable more than one sector (a mall with a
 * café). Features are switches, not separate products: everything is in the app, the wizard
 * suggests and the owner decides; switching a feature or a sector off only hides screens, it never
 * deletes data (04, 23 › 1).
 *
 * 13 puts sectors, their suggested features and demo items in the platform panel; until that
 * editor exists (17: `/v1/platform/sectors`, phase 5) this file is the catalogue, and
 * `GET /v1/catalog/sectors` serves it unchanged (contracts/onboarding.ts).
 */

/** The seven families of 03: tests, launch shops and phase 4 are organised by them. */
export const SECTOR_FAMILIES = [
  'clothing',
  'retail',
  'restaurants',
  'cafes',
  'pharmacy',
  'electronics',
  'wholesale',
] as const;
export type SectorFamily = (typeof SECTOR_FAMILIES)[number];

/**
 * Feature switches (04 › الميزات), in the order of 04's table. The basics in CORE_FEATURES are
 * always on and are not switches.
 */
export const FEATURES = {
  variants: { labelAr: 'المقاسات والألوان', descriptionAr: 'منتج واحد بكل مقاساته وألوانه، ومخزون لكل منها' },
  quick_exchange: { labelAr: 'الاستبدال السريع', descriptionAr: 'قطعة ترجع وقطعة تطلع بفاتورة واحدة' },
  seasons: { labelAr: 'المواسم والمجموعات', descriptionAr: 'صيف، شتاء، عيد، وتخفيضات آخر الموسم' },
  sales_commissions: { labelAr: 'عمولات البائعين', descriptionAr: 'نسبة كل بائع من مبيعاته' },
  weighed_items: {
    labelAr: 'البيع بالوزن وباركود الميزان',
    descriptionAr: 'قراءة الوزن أو السعر من ملصق الميزان',
  },
  departments: { labelAr: 'الأقسام', descriptionAr: 'تقارير وهامش ربح لكل قسم' },
  batches_expiry: { labelAr: 'الصلاحية والدفعات', descriptionAr: 'تاريخ انتهاء لكل دفعة وتنبيه قبله' },
  serials_warranty: {
    labelAr: 'الأرقام التسلسلية والكفالة',
    descriptionAr: 'رقم أو IMEI لكل قطعة، وتاريخ انتهاء الكفالة',
  },
  multi_units: { labelAr: 'الوحدات المتعددة', descriptionAr: 'قطعة، علبة، كرتونة، متر، بأسعار مختلفة' },
  tables: { labelAr: 'الطاولات والصالة', descriptionAr: 'خريطة الصالة وحالة كل طاولة' },
  kitchen_printing: {
    labelAr: 'المطبخ وطباعة الطلبات',
    descriptionAr: 'كل صنف يذهب لقسمه على طابعته أو شاشته',
  },
  modifiers: { labelAr: 'الإضافات والخيارات', descriptionAr: 'حجم، سكر، «بدون بصل»، وزيادات بسعرها' },
  recipes: { labelAr: 'الوصفات وتكلفة الطبق', descriptionAr: 'البيع يُنقص المكوّنات من المخزون' },
  delivery: { labelAr: 'السفري والتوصيل', descriptionAr: 'عنوان الزبون والسائق ورسم التوصيل' },
  order_numbers: { labelAr: 'رقم الطلب والنداء', descriptionAr: 'رقم كبير على الإيصال وشاشة «جاهز»' },
  timed_pricing: { labelAr: 'التسعير بالوقت', descriptionAr: 'عداد يبدأ عند فتح الطاولة (أراجيل، ألعاب)' },
  credit_sales: { labelAr: 'البيع بالآجل', descriptionAr: 'ديون الزبائن ومواعيد السداد والتذكير' },
  cheques: { labelAr: 'الشيكات', descriptionAr: 'شيكات واردة وصادرة بتواريخ استحقاق' },
  wholesale_tiers: { labelAr: 'أسعار الجملة والشرائح', descriptionAr: 'سعر حسب الزبون أو الكمية' },
  advanced_promotions: {
    labelAr: 'العروض المتقدمة',
    descriptionAr: '«اشترِ 2 والثالث مجاناً»، حزم، أسعار ساعات',
  },
  loyalty: { labelAr: 'نقاط الولاء', descriptionAr: 'نقاط للزبون برقم جواله' },
  customer_display: { labelAr: 'شاشة الزبون', descriptionAr: 'شاشة ثانية تعرض السلة والمجموع' },
  multi_branch: {
    labelAr: 'تعدد الفروع والتحويل',
    descriptionAr: 'مخزون لكل فرع ونقل بضاعة بينها',
  },
} as const satisfies Record<string, { labelAr: string; descriptionAr: string }>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as [FeatureKey, ...FeatureKey[]];

/** Always on, never a switch (04): selling, products, stock, customers, reports, pounds and dollars. */
export const CORE_FEATURES = [
  { key: 'sales', labelAr: 'البيع' },
  { key: 'products', labelAr: 'المنتجات' },
  { key: 'inventory', labelAr: 'المخزون' },
  { key: 'customers', labelAr: 'الزبائن' },
  { key: 'reports', labelAr: 'التقارير' },
  { key: 'currencies', labelAr: 'الليرة والدولار' },
] as const;

/** «ست ميزات تناسب نشاطه مفعّلة مسبقاً» (04, 12): the wizard pre-enables at most this many. */
export const SUGGESTED_FEATURES_MAX = 6;

/** A restaurant answers one extra question (04): a hall with tables, or quick takeaway. */
export const RESTAURANT_MODES = ['dine_in', 'quick'] as const;
export type RestaurantMode = (typeof RESTAURANT_MODES)[number];

/** A sample item of a sector, marked «تجريبي», for the trial sale and the optional demo data (04). */
export interface DemoItem {
  key: string;
  nameAr: string;
  categoryAr: string;
  unitAr: string;
  /** Shelf price in new Syrian pounds, minor units (90 ل.س = 9000) */
  priceMinor: number;
}

interface SectorDefinition {
  key: string;
  labelAr: string;
  family: SectorFamily;
  /** Icon name in the UI icon set; the platform panel will manage it (13) */
  icon: string;
  /** Most fitting first; the wizard takes from the first chosen sector first (see suggestFeatures) */
  suggestedFeatures: readonly FeatureKey[];
  /**
   * 07 › الفوترة الإلكترونية: the app is not yet certified for e-invoicing; these sectors see a
   * plain notice at sign-up and must acknowledge it before going on.
   */
  needsTaxNotice: boolean;
  demoItems: readonly DemoItem[];
}

const item = (key: string, nameAr: string, categoryAr: string, unitAr: string, pounds: number): DemoItem => ({
  key,
  nameAr,
  categoryAr,
  unitAr,
  priceMinor: pounds * 100,
});

export const SECTORS = [
  {
    key: 'clothing',
    labelAr: 'ألبسة وأحذية',
    family: 'clothing',
    icon: 'shirt',
    suggestedFeatures: ['variants', 'quick_exchange', 'sales_commissions', 'seasons', 'advanced_promotions'],
    needsTaxNotice: false,
    demoItems: [
      item('shirt-m-blue', 'قميص قطني · M · أزرق', 'رجالي', 'قطعة', 450),
      item('shirt-l-blue', 'قميص قطني · L · أزرق', 'رجالي', 'قطعة', 450),
      item('dress-s-red', 'فستان صيفي · S · أحمر', 'نسائي', 'قطعة', 780),
      item('jeans-32', 'بنطال جينز · 32', 'رجالي', 'قطعة', 620),
      item('shoes-40', 'حذاء رياضي · 40', 'أحذية', 'زوج', 950),
    ],
  },
  {
    key: 'supermarket',
    labelAr: 'سوبرماركت ومولات',
    family: 'retail',
    icon: 'cart',
    suggestedFeatures: [
      'weighed_items',
      'departments',
      'batches_expiry',
      'credit_sales',
      'advanced_promotions',
      'loyalty',
      'customer_display',
    ],
    needsTaxNotice: false,
    demoItems: [
      item('rice-1kg', 'رز بسمتي 1 كغ', 'مواد غذائية', 'كيس', 260),
      item('sugar-1kg', 'سكر أبيض 1 كغ', 'مواد غذائية', 'كيس', 120),
      item('oil-1l', 'زيت دوار الشمس 1 لتر', 'مواد غذائية', 'عبوة', 210),
      item('milk-1l', 'حليب 1 لتر', 'ألبان وأجبان', 'عبوة', 95),
      item('tea-400g', 'شاي أسود 400 غ', 'مشروبات', 'علبة', 330),
    ],
  },
  {
    key: 'restaurant',
    labelAr: 'مطعم',
    family: 'restaurants',
    icon: 'utensils',
    suggestedFeatures: ['tables', 'kitchen_printing', 'modifiers', 'recipes', 'delivery', 'order_numbers'],
    needsTaxNotice: false,
    demoItems: [
      item('shawarma', 'سندويشة شاورما', 'سندويش', 'قطعة', 150),
      item('falafel', 'سندويشة فلافل', 'سندويش', 'قطعة', 60),
      item('grill-plate', 'صحن مشاوي', 'وجبات', 'صحن', 650),
      item('fattoush', 'فتوش', 'مقبلات', 'صحن', 180),
      item('ayran', 'عيران', 'مشروبات', 'كوب', 40),
    ],
  },
  {
    key: 'cafe',
    labelAr: 'مقهى وكافتيريا',
    family: 'cafes',
    icon: 'coffee',
    suggestedFeatures: [
      'modifiers',
      'order_numbers',
      'kitchen_printing',
      'tables',
      'recipes',
      'loyalty',
      'timed_pricing',
      'delivery',
    ],
    needsTaxNotice: false,
    demoItems: [
      item('espresso', 'اسبريسو', 'قهوة', 'كوب', 90),
      item('latte-m', 'لاتيه وسط', 'قهوة', 'كوب', 120),
      item('cappuccino', 'كابتشينو', 'قهوة', 'كوب', 115),
      item('tea', 'شاي', 'مشروبات ساخنة', 'كوب', 40),
      item('chocolate-cake', 'كيكة شوكولا', 'حلويات', 'قطعة', 110),
      item('croissant', 'كرواسون', 'حلويات', 'قطعة', 70),
    ],
  },
  {
    key: 'pharmacy',
    labelAr: 'صيدلية',
    family: 'pharmacy',
    icon: 'pill',
    suggestedFeatures: ['batches_expiry', 'multi_units'],
    needsTaxNotice: false,
    demoItems: [
      item('paracetamol', 'باراسيتامول 500 مغ', 'مسكنات', 'علبة', 45),
      item('vitamin-c', 'فيتامين C فوار', 'فيتامينات', 'علبة', 120),
      item('bandage', 'لاصق جروح', 'إسعافات', 'علبة', 35),
      item('baby-wipes', 'مناديل أطفال', 'عناية', 'عبوة', 80),
    ],
  },
  {
    key: 'electronics',
    labelAr: 'إلكترونيات وجوالات',
    family: 'electronics',
    icon: 'smartphone',
    suggestedFeatures: ['serials_warranty', 'quick_exchange', 'sales_commissions'],
    needsTaxNotice: false,
    demoItems: [
      item('charger', 'شاحن سريع 20 واط', 'إكسسوارات', 'قطعة', 260),
      item('cable-c', 'كبل USB-C', 'إكسسوارات', 'قطعة', 90),
      item('earbuds', 'سماعات لاسلكية', 'سماعات', 'قطعة', 1300),
      item('screen-guard', 'لاصقة حماية للشاشة', 'إكسسوارات', 'قطعة', 50),
    ],
  },
  {
    key: 'bakery',
    labelAr: 'مخبز وحلويات',
    family: 'retail',
    icon: 'croissant',
    suggestedFeatures: ['weighed_items', 'kitchen_printing', 'batches_expiry', 'recipes'],
    needsTaxNotice: false,
    demoItems: [
      item('bread', 'ربطة خبز', 'خبز', 'ربطة', 40),
      item('kaak', 'كعك بالسمسم', 'معجنات', 'قطعة', 15),
      item('baklava-kg', 'بقلاوة', 'حلويات', 'كيلو', 900),
      item('maamoul', 'معمول بالتمر', 'حلويات', 'قطعة', 20),
    ],
  },
  {
    key: 'building_materials',
    labelAr: 'مواد بناء وأدوات',
    family: 'wholesale',
    icon: 'hammer',
    suggestedFeatures: ['multi_units', 'credit_sales', 'cheques', 'wholesale_tiers', 'sales_commissions'],
    needsTaxNotice: false,
    demoItems: [
      item('cement-bag', 'إسمنت 50 كغ', 'إسمنت', 'كيس', 650),
      item('paint-4l', 'دهان أبيض 4 لتر', 'دهانات', 'عبوة', 900),
      item('pipe-m', 'أنبوب بلاستيك', 'تمديدات', 'متر', 45),
      item('screws-box', 'براغي خشب', 'عدد وأدوات', 'علبة', 120),
    ],
  },
  {
    key: 'cosmetics',
    labelAr: 'تجميل وعطور',
    family: 'retail',
    icon: 'sparkles',
    suggestedFeatures: ['variants', 'batches_expiry', 'loyalty'],
    needsTaxNotice: false,
    demoItems: [
      item('perfume-50', 'عطر 50 مل', 'عطور', 'قطعة', 1100),
      item('lipstick', 'أحمر شفاه', 'مكياج', 'قطعة', 260),
      item('cream', 'كريم مرطب', 'عناية', 'قطعة', 310),
      item('shampoo', 'شامبو 400 مل', 'عناية', 'عبوة', 190),
    ],
  },
  {
    key: 'produce',
    labelAr: 'خضار وفواكه',
    family: 'retail',
    icon: 'apple',
    suggestedFeatures: ['weighed_items'],
    needsTaxNotice: false,
    demoItems: [
      item('tomato-kg', 'بندورة', 'خضار', 'كيلو', 50),
      item('potato-kg', 'بطاطا', 'خضار', 'كيلو', 40),
      item('apple-kg', 'تفاح', 'فواكه', 'كيلو', 90),
      item('banana-kg', 'موز', 'فواكه', 'كيلو', 110),
    ],
  },
  {
    key: 'wholesale',
    labelAr: 'جملة وتوزيع',
    family: 'wholesale',
    icon: 'boxes',
    suggestedFeatures: ['multi_units', 'credit_sales', 'cheques', 'wholesale_tiers'],
    needsTaxNotice: true,
    demoItems: [
      item('sugar-50kg', 'سكر 50 كغ', 'مواد غذائية', 'كيس', 5200),
      item('oil-carton', 'زيت دوار الشمس · كرتونة 12', 'مواد غذائية', 'كرتونة', 2400),
      item('tea-carton', 'شاي · كرتونة 20', 'مشروبات', 'كرتونة', 6200),
      item('detergent-carton', 'مسحوق غسيل · كرتونة 6', 'منظفات', 'كرتونة', 1500),
    ],
  },
  {
    key: 'general',
    labelAr: 'متجر عام',
    family: 'retail',
    icon: 'store',
    suggestedFeatures: [],
    needsTaxNotice: false,
    demoItems: [
      item('water-1.5l', 'مياه 1.5 لتر', 'مشروبات', 'عبوة', 35),
      item('chips', 'شيبس', 'سناكات', 'كيس', 25),
      item('notebook', 'دفتر 100 ورقة', 'قرطاسية', 'قطعة', 60),
      item('batteries', 'بطاريات AA', 'متفرقات', 'علبة', 120),
    ],
  },
] as const satisfies readonly SectorDefinition[];

export type SectorKey = (typeof SECTORS)[number]['key'];
export type Sector = SectorDefinition & { key: SectorKey };

export const SECTOR_KEYS = SECTORS.map((s) => s.key) as [SectorKey, ...SectorKey[]];

/** The sector a store gets when the owner skips «شو بتشتغل؟». */
export const DEFAULT_SECTOR: SectorKey = 'general';

export function sectorLabel(key: SectorKey): string {
  return SECTORS.find((s) => s.key === key)?.labelAr ?? key;
}

export function getSector(key: SectorKey): Sector | undefined {
  return SECTORS.find((s) => s.key === key);
}

export interface SuggestOptions {
  /** Only with a restaurant: «سفري سريع» starts without the hall, so `tables` is not suggested */
  restaurantMode?: RestaurantMode | null;
}

function suggestedFor(key: SectorKey, options: SuggestOptions): readonly FeatureKey[] {
  const list: readonly FeatureKey[] = getSector(key)?.suggestedFeatures ?? [];
  if (key === 'restaurant' && options.restaurantMode === 'quick') return list.filter((f) => f !== 'tables');
  return list;
}

/**
 * The features the wizard pre-enables (step 2): each chosen sector's list in the order the sectors
 * were chosen, without repeats, at most SUGGESTED_FEATURES_MAX. A café with a bakery gets the six
 * of the design board: modifiers, order numbers, kitchen, tables, recipes, loyalty.
 */
export function suggestFeatures(sectors: readonly SectorKey[], options: SuggestOptions = {}): FeatureKey[] {
  const out: FeatureKey[] = [];
  for (const sector of sectors) {
    for (const feature of suggestedFor(sector, options)) {
      if (out.length === SUGGESTED_FEATURES_MAX) return out;
      if (!out.includes(feature)) out.push(feature);
    }
  }
  return out;
}

/**
 * When a sector is added later (settings, 23 › 1: «أضف نشاط مقهى»): the added sectors' suggested
 * features that are not on yet, to offer the owner. Nothing is switched on or off by itself, and a
 * removed sector removes nothing.
 */
export function featuresToOffer(
  before: readonly SectorKey[],
  after: readonly SectorKey[],
  enabled: readonly FeatureKey[],
  options: SuggestOptions = {},
): FeatureKey[] {
  const added = after.filter((s) => !before.includes(s));
  const out: FeatureKey[] = [];
  for (const sector of added) {
    for (const feature of suggestedFor(sector, options)) {
      if (!enabled.includes(feature) && !out.includes(feature)) out.push(feature);
    }
  }
  return out;
}

/** True when any chosen sector needs the «غير معتمد ضريبياً بعد» notice (07). */
export function needsTaxNotice(sectors: readonly SectorKey[]): boolean {
  return sectors.some((key) => getSector(key)?.needsTaxNotice === true);
}
