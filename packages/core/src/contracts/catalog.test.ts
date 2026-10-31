import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors';
import {
  barcodeCodeSchema,
  CATALOG_PULL_SETS,
  createCategoryInput,
  createProductInput,
  createTaxRateInput,
  createUnitInput,
  productListQuery,
  updateCategoryInput,
  updateProductInput,
  type CreateProductInput,
  type PullSetRows,
} from './catalog';

const CATEGORY = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';
const VARIANT = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02';

const kettle = (): CreateProductInput => ({
  nameAr: 'غلاية كهربائية ستانلس 1.7 لتر',
  categoryId: CATEGORY,
  variants: [
    {
      price: { currency: 'SYP', priceMinor: 455000 },
      minPriceMinor: 420000,
      barcodes: [
        { kind: 'standard', code: '6970123450011' },
        {
          kind: 'standard',
          code: '16970123450018',
          packQty: 4000,
          packName: 'كرتونة',
          packPriceMinor: 1456000,
        },
        { kind: 'internal' },
      ],
    },
  ],
});

const fieldErrors = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.map(String).join('.'), i.message]));

describe('createProductInput', () => {
  it('takes a simple product with its packs and fills the defaults', () => {
    const parsed = createProductInput.parse(kettle());
    expect(parsed).toMatchObject({
      nameEn: null,
      brand: null,
      type: 'stock',
      taxRateId: null,
      sellOnPos: true,
    });
    expect(parsed.unitId).toBeUndefined();
    expect(parsed.variants[0]!.attributes).toEqual([]);
    expect(parsed.variants[0]!.barcodes[0]).toMatchObject({
      packQty: 1000,
      packName: null,
      packPriceMinor: null,
    });
    expect(parsed.variants[0]!.barcodes[1]).toMatchObject({ packQty: 4000, packName: 'كرتونة' });
  });

  it('takes a dollar price and a 2 × 2 shirt matrix (23 › المنتجات)', () => {
    const variant = (size: string, color: string, code: string) => ({
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: color },
      ],
      price: { currency: 'USD' as const, priceMinor: 1500 },
      barcodes: [{ kind: 'standard' as const, code }],
    });
    const shirt = {
      nameAr: 'قميص قطني',
      variants: [
        variant('M', 'أبيض', '1001'),
        variant('L', 'أبيض', '1002'),
        variant('M', 'أزرق', '1003'),
        variant('L', 'أزرق', '1004'),
      ],
    };
    expect(createProductInput.safeParse(shirt).success).toBe(true);
  });

  it('reads Arabic digits in a barcode and drops spaces', () => {
    expect(barcodeCodeSchema.parse(' ٦٩٧٠١٢٣ ٤٥٠٠١١ ')).toBe('6970123450011');
    expect(barcodeCodeSchema.safeParse('12').success).toBe(false);
    expect(barcodeCodeSchema.safeParse('باركود').success).toBe(false);
  });

  it('answers in Arabic next to the field: no name, a barcode twice, two identical variants, no price', () => {
    const noName = createProductInput.safeParse({ ...kettle(), nameAr: '  ' });
    expect(fieldErrors(noName)).toEqual({ nameAr: 'اسم المنتج مطلوب' });

    const twice = kettle();
    twice.variants[0]!.barcodes!.push({ kind: 'standard', code: '6970123450011' });
    expect(fieldErrors(createProductInput.safeParse(twice))).toEqual({
      'variants.0.barcodes.3.code': 'الباركود مكرر في هذا المنتج',
    });

    const same = { nameAr: 'قميص', variants: [kettle().variants[0]!, kettle().variants[0]!] };
    same.variants = same.variants.map((v, i) => ({
      ...v,
      barcodes: [{ kind: 'standard' as const, code: `${i}000` }],
    }));
    expect(fieldErrors(createProductInput.safeParse(same))).toEqual({
      'variants.0.attributes': 'اختر المقاس أو اللون',
      'variants.1.attributes': 'اختر المقاس أو اللون',
    });
    const options = [{ name: 'اللون', value: 'أحمر' }];
    const dup = { nameAr: 'قميص', variants: same.variants.map((v) => ({ ...v, attributes: options })) };
    expect(fieldErrors(createProductInput.safeParse(dup))).toEqual({
      'variants.1.attributes': 'هذا المتغير مكرر',
    });

    expect(fieldErrors(createProductInput.safeParse({ nameAr: 'شاي', variants: [] }))).toEqual({
      variants: 'أضف سعراً واحداً على الأقل',
    });
  });

  it('refuses a price as a float, in the old pound, or negative, and a pack of zero', () => {
    const price = (p: unknown) =>
      createProductInput.safeParse({ nameAr: 'شاي', variants: [{ price: p }] }).success;
    expect(price({ currency: 'SYP', priceMinor: 12.5 })).toBe(false);
    expect(price({ currency: 'SYP_OLD', priceMinor: 100 })).toBe(false);
    expect(price({ currency: 'SYP', priceMinor: -1 })).toBe(false);
    expect(price({ currency: 'USD', priceMinor: 0 })).toBe(true);
    const zeroPack = kettle();
    zeroPack.variants[0]!.barcodes![1] = { kind: 'standard', code: '1234', packQty: 0 };
    expect(createProductInput.safeParse(zeroPack).success).toBe(false);
  });
});

describe('updateProductInput', () => {
  it('changes only what is sent: one price in place, a new variant, an archived one', () => {
    const parsed = updateProductInput.parse({
      version: 3,
      variants: [{ id: VARIANT, price: { currency: 'SYP', priceMinor: 460000 } }],
    });
    expect(parsed).toEqual({
      version: 3,
      variants: [{ id: VARIANT, price: { currency: 'SYP', priceMinor: 460000 } }],
    });
    expect(updateProductInput.parse({ version: 3, nameEn: '', brand: null })).toEqual({
      version: 3,
      nameEn: null,
      brand: null,
    });
    expect(
      updateProductInput.safeParse({ version: 3, variants: [{ id: VARIANT, archived: true }] }).success,
    ).toBe(true);
  });

  it('needs the version it was read at, and a price for a new variant', () => {
    expect(updateProductInput.safeParse({ nameAr: 'شاي' }).success).toBe(false);
    expect(fieldErrors(updateProductInput.safeParse({ version: 1, variants: [{ sku: 'X' }] }))).toEqual({
      'variants.0.price': 'السعر مطلوب',
    });
  });

  it('refuses a barcode twice across the variants it sends', () => {
    const barcodes = [{ kind: 'standard' as const, code: '6970123450011' }];
    const result = updateProductInput.safeParse({
      version: 1,
      variants: [
        { id: VARIANT, barcodes },
        { price: { currency: 'SYP', priceMinor: 1 }, barcodes },
      ],
    });
    expect(fieldErrors(result)).toEqual({ 'variants.1.barcodes.0.code': 'الباركود مكرر في هذا المنتج' });
  });
});

describe('lists, categories, units and tax rates', () => {
  it('reads the list query: Arabic digits, default status and page size, limit ≤ 200', () => {
    expect(productListQuery.parse({ q: '٦٩٧٠' })).toEqual({ q: '6970', status: 'active', limit: 50 });
    expect(productListQuery.parse({ q: '' }).q).toBeUndefined();
    expect(productListQuery.safeParse({ limit: '201' }).success).toBe(false);
    expect(productListQuery.parse({ limit: '20', status: 'archived' })).toMatchObject({
      limit: 20,
      status: 'archived',
    });
  });

  it('takes categories, units and tax rates', () => {
    expect(createCategoryInput.parse({ name: 'أدوات مطبخ' })).toEqual({
      name: 'أدوات مطبخ',
      parentId: null,
      sortOrder: 0,
    });
    expect(updateCategoryInput.safeParse({ version: 0, archived: true }).success).toBe(true);
    expect(createUnitInput.parse({ name: 'كيلو', symbol: 'كغ', allowsFraction: true })).toMatchObject({
      allowsFraction: true,
    });
    expect(
      createTaxRateInput.parse({ name: 'رسم الإنفاق الاستهلاكي', rateBp: 500, kind: 'consumption' }),
    ).toMatchObject({
      showOnReceipt: true,
    });
    expect(createTaxRateInput.safeParse({ name: 'x', rateBp: 10001, kind: 'sales' }).success).toBe(false);
  });

  it('has the stale_version error code for concurrent edits', () => {
    expect(ERROR_CODES).toContain('stale_version');
  });
});

describe('pull set rows', () => {
  it('names every catalog set, and none of their rows carries a cost', () => {
    expect(CATALOG_PULL_SETS).toEqual([
      'products',
      'variants',
      'prices',
      'barcodes',
      'categories',
      'units',
      'tax_rates',
      'stock_levels',
      'exchange_rates',
    ]);
    // A compile-time guard: no row type of a cashier set has a cost-like field.
    type CostKeys = {
      [S in keyof PullSetRows]: Extract<
        keyof PullSetRows[S],
        `${string}${'cost' | 'Cost' | 'margin' | 'Margin'}${string}`
      >;
    }[keyof PullSetRows];
    const noCost: [CostKeys] extends [never] ? true : false = true;
    expect(noCost).toBe(true);
  });
});
