import { and, asc, eq, inArray } from 'drizzle-orm';
import { normalizeArabic } from '@serva/core';
import {
  barcodes,
  branches,
  categories,
  exchangeRates,
  prices,
  products,
  stockLevels,
  tenants,
  units,
  variants,
  type Database,
} from '@serva/db';
import { ean13CheckDigit } from '../services/catalog/products';

/**
 * A demo catalog for the local server (`seed.ts --demo-catalog`): about 40 products of a Raqqa
 * supermarket with barcodes (GS1 Syria prefix 621, valid EAN-13), shelf prices in new pounds and
 * a few in dollars, packs, weighed produce in kg, opening stock in the main branch and a dollar
 * rate of 130. Runs as the owner role; idempotent: a product whose barcode exists is skipped.
 */

interface DemoItem {
  name: string;
  category: string;
  /** Minor units of the currency (130.00 ل.س = 13000) */
  price: number;
  currency?: 'SYP' | 'USD';
  /** Sold by weight in kg; gets an internal 29… barcode */
  weighed?: boolean;
  /** A pack barcode: base pieces in it and its price */
  pack?: { name: string; pieces: number; price: number };
}

export const DEMO_ITEMS: readonly DemoItem[] = [
  { name: 'سكر أبيض 1 كغ', category: 'مواد تموينية', price: 13_000 },
  { name: 'رز مصري 1 كغ', category: 'مواد تموينية', price: 18_000 },
  { name: 'رز بسمتي 5 كغ', category: 'مواد تموينية', price: 750, currency: 'USD' },
  { name: 'برغل خشن 1 كغ', category: 'مواد تموينية', price: 11_000 },
  { name: 'عدس أحمر 1 كغ', category: 'مواد تموينية', price: 16_000 },
  { name: 'حمص حب 1 كغ', category: 'مواد تموينية', price: 17_000 },
  { name: 'طحين زيرو 1 كغ', category: 'مواد تموينية', price: 9_000 },
  { name: 'زيت دوار الشمس 1 لتر', category: 'مواد تموينية', price: 22_000 },
  { name: 'سمن نباتي 1 كغ', category: 'مواد تموينية', price: 30_000 },
  { name: 'شاي أسود 400 غ', category: 'مواد تموينية', price: 325, currency: 'USD' },
  { name: 'قهوة مع هيل 250 غ', category: 'مواد تموينية', price: 35_000 },
  { name: 'ملح ناعم 500 غ', category: 'مواد تموينية', price: 2_500 },
  { name: 'معكرونة 500 غ', category: 'مواد تموينية', price: 8_000 },
  { name: 'لبن رائب 1 كغ', category: 'ألبان وأجبان', price: 12_000 },
  { name: 'حليب طويل الأجل 1 لتر', category: 'ألبان وأجبان', price: 14_000 },
  { name: 'جبنة بيضاء مشللة', category: 'ألبان وأجبان', price: 60_000, weighed: true },
  { name: 'لبنة 500 غ', category: 'ألبان وأجبان', price: 15_000 },
  { name: 'جبنة مثلثات 8 قطع', category: 'ألبان وأجبان', price: 12_500 },
  { name: 'زبدة 200 غ', category: 'ألبان وأجبان', price: 16_000 },
  {
    name: 'مياه معدنية 1.5 لتر',
    category: 'مشروبات',
    price: 3_000,
    pack: { name: 'شدّة 6', pieces: 6, price: 16_500 },
  },
  {
    name: 'كولا 330 مل',
    category: 'مشروبات',
    price: 4_500,
    pack: { name: 'كرتونة 24', pieces: 24, price: 100_000 },
  },
  { name: 'عصير برتقال 1 لتر', category: 'مشروبات', price: 15_000 },
  { name: 'متة 250 غ', category: 'مشروبات', price: 9_000 },
  { name: 'مشروب طاقة 250 مل', category: 'مشروبات', price: 100, currency: 'USD' },
  { name: 'معجون طماطم 800 غ', category: 'معلبات', price: 14_000 },
  { name: 'فول مدمس 400 غ', category: 'معلبات', price: 7_000 },
  { name: 'حمص مطحون 400 غ', category: 'معلبات', price: 7_500 },
  { name: 'تونة 160 غ', category: 'معلبات', price: 13_000 },
  { name: 'سردين 125 غ', category: 'معلبات', price: 9_500 },
  { name: 'مسحوق غسيل 3 كغ', category: 'منظفات', price: 600, currency: 'USD' },
  { name: 'سائل جلي 1 لتر', category: 'منظفات', price: 12_000 },
  { name: 'صابون غار حلبي', category: 'منظفات', price: 6_000 },
  { name: 'شامبو 400 مل', category: 'منظفات', price: 25_000 },
  { name: 'مناديل ورقية 500 منديل', category: 'منظفات', price: 9_000 },
  { name: 'ورق تواليت 6 لفات', category: 'منظفات', price: 18_000 },
  { name: 'بسكويت بالشاي', category: 'حلويات وسكاكر', price: 5_000 },
  { name: 'شوكولاتة بالحليب 100 غ', category: 'حلويات وسكاكر', price: 12_000 },
  { name: 'راحة بالفستق 500 غ', category: 'حلويات وسكاكر', price: 20_000 },
  { name: 'بندورة', category: 'خضار وفواكه', price: 7_000, weighed: true },
  { name: 'خيار', category: 'خضار وفواكه', price: 6_000, weighed: true },
  { name: 'بطاطا', category: 'خضار وفواكه', price: 5_000, weighed: true },
  { name: 'بصل', category: 'خضار وفواكه', price: 4_000, weighed: true },
  { name: 'تفاح', category: 'خضار وفواكه', price: 10_000, weighed: true },
  { name: 'موز', category: 'خضار وفواكه', price: 120, currency: 'USD', weighed: true },
];

/** A valid EAN-13 for item n: 621 (GS1 Syria), 9 digits, the check digit. */
const ean = (prefix: string, n: number) => {
  const body = `${prefix}${String(n).padStart(12 - prefix.length, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
};

export interface DemoResult {
  tenantId: string;
  created: number;
  skipped: number;
}

/** Picks the store: the one with this store code, or the only store on the server. */
export async function demoStore(db: Database, storeCode?: string): Promise<string> {
  const rows = await db
    .select({ id: tenants.id, code: tenants.storeCode, name: tenants.name })
    .from(tenants)
    .where(storeCode ? eq(tenants.storeCode, storeCode) : undefined);
  if (rows.length === 1) return rows[0]!.id;
  if (rows.length === 0) {
    throw new Error(
      storeCode
        ? `No store has the code ${storeCode}.`
        : 'No store yet: open an account first, then run this again.',
    );
  }
  throw new Error(
    `Several stores on this server; pick one with --store=<code>: ${rows.map((r) => `${r.code} (${r.name})`).join(', ')}`,
  );
}

export async function seedDemoCatalog(db: Database, tenantId: string): Promise<DemoResult> {
  return db.transaction(async (tx) => {
    const [main] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.tenantId, tenantId))
      .orderBy(asc(branches.code))
      .limit(1);
    const unitRows = await tx
      .select({ id: units.id, key: units.systemKey })
      .from(units)
      .where(eq(units.tenantId, tenantId));
    const piece = unitRows.find((u) => u.key === 'piece')?.id;
    const kg = unitRows.find((u) => u.key === 'kg')?.id;
    if (!main || !piece || !kg) throw new Error('The store is missing its main branch or its units.');

    const codes = DEMO_ITEMS.map((item, i) => (item.weighed ? ean('29', 9_000 + i) : ean('6210', 1_000 + i)));
    const taken = new Set(
      (
        await tx
          .select({ code: barcodes.code })
          .from(barcodes)
          .where(and(eq(barcodes.tenantId, tenantId), inArray(barcodes.code, codes)))
      ).map((b) => b.code),
    );

    const categoryIds = new Map<string, string>();
    for (const [order, name] of [...new Set(DEMO_ITEMS.map((i) => i.category))].entries()) {
      const [found] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.tenantId, tenantId), eq(categories.name, name)));
      const id =
        found?.id ??
        (
          await tx
            .insert(categories)
            .values({ tenantId, name, sortOrder: order })
            .returning({ id: categories.id })
        )[0]!.id;
      categoryIds.set(name, id);
    }

    let created = 0;
    for (const [i, item] of DEMO_ITEMS.entries()) {
      const code = codes[i]!;
      if (taken.has(code)) continue;
      const [product] = await tx
        .insert(products)
        .values({
          tenantId,
          nameAr: item.name,
          searchName: normalizeArabic(item.name),
          categoryId: categoryIds.get(item.category)!,
          unitId: item.weighed ? kg : piece,
        })
        .returning({ id: products.id });
      const [variant] = await tx
        .insert(variants)
        .values({ tenantId, productId: product!.id })
        .returning({ id: variants.id });
      await tx.insert(prices).values({
        tenantId,
        id: variant!.id,
        currency: item.currency ?? 'SYP',
        priceMinor: item.price,
      });
      await tx.insert(barcodes).values({
        tenantId,
        variantId: variant!.id,
        code,
        kind: item.weighed ? 'internal' : 'standard',
      });
      if (item.pack) {
        await tx.insert(barcodes).values({
          tenantId,
          variantId: variant!.id,
          code: ean('6211', 1_000 + i),
          kind: 'standard',
          packQty: item.pack.pieces * 1000,
          packName: item.pack.name,
          packPriceMinor: item.pack.price,
        });
      }
      // Opening stock: 5 to 60 pieces, or kilos of produce.
      await tx.insert(stockLevels).values({
        tenantId,
        branchId: main.id,
        variantId: variant!.id,
        qty: (5 + ((i * 7) % 56)) * 1000,
      });
      created += 1;
    }

    const [rate] = await tx
      .select({ id: exchangeRates.id })
      .from(exchangeRates)
      .where(eq(exchangeRates.tenantId, tenantId))
      .limit(1);
    if (!rate) await tx.insert(exchangeRates).values({ tenantId, unit: 'USD', quote: 'SYP', rate: '130' });

    return { tenantId, created, skipped: DEMO_ITEMS.length - created };
  });
}
