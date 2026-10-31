import type {
  Category,
  MeResponse,
  Permission,
  ProductDetail,
  ProductListItem,
  TaxRate,
  Unit,
  VariantDetail,
} from '@serva/core';
import { stripBidiControls } from '@serva/core';
import { makeMe } from './fixtures';

/** What a person reads: the text without the direction isolates amounts are wrapped in. */
export function shownText(element: Element | null | undefined): string {
  return stripBidiControls(element?.textContent ?? '');
}

// Catalog fixtures (packages/core › contracts/catalog.ts). Ids are real UUIDs: the screens check
// the request with the contract's zod schemas before sending it.

export const ids = {
  piece: '00000000-0000-4000-8000-000000000001',
  kilo: '00000000-0000-4000-8000-000000000002',
  tax: '00000000-0000-4000-8000-000000000003',
  dairy: '00000000-0000-4000-8000-0000000000a1',
  cheese: '00000000-0000-4000-8000-0000000000a2',
  cleaning: '00000000-0000-4000-8000-0000000000a3',
  milk: '00000000-0000-4000-8000-0000000000b1',
  milkVariant: '00000000-0000-4000-8000-0000000000c1',
  milkBarcode: '00000000-0000-4000-8000-0000000000d1',
  kettle: '00000000-0000-4000-8000-0000000000b2',
  white: '00000000-0000-4000-8000-0000000000c2',
  black: '00000000-0000-4000-8000-0000000000c3',
  other: '00000000-0000-4000-8000-0000000000b9',
  branch: 'branch-1',
} as const;

export const units: Unit[] = [
  {
    id: ids.piece,
    name: 'قطعة',
    symbol: 'قطعة',
    allowsFraction: false,
    isSystem: true,
    archivedAt: null,
    version: 1,
  },
  {
    id: ids.kilo,
    name: 'كيلو',
    symbol: 'كغ',
    allowsFraction: true,
    isSystem: true,
    archivedAt: null,
    version: 1,
  },
];

export const taxRates: TaxRate[] = [
  {
    id: ids.tax,
    name: 'رسم الاستهلاك',
    rateBp: 500,
    kind: 'consumption',
    showOnReceipt: true,
    archivedAt: null,
    version: 1,
  },
];

export function category(overrides: Partial<Category> = {}): Category {
  return {
    id: ids.dairy,
    name: 'ألبان وأجبان',
    parentId: null,
    sortOrder: 0,
    productCount: 12,
    archivedAt: null,
    version: 1,
    ...overrides,
  };
}

export const categories: Category[] = [
  category(),
  category({ id: ids.cheese, name: 'أجبان', parentId: ids.dairy, productCount: 4 }),
  category({ id: ids.cleaning, name: 'منظفات', sortOrder: 1, productCount: 0 }),
];

export function listItem(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: ids.milk,
    nameAr: 'حليب المراعي 1 لتر',
    nameEn: null,
    categoryId: ids.dairy,
    categoryName: 'ألبان وأجبان',
    type: 'stock',
    status: 'active',
    archivedAt: null,
    variantCount: 1,
    singleVariantId: ids.milkVariant,
    price: { currency: 'SYP', minMinor: 15000, maxMinor: 15000 },
    barcode: '6281007035105',
    stockQty: 94000,
    version: 3,
    ...overrides,
  };
}

export function variant(overrides: Partial<VariantDetail> = {}): VariantDetail {
  return {
    id: ids.milkVariant,
    sku: null,
    label: null,
    attributes: [],
    price: { currency: 'SYP', priceMinor: 15000 },
    minPriceMinor: null,
    minStockQty: null,
    priceChangedAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
    barcodes: [
      {
        id: ids.milkBarcode,
        code: '6281007035105',
        kind: 'standard',
        packQty: 1000,
        packName: null,
        packPriceMinor: null,
      },
    ],
    stock: [{ branchId: ids.branch, branchName: 'الفرع الرئيسي', qty: 94000, reservedQty: 0 }],
    ...overrides,
  };
}

export function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: ids.milk,
    nameAr: 'حليب المراعي 1 لتر',
    nameEn: null,
    categoryId: ids.dairy,
    brand: 'المراعي',
    type: 'stock',
    status: 'active',
    unitId: ids.piece,
    taxRateId: null,
    sellOnPos: true,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    version: 3,
    variants: [variant()],
    ...overrides,
  };
}

/** The owner, with the catalog (or a cashier-like user without it). */
export function catalogMe(permissions: Permission[] = ['catalog.manage', 'devices.view']): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions } };
}

/** The routes every catalog screen asks for, answered with the fixtures. */
export const lookupRoutes = {
  'GET /v1/units': { status: 200, body: { items: units } },
  'GET /v1/tax-rates': { status: 200, body: { items: taxRates } },
  'GET /v1/categories': { status: 200, body: { items: categories } },
};
