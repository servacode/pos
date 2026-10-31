import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, SECTORS, suggestFeatures } from '../sectors';
import {
  BRAND_COLOR_MIN_CONTRAST,
  DEFAULT_BUSINESS,
  GOVERNORATE_KEYS,
  businessStepInput,
  catalogSectors,
  contrastRatio,
  currencyStepInput,
  currentOnboardingStep,
  demoSaleInput,
  featuresStepInput,
  normalizeShopPhone,
  parseHexColor,
  priceDemoSale,
  starterCatalogInput,
  starterCatalogQuery,
  storeStepFields,
  storeStepInput,
  updateStoreFeaturesInput,
} from './onboarding';

const ITEM_A = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const ITEM_B = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';
const LOGO_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03';

const firstMessage = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('currentOnboardingStep', () => {
  const at = (saved: string[], skipped: string[] = [], completedAt: string | null = null) =>
    currentOnboardingStep({ saved: saved as never, skipped: skipped as never, completedAt });

  it('opens at the first step neither saved nor skipped (23 › 1: close at «العملة», come back there)', () => {
    expect(at([])).toBe('business');
    expect(at(['business'])).toBe('features');
    expect(at(['business', 'features'], ['store'])).toBe('currency');
    expect(at(['business', 'features', 'store', 'currency'])).toBe('trial');
    expect(at([], ['business', 'features', 'store', 'currency'])).toBe('trial');
  });

  it('does not move back when an earlier step is saved again, and is done once completed', () => {
    expect(at(['features', 'business', 'store'])).toBe('currency');
    expect(at([], [], '2026-10-31T09:00:00Z')).toBe('done');
  });
});

describe('catalogSectors', () => {
  it('serves every sector, every switch and the six basics', () => {
    const catalog = catalogSectors();
    expect(catalog.sectors.map((s) => s.key)).toEqual(SECTORS.map((s) => s.key));
    expect(catalog.features.map((f) => f.key)).toEqual(FEATURE_KEYS);
    expect(catalog.coreFeatures).toHaveLength(6);
    expect(catalog.sectors.find((s) => s.key === 'restaurant')?.asksRestaurantMode).toBe(true);
    expect(catalog.sectors.filter((s) => s.asksRestaurantMode)).toHaveLength(1);
    expect(catalog.sectors.find((s) => s.key === 'wholesale')?.needsTaxNotice).toBe(true);
    expect(catalog.features.find((f) => f.key === 'tables')).toEqual({
      key: 'tables',
      labelAr: 'الطاولات والصالة',
      descriptionAr: 'خريطة الصالة وحالة كل طاولة',
    });
  });

  it('hands out copies, so a caller cannot change the catalogue', () => {
    const one = catalogSectors();
    one.sectors[0]!.suggestedFeatures.push('tables');
    one.sectors[0]!.demoItems[0]!.priceMinor = 1;
    expect(catalogSectors()).toEqual(catalogSectors());
    expect(catalogSectors().sectors[0]!.demoItems[0]!.priceMinor).not.toBe(1);
  });
});

describe('step 1: business', () => {
  it('takes one or more sectors in the order chosen', () => {
    expect(businessStepInput.parse({ sectors: ['cafe', 'bakery'] })).toEqual({
      sectors: ['cafe', 'bakery'],
      otherSector: null,
      restaurantMode: null,
      taxNoticeAccepted: false,
    });
  });

  it('takes {skip: true}, and nothing else with it', () => {
    expect(businessStepInput.parse({ skip: true })).toEqual({ skip: true });
    expect(businessStepInput.safeParse({ skip: false }).success).toBe(false);
    expect(businessStepInput.safeParse({ skip: true, note: 'x' }).success).toBe(false);
    expect(businessStepInput.safeParse(null).success).toBe(false);
    expect(DEFAULT_BUSINESS.sectors).toEqual(['general']);
  });

  it('asks the restaurant its mode, dine-in by default, and forgets it without a restaurant', () => {
    expect(businessStepInput.parse({ sectors: ['restaurant'] })).toMatchObject({ restaurantMode: 'dine_in' });
    expect(businessStepInput.parse({ sectors: ['restaurant'], restaurantMode: 'quick' })).toMatchObject({
      restaurantMode: 'quick',
    });
    expect(businessStepInput.parse({ sectors: ['cafe'], restaurantMode: 'quick' })).toMatchObject({
      restaurantMode: null,
    });
    expect(businessStepInput.safeParse({ sectors: ['restaurant'], restaurantMode: 'buffet' }).success).toBe(
      false,
    );
  });

  it('keeps «نشاطك غير موجود؟» as text', () => {
    expect(businessStepInput.parse({ sectors: ['general'], otherSector: '  محل هدايا ' })).toMatchObject({
      otherSector: 'محل هدايا',
    });
    expect(businessStepInput.safeParse({ sectors: ['general'], otherSector: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });

  it('needs the e-invoicing notice accepted for wholesale (07)', () => {
    const refused = businessStepInput.safeParse({ sectors: ['cafe', 'wholesale'] });
    expect(refused.error?.issues.at(-1)?.path).toEqual(['taxNoticeAccepted']);
    expect(businessStepInput.parse({ sectors: ['wholesale'], taxNoticeAccepted: true })).toMatchObject({
      taxNoticeAccepted: true,
    });
    expect(businessStepInput.safeParse({ sectors: ['wholesale'], taxNoticeAccepted: false }).success).toBe(
      false,
    );
  });

  it.each([
    [{ sectors: [] }, 'اختر نشاطاً واحداً على الأقل'],
    [{ sectors: ['cafe', 'cafe'] }, 'النشاط مكرر'],
    [{ sectors: ['kiosk'] }, 'نشاط غير معروف'],
    [{}, 'اختر نشاطاً واحداً على الأقل'],
  ])('refuses %j', (input, message) => {
    const result = businessStepInput.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });
});

describe('step 2: features', () => {
  it('takes the switched-on features, possibly none, or a skip', () => {
    const enabled = suggestFeatures(['clothing']);
    expect(featuresStepInput.parse({ enabled })).toEqual({ enabled });
    expect(featuresStepInput.parse({ enabled: [] })).toEqual({ enabled: [] });
    expect(featuresStepInput.parse({ skip: true })).toEqual({ skip: true });
  });

  it('refuses unknown and repeated features', () => {
    expect(featuresStepInput.safeParse({ enabled: ['teleport'] }).success).toBe(false);
    expect(featuresStepInput.safeParse({ enabled: ['tables', 'tables'] }).success).toBe(false);
    expect(featuresStepInput.safeParse({ enabled: 'tables' }).success).toBe(false);
  });
});

describe('step 3: the shop', () => {
  it('takes the receipt name alone; everything else defaults to null', () => {
    expect(storeStepInput.parse({ receiptName: ' مقهى الياسمين ' })).toEqual({
      receiptName: 'مقهى الياسمين',
      logoUploadId: null,
      address: null,
      governorate: null,
      phone: null,
      taxNumber: null,
      brandColor: null,
    });
    expect(storeStepInput.parse({ skip: true })).toEqual({ skip: true });
  });

  it('takes the whole board', () => {
    expect(
      storeStepFields.parse({
        receiptName: 'مقهى الياسمين',
        logoUploadId: LOGO_ID,
        address: 'الرقة · شارع تل أبيض',
        governorate: 'raqqa',
        phone: '٠٩٤٤ ١٢٣ ٤٥٦',
        taxNumber: '١١٢٠٤٥٧٨٦',
        brandColor: '#008157',
      }),
    ).toEqual({
      receiptName: 'مقهى الياسمين',
      logoUploadId: LOGO_ID,
      address: 'الرقة · شارع تل أبيض',
      governorate: 'raqqa',
      phone: '0944123456',
      taxNumber: '112045786',
      brandColor: '#008157',
    });
  });

  it('reads empty optional fields as null', () => {
    expect(
      storeStepFields.parse({ receiptName: 'x', address: '  ', phone: ' ', taxNumber: '' }),
    ).toMatchObject({
      address: null,
      phone: null,
      taxNumber: null,
    });
  });

  it.each([
    [{ receiptName: '' }, 'اسم المحل مطلوب'],
    [{ receiptName: 'x'.repeat(61) }, 'الاسم طويل جداً على الإيصال'],
    [{ receiptName: 'x', phone: 'abc' }, 'رقم الهاتف غير صحيح. مثال: 0944123456'],
    [{ receiptName: 'x', taxNumber: '12-34' }, 'الرقم الضريبي أرقام فقط'],
    [{ receiptName: 'x', taxNumber: '1'.repeat(21) }, 'الرقم الضريبي أرقام فقط'],
    [{ receiptName: 'x', brandColor: '#4FC495' }, 'هذا اللون صعب القراءة مع النص الأبيض. اختر لوناً أغمق'],
    [{ receiptName: 'x', brandColor: 'green' }, 'اكتب اللون بصيغة ‎#RRGGBB'],
    [{ receiptName: 'x', governorate: 'beirut' }, 'اختر المحافظة'],
  ])('refuses %j', (input, message) => {
    expect(firstMessage(storeStepFields.safeParse(input))).toBe(message);
  });

  it('keeps the field path and message through the skip wrapper', () => {
    expect(storeStepInput.safeParse({ receiptName: 'x', phone: 'abc' }).error?.issues[0]).toMatchObject({
      path: ['phone'],
      message: 'رقم الهاتف غير صحيح. مثال: 0944123456',
    });
  });

  it('lists the 14 governorates', () => {
    expect(GOVERNORATE_KEYS).toHaveLength(14);
    expect(GOVERNORATE_KEYS).toContain('raqqa');
  });
});

describe('normalizeShopPhone', () => {
  it.each([
    ['0944 123 456', '0944123456'],
    ['(022) 21-45-67', '022214567'],
    ['+963 22 214 567', '+96322214567'],
    ['٠٢٢٢١٤٥٦٧', '022214567'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeShopPhone(input)).toBe(expected);
  });

  it.each(['12345', '1'.repeat(16), '09x4', '09+44123456', '+', ''])('refuses %j', (input) => {
    expect(normalizeShopPhone(input)).toBeNull();
  });
});

describe('colours', () => {
  it('computes WCAG contrast as the design board shows it', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(contrastRatio('#008157', '#FFFFFF')).toBeCloseTo(4.9, 1);
    expect(contrastRatio('#FFFFFF', '#008157')).toBe(contrastRatio('#008157', '#FFFFFF'));
    expect(contrastRatio('#4FC495', '#FFFFFF')).toBeLessThan(BRAND_COLOR_MIN_CONTRAST);
  });

  it('parses #RRGGBB only, in either case', () => {
    expect(parseHexColor('#00ff7F')).toEqual([0, 255, 127]);
    for (const bad of ['#00ff7', '00ff7f0', '#00ff7g', '#00FF7F00', ''])
      expect(parseHexColor(bad)).toBeNull();
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow(RangeError);
  });

  it('upper-cases a valid colour', () => {
    expect(storeStepFields.parse({ receiptName: 'x', brandColor: ' #00815a ' }).brandColor).toBe('#00815A');
  });

  it('accepts exactly the colours with at least 4.5:1 against white', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), (n) => {
        const hex = `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
        const ok = storeStepFields.safeParse({ receiptName: 'x', brandColor: hex }).success;
        expect(ok).toBe(contrastRatio(hex, '#FFFFFF') >= BRAND_COLOR_MIN_CONTRAST);
      }),
    );
  });
});

describe('step 4: currency', () => {
  it('defaults to pounds with dollar prices at the platform rate, tax inclusive', () => {
    expect(currencyStepInput.parse({})).toEqual({
      baseCurrency: 'SYP',
      usdPrices: true,
      usdRate: null,
      taxInclusive: true,
    });
  });

  it('reads the rate as typed, Arabic digits too', () => {
    expect(currencyStepInput.parse({ usdRate: '١٣٠' })).toMatchObject({ usdRate: '130' });
    expect(currencyStepInput.parse({ usdRate: '130.25', usdPrices: false })).toMatchObject({
      usdRate: '130.25',
      usdPrices: false,
    });
    expect(currencyStepInput.parse({ skip: true })).toEqual({ skip: true });
  });

  it.each(['0', '-130', 'abc', '0.5', '1.1234567', ''])('refuses the rate %j', (usdRate) => {
    const result = currencyStepInput.safeParse({ usdRate });
    expect(result.success).toBe(false);
  });

  it('refuses the old pound as a base currency', () => {
    expect(currencyStepInput.safeParse({ baseCurrency: 'SYO' }).success).toBe(false);
  });
});

describe('the trial sale', () => {
  it('prices the board: a medium latte and a croissant are 190, 200 paid gives 10 back', () => {
    const input = {
      sector: 'cafe' as const,
      lines: [
        { itemKey: 'latte-m', qty: 1 },
        { itemKey: 'croissant', qty: 1 },
      ],
      paidMinor: 20_000,
    };
    expect(demoSaleInput.parse(input)).toEqual(input);
    const priced = priceDemoSale(input);
    expect(priced.totalMinor).toBe(19_000);
    expect(priced.lines.map((l) => [l.nameAr, l.totalMinor])).toEqual([
      ['لاتيه وسط', 12_000],
      ['كرواسون', 7_000],
    ]);
  });

  it('multiplies by the quantity and leaves unknown keys out of the price', () => {
    expect(priceDemoSale({ sector: 'cafe', lines: [{ itemKey: 'tea', qty: 3 }] }).totalMinor).toBe(12_000);
    expect(priceDemoSale({ sector: 'cafe', lines: [{ itemKey: 'nope', qty: 1 }] })).toEqual({
      lines: [],
      totalMinor: 0,
    });
    expect(priceDemoSale({ sector: 'kiosk' as never, lines: [{ itemKey: 'tea', qty: 1 }] }).totalMinor).toBe(
      0,
    );
  });

  it('refuses an item of another sector, too little cash, and an empty cart', () => {
    const wrong = demoSaleInput.safeParse({
      sector: 'cafe',
      lines: [{ itemKey: 'shirt-m-blue', qty: 1 }],
      paidMinor: 99_999,
    });
    expect(wrong.error?.issues[0]).toMatchObject({
      path: ['lines', 0, 'itemKey'],
      message: 'صنف تجريبي غير معروف',
    });
    const short = demoSaleInput.safeParse({
      sector: 'cafe',
      lines: [{ itemKey: 'espresso', qty: 2 }],
      paidMinor: 17_999,
    });
    expect(short.error?.issues[0]).toMatchObject({
      path: ['paidMinor'],
      message: 'المبلغ المدفوع أقل من المجموع',
    });
    expect(firstMessage(demoSaleInput.safeParse({ sector: 'cafe', lines: [], paidMinor: 0 }))).toBe(
      'اختر صنفاً',
    );
    expect(
      demoSaleInput.safeParse({ sector: 'cafe', lines: [{ itemKey: 'tea', qty: 0 }], paidMinor: 0 }).success,
    ).toBe(false);
  });
});

describe('the starter catalogue', () => {
  it('lists a sector page by page', () => {
    expect(starterCatalogQuery.parse({ sector: 'supermarket', limit: '100' })).toEqual({
      sector: 'supermarket',
      limit: 100,
    });
    expect(starterCatalogQuery.safeParse({}).success).toBe(false);
  });

  it('imports chosen items with the prices typed, cost optional', () => {
    expect(
      starterCatalogInput.parse({
        mode: 'items',
        items: [
          { starterItemId: ITEM_A, priceMinor: 26_000 },
          { starterItemId: ITEM_B, priceMinor: 12_000, costMinor: 10_000 },
        ],
      }),
    ).toEqual({
      mode: 'items',
      currency: 'SYP',
      items: [
        { starterItemId: ITEM_A, priceMinor: 26_000, costMinor: null },
        { starterItemId: ITEM_B, priceMinor: 12_000, costMinor: 10_000 },
      ],
    });
  });

  it('refuses an item without a price, a repeated item, or nothing chosen', () => {
    const one = (priceMinor: unknown) => ({ mode: 'items', items: [{ starterItemId: ITEM_A, priceMinor }] });
    expect(starterCatalogInput.safeParse(one(0)).success).toBe(false);
    expect(starterCatalogInput.safeParse(one(null)).success).toBe(false);
    expect(starterCatalogInput.safeParse(one(1.5)).success).toBe(false);
    expect(
      firstMessage(
        starterCatalogInput.safeParse({
          mode: 'items',
          items: [
            { starterItemId: ITEM_A, priceMinor: 1 },
            { starterItemId: ITEM_A, priceMinor: 2 },
          ],
        }),
      ),
    ).toBe('الصنف مكرر');
    expect(firstMessage(starterCatalogInput.safeParse({ mode: 'items', items: [] }))).toBe('اختر صنفاً');
  });

  it('adds or clears the demo items', () => {
    expect(starterCatalogInput.parse({ mode: 'demo' })).toEqual({ mode: 'demo' });
    expect(starterCatalogInput.parse({ mode: 'demo', sectors: ['cafe'] })).toEqual({
      mode: 'demo',
      sectors: ['cafe'],
    });
    expect(starterCatalogInput.parse({ mode: 'clear_demo' })).toEqual({ mode: 'clear_demo' });
    expect(starterCatalogInput.safeParse({ mode: 'everything' }).success).toBe(false);
  });
});

describe('PATCH /v1/settings/features', () => {
  it('takes the full lists with the version', () => {
    expect(
      updateStoreFeaturesInput.parse({
        version: 3,
        sectors: ['clothing', 'cafe'],
        enabledFeatures: ['variants'],
      }),
    ).toEqual({ version: 3, sectors: ['clothing', 'cafe'], enabledFeatures: ['variants'] });
  });

  it('refuses no sector, or no version', () => {
    expect(updateStoreFeaturesInput.safeParse({ version: 3, sectors: [], enabledFeatures: [] }).success).toBe(
      false,
    );
    expect(updateStoreFeaturesInput.safeParse({ sectors: ['cafe'], enabledFeatures: [] }).success).toBe(
      false,
    );
  });
});
