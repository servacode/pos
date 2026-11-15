import { normalizeArabic, type Category, type SectorKey } from '@serva/core';

interface Rule {
  /** Words of the product's name (normalized spelling) */
  words: RegExp;
  /** The category it belongs in */
  category: string;
  /** Business types it applies to; empty = every store */
  sectors?: readonly SectorKey[];
}

const MEDICAL: readonly SectorKey[] = ['medical_supplies', 'pharmacy'];
const CLOTHES: readonly SectorKey[] = ['clothing'];
/** Food and drink categories belong to the stores that sell food, never to a medical or clothing store */
const FOOD: readonly SectorKey[] = [
  'supermarket',
  'restaurant',
  'cafe',
  'bakery',
  'produce',
  'wholesale',
  'general',
];

/** First match wins: the specific words go first. */
const RULES: readonly Rule[] = [
  { words: /كرسي|كراسي|عكاز|مشاي|سرير|مرتبه/, category: 'كراسي متحركة', sectors: MEDICAL },
  // Catheters and tubes first: «قسطرة فولي» holds the letters of «فول» (beans) and must not read as groceries
  { words: /قسطر|قثطر|فولي|كانيول|انبوب|خرطوم|مبوله|كيس بول/, category: 'مستهلكات', sectors: MEDICAL },
  {
    words: /ضغط|سكر|حرار|محرار|ترمومتر|ميزان|سماعه|اوكسجين|نبض|بخار|قياس|جهاز|اجهزه/,
    category: 'أجهزة قياس',
    sectors: MEDICAL,
  },
  {
    words: /قفاز|شاش|حقن|سرنج|كمام|محلول|محاليل|ضماد|قطن|معقم|لصق|كحول|سيروم|مستهلك/,
    category: 'مستهلكات',
    sectors: MEDICAL,
  },
  { words: /مسكن|بنادول|باراسيتامول|ايبوبروفين/, category: 'مسكنات', sectors: ['pharmacy'] },
  { words: /مضاد حيوي|اموكسيسيلين|اوغمنتين|سيبرو/, category: 'مضادات حيوية', sectors: ['pharmacy'] },
  { words: /فيتامين|زنك|كالسيوم|اوميغا/, category: 'فيتامينات', sectors: ['pharmacy'] },
  { words: /حفاض|رضاع|حليب اطفال|طفل/, category: 'عناية بالطفل', sectors: ['pharmacy'] },
  { words: /جوارب|كلسات|جراب/, category: 'جوارب', sectors: CLOTHES },
  { words: /حذاء|احذيه|صندل|جزمه|بوت|شحاطه|نعل/, category: 'أحذية', sectors: CLOTHES },
  { words: /جاكيت|معطف|بالطو|سترة|كنزه|بلوفر|هودي/, category: 'جاكيتات ومعاطف', sectors: CLOTHES },
  { words: /فستان|تنوره|عباي/, category: 'فساتين وتنانير', sectors: CLOTHES },
  { words: /بنطال|بنطلون|جينز|سروال|شورت/, category: 'بناطيل', sectors: CLOTHES },
  { words: /قميص|تيشرت|تيشيرت|تي شيرت|بلوز|بولو/, category: 'قمصان', sectors: CLOTHES },
  { words: /بيجام|منامه|ملابس داخليه|بوكسر/, category: 'ملابس منزلية', sectors: CLOTHES },
  {
    words: /حقيب|حزام|وشاح|شال|قبعه|ساعه|نظار|عطر|اكسسوار|خاتم|سوار|قلاد/,
    category: 'إكسسوارات',
    sectors: CLOTHES,
  },
  { words: /عطر|كولونيا/, category: 'عطور' },
  { words: /مكياج|احمر شفاه|ماسكرا|كحل/, category: 'مكياج' },
  { words: /شامبو|بلسم|شعر/, category: 'عناية بالشعر' },
  { words: /كريم|غسول|مرطب|بشره/, category: 'عناية بالبشرة' },
  { words: /خبز|صمون|فينو/, category: 'خبز', sectors: FOOD },
  { words: /معجنات|فطائر|مناقيش/, category: 'معجنات', sectors: FOOD },
  { words: /كعك|بيتي فور|معمول/, category: 'كعك', sectors: FOOD },
  { words: /حلو|كيك|بقلاو|كنافه/, category: 'حلويات', sectors: FOOD },
  { words: /حليب|لبن|جبن|جبنه|قشطه|زبده|لبنه/, category: 'ألبان وأجبان', sectors: FOOD },
  { words: /منظف|صابون|جافيل|مطهر|سائل جلي/, category: 'منظفات', sectors: FOOD },
  { words: /معلب|تونه|فول|حمص|مربى/, category: 'معلبات', sectors: FOOD },
  { words: /عصير|ماء|مياه|مشروب|كولا|بيبسي|شاي|قهوه/, category: 'مشروبات', sectors: FOOD },
  { words: /جوال|هاتف|موبايل|ايفون|سامسونج/, category: 'جوالات', sectors: ['electronics'] },
  { words: /شاحن|كيبل|كابل|سماعات|باور/, category: 'شواحن وسماعات', sectors: ['electronics'] },
];

export interface CategoryChoice {
  /** Existing category to use, or null when `newName` has to be created first */
  categoryId: string | null;
  /** The category to create when no existing one fits */
  newName: string | null;
}

function key(text: string): string {
  return normalizeArabic(text).replace(/\s+/g, ' ').trim();
}

/** The category a product name points to, as a plain name (or null when it says nothing) */
export function suggestCategoryName(
  productName: string,
  sectors: readonly SectorKey[] | undefined,
): string | null {
  const name = key(productName);
  if (!name) return null;
  for (const rule of RULES) {
    if (rule.sectors && rule.sectors.length > 0) {
      // A store with no business type set still gets every rule
      if (sectors && sectors.length > 0 && !rule.sectors.some((s) => sectors.includes(s))) continue;
    }
    if (rule.words.test(name)) return rule.category;
  }
  return null;
}

/**
 * What to propose for a product: a category the store already has (by the suggested name, or one whose own
 * name is in the product's name), else the suggested name to create, else nothing.
 */
export function suggestFor(
  productName: string,
  categories: readonly Pick<Category, 'id' | 'name' | 'archivedAt'>[],
  sectors: readonly SectorKey[] | undefined,
): CategoryChoice | null {
  const live = categories.filter((c) => !c.archivedAt);
  const suggested = suggestCategoryName(productName, sectors);
  if (suggested) {
    const wanted = key(suggested);
    // The store's own name for it may say more («مستهلكات طبية» for «مستهلكات»)
    const same =
      live.find((c) => key(c.name) === wanted) ??
      (wanted.length >= 4
        ? live.find((c) => key(c.name).startsWith(`${wanted} `) || wanted.startsWith(`${key(c.name)} `))
        : undefined);
    if (same) return { categoryId: same.id, newName: null };
  }
  const name = key(productName);
  const inside = live
    .filter((c) => key(c.name).length >= 3 && name.includes(key(c.name)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (inside) return { categoryId: inside.id, newName: null };
  return suggested ? { categoryId: null, newName: suggested } : null;
}
