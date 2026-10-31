import { z } from 'zod';
import { parseRate } from '../money';
import {
  CORE_FEATURES,
  DEFAULT_SECTOR,
  FEATURES,
  FEATURE_KEYS,
  RESTAURANT_MODES,
  SECTOR_KEYS,
  SECTORS,
  getSector,
  needsTaxNotice,
  type DemoItem,
  type FeatureKey,
  type RestaurantMode,
  type SectorFamily,
  type SectorKey,
} from '../sectors';
import type { CurrencyCode } from '../currencies';
import {
  currencyCodeSchema,
  latinDigits,
  listPageQuery,
  positiveMinorSchema,
  nonNegativeMinorSchema,
  uuidSchema,
  versionSchema,
  type ListResponse,
} from './common';

/**
 * The setup wizard «معالج البداية» (04 › معالج البداية; 12 › المعالج; 17 › معالج البداية; 23 › المرحلة
 * 1 › 1). Five steps shown once after sign-up, each saved on its own so the owner resumes where he
 * stopped; every step can be skipped and takes safe defaults; after «complete» it never shows again
 * and everything is edited from the settings.
 *
 * Store token (`Authorization: Bearer`), tenant from the token. All writes need `store.setup`
 * (owner only); GET /v1/catalog/* is for any signed-in user.
 *
 *   GET  /v1/catalog/sectors              signed in     → CatalogSectorsResponse
 *   GET  /v1/onboarding                   store.setup   → OnboardingState
 *   PUT  /v1/onboarding/business          store.setup   businessStepInput → OnboardingState
 *   PUT  /v1/onboarding/features          store.setup   featuresStepInput → OnboardingState
 *   PUT  /v1/onboarding/store             store.setup   storeStepInput    → OnboardingState
 *   PUT  /v1/onboarding/currency          store.setup   currencyStepInput → OnboardingState
 *   POST /v1/onboarding/demo-sale         store.setup   demoSaleInput     → DemoSaleReceipt
 *   GET  /v1/catalog/starter              signed in     starterCatalogQuery → StarterCatalogResponse
 *   POST /v1/onboarding/starter-catalog   store.setup   starterCatalogInput → StarterCatalogResult
 *   POST /v1/onboarding/complete          store.setup   no body → OnboardingSummary
 *   PATCH /v1/settings/features           store.setup   updateStoreFeaturesInput → StoreFeatures
 *
 * Every PUT step takes either its fields or `{ "skip": true }` (17). A step can be saved again
 * (the «رجوع» button) until «complete»; after it every write here answers 409 `conflict` and the
 * same changes go through the settings. `PATCH /v1/settings/features` is how a sector is added
 * later (23 › 1: «من الإعدادات أضف نشاط مقهى»): it lives here because it obeys the same rule.
 *
 * Data is never lost (04, 23 › 1): removing a sector or switching a feature off only hides
 * screens; products, stock, tables, documents stay as they are and come back when switched on.
 */

// ─── Steps ───────────────────────────────────────────────────────────────────

/** The four saved steps, then the trial sale; `done` once completed. */
export const ONBOARDING_STEPS = ['business', 'features', 'store', 'currency', 'trial'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStep = OnboardingStepKey | 'done';

/** The steps with a PUT route (the trial step has its own two routes). */
export type SavedStepKey = Exclude<OnboardingStepKey, 'trial'>;

/**
 * Where the wizard opens (04 › «يكمل من حيث توقف»): the first of the four saved steps neither saved
 * nor skipped, then `trial`, and `done` once completed. Going back and saving an earlier step does
 * not move it back.
 */
export function currentOnboardingStep(state: {
  completedAt: string | null;
  saved: readonly SavedStepKey[];
  skipped: readonly SavedStepKey[];
}): OnboardingStep {
  if (state.completedAt) return 'done';
  for (const step of ONBOARDING_STEPS) {
    if (step === 'trial') return 'trial';
    if (!state.saved.includes(step) && !state.skipped.includes(step)) return step;
  }
  return 'trial';
}

export interface StepSkip {
  skip: true;
}

const isSkip = (value: unknown): value is StepSkip =>
  typeof value === 'object' &&
  value !== null &&
  (value as { skip?: unknown }).skip === true &&
  Object.keys(value).length === 1;

/**
 * `{ "skip": true }` or the step's fields (17). Not a zod union, so a refused form keeps each
 * field's own Arabic message and path (a union would answer only «Invalid input»).
 */
const skippable = <T extends z.ZodType>(fields: T) =>
  z.unknown().transform((value, ctx): StepSkip | z.output<T> => {
    if (isSkip(value)) return { skip: true };
    const parsed = fields.safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path, input: value });
    }
    return z.NEVER;
  });

// ─── GET /v1/catalog/sectors ─────────────────────────────────────────────────

export interface SectorInfo {
  key: SectorKey;
  labelAr: string;
  family: SectorFamily;
  icon: string;
  /** Most fitting first */
  suggestedFeatures: FeatureKey[];
  /** «البرنامج غير معتمد ضريبياً بعد» must be acknowledged (businessStepInput.taxNoticeAccepted) */
  needsTaxNotice: boolean;
  /** Only `restaurant`: asks «عندك صالة وطاولات، أم سفري سريع؟» */
  asksRestaurantMode: boolean;
  /** Sample items «تجريبي» for the trial sale and the optional demo data */
  demoItems: DemoItem[];
}

export interface FeatureInfo {
  key: FeatureKey;
  labelAr: string;
  /** The one-line explanation shown under the switch (04) */
  descriptionAr: string;
}

export interface CatalogSectorsResponse {
  sectors: SectorInfo[];
  /** Every switch, in display order; «المزيد» lists those not suggested */
  features: FeatureInfo[];
  /** «الأساسيات ثابتة»: always on, shown without a switch */
  coreFeatures: { key: string; labelAr: string }[];
}

/** The answer of GET /v1/catalog/sectors, built from the catalogue in sectors.ts. */
export function catalogSectors(): CatalogSectorsResponse {
  return {
    sectors: SECTORS.map((s) => ({
      key: s.key,
      labelAr: s.labelAr,
      family: s.family,
      icon: s.icon,
      suggestedFeatures: [...s.suggestedFeatures],
      needsTaxNotice: s.needsTaxNotice,
      asksRestaurantMode: s.key === 'restaurant',
      demoItems: s.demoItems.map((d) => ({ ...d })),
    })),
    features: FEATURE_KEYS.map((key) => ({ key, ...FEATURES[key] })),
    coreFeatures: CORE_FEATURES.map((f) => ({ ...f })),
  };
}

// ─── Step 1: «شو بتشتغل؟» ────────────────────────────────────────────────────

const sectorListSchema = z
  .array(z.enum(SECTOR_KEYS, 'نشاط غير معروف'), 'اختر نشاطاً واحداً على الأقل')
  .min(1, 'اختر نشاطاً واحداً على الأقل')
  .max(SECTOR_KEYS.length)
  .refine((list) => new Set(list).size === list.length, 'النشاط مكرر');

const businessFields = z
  .object({
    /** In the order chosen: the first sector's features are suggested first */
    sectors: sectorListSchema,
    /** «نشاطك غير موجود؟ اكتبه»: kept for the platform to learn from; the store gets `general` too */
    otherSector: z.string().trim().max(60, 'اكتبه باختصار').optional(),
    /** Asked only with a restaurant; `dine_in` when not given */
    restaurantMode: z.enum(RESTAURANT_MODES).optional(),
    /** «فهمت، وأريد المتابعة»: required when a chosen sector needs the e-invoicing notice (07) */
    taxNoticeAccepted: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (needsTaxNotice(value.sectors) && value.taxNoticeAccepted !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['taxNoticeAccepted'],
        message: 'اقرأ التنبيه عن الفوترة المعتمدة ووافق عليه للمتابعة',
      });
    }
  })
  .transform((value) => ({
    sectors: value.sectors,
    otherSector: value.otherSector || null,
    restaurantMode: value.sectors.includes('restaurant') ? (value.restaurantMode ?? 'dine_in') : null,
    taxNoticeAccepted: value.taxNoticeAccepted === true,
  }));

export const businessStepFields = businessFields;
export const businessStepInput = skippable(businessFields);
export type BusinessStepInput = StepSkip | z.input<typeof businessFields>;
export type BusinessStepData = z.output<typeof businessFields>;

/** Skipped: a general store, no notice needed. */
export const DEFAULT_BUSINESS: BusinessStepData = {
  sectors: [DEFAULT_SECTOR],
  otherSector: null,
  restaurantMode: null,
  taxNoticeAccepted: false,
};

// ─── Step 2: «هذا ما جهّزناه لك» ─────────────────────────────────────────────

const featureListSchema = z
  .array(z.enum(FEATURE_KEYS, 'ميزة غير معروفة'))
  .max(FEATURE_KEYS.length)
  .refine((list) => new Set(list).size === list.length, 'الميزة مكررة');

const featuresFields = z.object({
  /** Every switch that is on; may be empty (the basics are always on). Skipped: suggestFeatures() */
  enabled: featureListSchema,
});

export const featuresStepFields = featuresFields;
export const featuresStepInput = skippable(featuresFields);
export type FeaturesStepInput = StepSkip | z.input<typeof featuresFields>;
export type FeaturesStepData = z.output<typeof featuresFields>;

// ─── Step 3: «معلومات محلّك» ─────────────────────────────────────────────────

/** The 14 governorates, for the address and the platform's store filter (17 › المتاجر). */
export const GOVERNORATES = {
  damascus: 'دمشق',
  rif_dimashq: 'ريف دمشق',
  aleppo: 'حلب',
  homs: 'حمص',
  hama: 'حماة',
  latakia: 'اللاذقية',
  tartus: 'طرطوس',
  idlib: 'إدلب',
  raqqa: 'الرقة',
  deir_ez_zor: 'دير الزور',
  hasakah: 'الحسكة',
  daraa: 'درعا',
  suwayda: 'السويداء',
  quneitra: 'القنيطرة',
} as const;
export type Governorate = keyof typeof GOVERNORATES;
export const GOVERNORATE_KEYS = Object.keys(GOVERNORATES) as [Governorate, ...Governorate[]];

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isHexDigit = (ch: string) => isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');

/**
 * A shop's phone as typed (landline or mobile, local or international): Arabic digits read as
 * Latin, spaces, dashes, dots and brackets dropped, an optional leading +, then 6 to 15 digits.
 * Null when it is not a phone number. Checked character by character.
 */
export function normalizeShopPhone(input: string): string | null {
  const text = latinDigits(input);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '-' || ch === '.' || ch === '(' || ch === ')') continue;
    if (ch === '+' && out === '') out = '+';
    else if (isDigit(ch)) out += ch;
    else return null;
  }
  const digits = out.startsWith('+') ? out.length - 1 : out.length;
  return digits >= 6 && digits <= 15 ? out : null;
}

/** sRGB channel → linear (WCAG 2.x). */
const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** `#RRGGBB` → [r, g, b], or null. Checked character by character. */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (hex.length !== 7 || hex[0] !== '#') return null;
  for (let i = 1; i < 7; i++) if (!isHexDigit(hex[i]!)) return null;
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG contrast ratio of two `#RRGGBB` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = parseHexColor(hex);
    if (!rgb) throw new RangeError(`not a #RRGGBB colour: ${hex}`);
    const [r, g, b] = rgb.map(linear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A shop colour carries white text on buttons and the menu (14 › الألوان; 12 «لون من ألوان
 * مفحوصة»): at least 4.5:1 against white, or it is refused as hard to read.
 */
export const BRAND_COLOR_MIN_CONTRAST = 4.5;

const brandColorSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => parseHexColor(v) !== null, 'اكتب اللون بصيغة ‎#RRGGBB')
  .refine(
    (v) => parseHexColor(v) === null || contrastRatio(v, '#FFFFFF') >= BRAND_COLOR_MIN_CONTRAST,
    'هذا اللون صعب القراءة مع النص الأبيض. اختر لوناً أغمق',
  );

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .optional()
    .transform((v) => v || null);

const storeFields = z.object({
  /** «الاسم على الفاتورة»; also becomes the store's name (it replaces the temporary one from sign-up) */
  receiptName: z
    .string('اسم المحل مطلوب')
    .trim()
    .min(1, 'اسم المحل مطلوب')
    .max(60, 'الاسم طويل جداً على الإيصال'),
  /** An upload with purpose `store_logo` (contracts/uploads.ts); null removes the logo */
  logoUploadId: uuidSchema.nullable().optional().default(null),
  address: optionalText(200, 'العنوان طويل جداً'),
  governorate: z.enum(GOVERNORATE_KEYS, 'اختر المحافظة').nullable().optional().default(null),
  phone: z
    .string()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v.trim() === '') return null;
      const phone = normalizeShopPhone(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'رقم الهاتف غير صحيح. مثال: 0944123456' });
        return z.NEVER;
      }
      return phone;
    }),
  /** «الرقم الضريبي إن وُجد»: digits only, Arabic digits read as Latin */
  taxNumber: z
    .string()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      const digits = v ? latinDigits(v) : '';
      if (digits === '') return null;
      if (digits.length > 20 || ![...digits].every(isDigit)) {
        ctx.addIssue({ code: 'custom', message: 'الرقم الضريبي أرقام فقط' });
        return z.NEVER;
      }
      return digits;
    }),
  /** «لون المحل» for the online menu and the customer screen; null keeps the platform colour */
  brandColor: brandColorSchema.nullable().optional().default(null),
});

export const storeStepFields = storeFields;
export const storeStepInput = skippable(storeFields);
export type StoreStepInput = StepSkip | z.input<typeof storeFields>;
export type StoreStepData = z.output<typeof storeFields>;

// ─── Step 4: «العملة والأسعار» ───────────────────────────────────────────────

/** Pounds per dollar as typed, «١٣٠» or "130.5": ≥ 1 with ≤ 6 decimals (money.ts parseRate). */
export const usdRateSchema = z
  .string('اكتب سعر الدولار')
  .transform(latinDigits)
  .superRefine((value, ctx) => {
    try {
      parseRate(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'سعر الدولار رقم موجب، مثل 130' });
    }
  });

const currencyFields = z.object({
  /** «الليرة عملة أساسية» is the suggestion (04) */
  baseCurrency: currencyCodeSchema.default('SYP'),
  /**
   * «الليرة أساساً، وبعض الأصناف بالدولار» (true, the suggestion) or «كل أسعاري بالليرة» (false:
   * the dollar shows under the total for information only). Both currencies stay accepted at the
   * till either way (04 › الأساسيات: الليرة والدولار).
   */
  usdPrices: z.boolean().default(true),
  /** Pounds per dollar; null takes the platform's rate offered in OnboardingState.defaults */
  usdRate: usdRateSchema.nullable().optional().default(null),
  /** Shelf prices include tax; with no tax rate (the default, «الأسعار بلا ضريبة») it changes nothing */
  taxInclusive: z.boolean().default(true),
});

export const currencyStepFields = currencyFields;
export const currencyStepInput = skippable(currencyFields);
export type CurrencyStepInput = StepSkip | z.input<typeof currencyFields>;
export type CurrencyStepData = z.output<typeof currencyFields>;

// ─── GET /v1/onboarding ──────────────────────────────────────────────────────

export interface OnboardingState {
  step: OnboardingStep;
  completedAt: string | null;
  /** Steps saved with their fields, and steps skipped (they take the defaults at «complete») */
  saved: SavedStepKey[];
  skipped: SavedStepKey[];
  business: BusinessStepData | null;
  features: FeaturesStepData | null;
  store: (StoreStepData & { logoUrl: string | null }) | null;
  currency: CurrencyStepData | null;
  trial: {
    demoSaleAt: string | null;
    /** What step 5's «ابدأ بقائمة جاهزة» did, if anything */
    starter: 'items' | 'demo' | null;
  };
  /** suggestFeatures() for the saved sectors (or the default sector): step 2 starts from these */
  suggestedFeatures: FeatureKey[];
  /** What a skipped step becomes, and the pre-filled values of the screens */
  defaults: {
    /** The temporary name given at sign-up */
    receiptName: string;
    /** The platform's dollar rate «من نشرة سيرفا», or null when it has none yet */
    usdRate: { rate: string; at: string } | null;
  };
}

// ─── Step 5: the trial sale and the starter catalogue ────────────────────────

/**
 * POST /v1/onboarding/demo-sale: the trial sale on the sector's sample items (04 › جرّب أول بيع). It
 * is not numbered, never enters the books, the stock or the reports, and makes no product: the
 * items are SectorInfo.demoItems. The answer is the on-screen receipt; a copy goes to the owner's
 * own WhatsApp when the platform can send it.
 */
export const demoSaleInput = z
  .object({
    sector: z.enum(SECTOR_KEYS),
    lines: z
      .array(z.object({ itemKey: z.string().min(1).max(60), qty: z.int().min(1).max(99) }))
      .min(1, 'اختر صنفاً')
      .max(20),
    /** Cash handed over, pounds in minor units; at least the total */
    paidMinor: nonNegativeMinorSchema,
  })
  .superRefine((value, ctx) => {
    const items = getSector(value.sector)?.demoItems ?? [];
    value.lines.forEach((line, i) => {
      if (!items.some((d) => d.key === line.itemKey)) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'itemKey'], message: 'صنف تجريبي غير معروف' });
      }
    });
    const total = priceDemoSale(value).totalMinor;
    if (value.paidMinor < total) {
      ctx.addIssue({ code: 'custom', path: ['paidMinor'], message: 'المبلغ المدفوع أقل من المجموع' });
    }
  });
export type DemoSaleInput = z.input<typeof demoSaleInput>;
export type DemoSaleData = z.output<typeof demoSaleInput>;

export interface DemoSaleLine {
  itemKey: string;
  nameAr: string;
  qty: number;
  unitPriceMinor: number;
  totalMinor: number;
}

/** Lines and total of a trial sale, in pounds; unknown item keys are left out. Server and web share it. */
export function priceDemoSale(input: {
  sector: SectorKey;
  lines: readonly { itemKey: string; qty: number }[];
}): { lines: DemoSaleLine[]; totalMinor: number } {
  const items = getSector(input.sector)?.demoItems ?? [];
  const lines: DemoSaleLine[] = [];
  for (const line of input.lines) {
    const found = items.find((d) => d.key === line.itemKey);
    if (!found) continue;
    lines.push({
      itemKey: found.key,
      nameAr: found.nameAr,
      qty: line.qty,
      unitPriceMinor: found.priceMinor,
      totalMinor: found.priceMinor * line.qty,
    });
  }
  return { lines, totalMinor: lines.reduce((sum, l) => sum + l.totalMinor, 0) };
}

export interface DemoSaleReceipt {
  /** «بيع تجريبي · لا يُحتسب» is printed on it */
  demo: true;
  storeName: string;
  address: string | null;
  at: string;
  currency: 'SYP';
  lines: DemoSaleLine[];
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  /** A copy to the owner's own WhatsApp from the platform's notification number, when it can be sent */
  whatsapp: 'queued' | 'unavailable';
}

/** GET /v1/catalog/starter: the shared starter catalogue of a sector (13 › كتالوج البداية). No prices or costs. */
export const starterCatalogQuery = z.object({
  sector: z.enum(SECTOR_KEYS),
  category: z.string().trim().max(60).optional(),
  ...listPageQuery,
});
export type StarterCatalogQuery = z.input<typeof starterCatalogQuery>;

export interface StarterItem {
  id: string;
  sector: SectorKey;
  categoryKey: string;
  categoryAr: string;
  nameAr: string;
  nameEn: string | null;
  barcode: string | null;
  /** «كيس»، «علبة»، «كوب»: the server finds or makes the store unit of this name */
  unitAr: string;
  imageUrl: string | null;
}

export interface StarterCatalogResponse extends ListResponse<StarterItem> {
  sector: SectorKey;
  /** «الكل 248 · مواد غذائية 64 …» */
  categories: { key: string; nameAr: string; count: number }[];
  total: number;
}

const MAX_STARTER_IMPORT = 500;

/**
 * POST /v1/onboarding/starter-catalog. Also allowed after «complete» (the home checklist and the
 * products screen offer it), unlike the steps.
 * - `items`: copies the chosen starter items into the store's catalogue with the prices typed in
 *   the one table (12 › القائمة الجاهزة), each with its name, barcode, unit and category; an item
 *   whose barcode is already in the store is skipped. Every item needs a price: the table's «أضف»
 *   stays off until each chosen row has one.
 * - `demo`: adds the sectors' sample items as products marked «تجريبي» (`isDemo`), to try the till.
 * - `clear_demo`: removes them (one tap), as the first real invoice also does by itself. Items
 *   already sold in a real invoice are archived instead of removed.
 */
export const starterCatalogInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('items'),
    currency: currencyCodeSchema.default('SYP'),
    items: z
      .array(
        z.object({
          starterItemId: uuidSchema,
          priceMinor: positiveMinorSchema,
          /** «الكلفة اختيارية» */
          costMinor: nonNegativeMinorSchema.nullable().optional().default(null),
        }),
        'اختر صنفاً',
      )
      .min(1, 'اختر صنفاً')
      .max(MAX_STARTER_IMPORT)
      .refine((list) => new Set(list.map((i) => i.starterItemId)).size === list.length, 'الصنف مكرر'),
  }),
  z.object({
    mode: z.literal('demo'),
    /** Defaults to the store's sectors */
    sectors: sectorListSchema.optional(),
  }),
  z.object({ mode: z.literal('clear_demo') }),
]);
export type StarterCatalogInput = z.input<typeof starterCatalogInput>;
export type StarterCatalogData = z.output<typeof starterCatalogInput>;

export interface StarterCatalogResult {
  created: number;
  /** Barcode already in the store */
  skipped: number;
  /** `clear_demo`: removed, and archived because already sold */
  removed: number;
  archived: number;
}

// ─── POST /v1/onboarding/complete ────────────────────────────────────────────

/**
 * «ملخّص بما اخترت» (23 › 1). Unsaved steps take their defaults: a general store, the suggested
 * features, the sign-up name, pounds with dollar prices at the platform's rate, tax inclusive and
 * no tax rate. Calling it again returns the same summary.
 */
export interface OnboardingSummary {
  completedAt: string;
  sectors: SectorKey[];
  restaurantMode: RestaurantMode | null;
  enabledFeatures: FeatureKey[];
  storeName: string;
  baseCurrency: CurrencyCode;
  usdPrices: boolean;
  usdRate: string | null;
  taxInclusive: boolean;
  /** Steps that took their defaults */
  skipped: SavedStepKey[];
}

// ─── PATCH /v1/settings/features (adding a sector later) ─────────────────────

/**
 * The full lists after the change. The answer's `offers` are the added sectors' suggested features
 * not yet on (featuresToOffer): the screen offers them, and a second PATCH switches on those the
 * owner keeps. Nothing is deleted when a sector or a feature goes (04).
 */
export const updateStoreFeaturesInput = z.object({
  version: versionSchema,
  sectors: sectorListSchema,
  restaurantMode: z.enum(RESTAURANT_MODES).nullable().optional(),
  enabledFeatures: featureListSchema,
});
export type UpdateStoreFeaturesInput = z.input<typeof updateStoreFeaturesInput>;
export type UpdateStoreFeaturesData = z.output<typeof updateStoreFeaturesInput>;

/** The `features` section of GET /v1/settings, and the answer of PATCH /v1/settings/features. */
export interface StoreFeatures {
  sectors: SectorKey[];
  otherSector: string | null;
  restaurantMode: RestaurantMode | null;
  enabledFeatures: FeatureKey[];
  /** Suggested for the sectors just added and not on yet; empty on GET */
  offers: FeatureKey[];
  /** Version of the store settings record (409 stale_version) */
  version: number;
}
