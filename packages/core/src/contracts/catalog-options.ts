import { z } from 'zod';

/**
 * «خيارات الأصناف» of the store (03 › الملابس):
 *
 *   PUT /v1/store/catalog-options   catalogOptionsSchema → StoreResponse (catalog.manage)
 *
 * autoBarcode: a barcode is made for every new variant that has none when a product is saved.
 * sizeRuns: the «طقم مقاسات» presets of the purchase grid: how many pieces of each size one run
 * holds, in the order of the grid's sizes (1-2-2-1 across S-M-L-XL).
 */
export const sizeRunSchema = z.object({
  name: z.string().trim().min(1, 'اكتب اسم الطقم').max(30, 'اسم الطقم طويل جداً'),
  counts: z
    .array(z.number().int().min(0).max(99))
    .min(1)
    .max(12)
    .refine((c) => c.some((n) => n > 0), 'اكتب عدد قطعة واحدة على الأقل'),
});
export type SizeRun = z.output<typeof sizeRunSchema>;

export const catalogOptionsSchema = z.object({
  autoBarcode: z.boolean(),
  sizeRuns: z.array(sizeRunSchema).max(10, 'عشرة أطقم على الأكثر'),
});
export type CatalogOptions = z.output<typeof catalogOptionsSchema>;

export const DEFAULT_SIZE_RUNS: SizeRun[] = [
  { name: 'طقم 1-2-2-1', counts: [1, 2, 2, 1] },
  { name: 'طقم 1-1-1-1', counts: [1, 1, 1, 1] },
];

export const DEFAULT_CATALOG_OPTIONS: CatalogOptions = { autoBarcode: false, sizeRuns: DEFAULT_SIZE_RUNS };

/** The store's options, the defaults where it never chose */
export const catalogOptionsOf = (o: Partial<CatalogOptions> | null | undefined): CatalogOptions => ({
  autoBarcode: o?.autoBarcode ?? DEFAULT_CATALOG_OPTIONS.autoBarcode,
  sizeRuns: o?.sizeRuns ?? DEFAULT_CATALOG_OPTIONS.sizeRuns,
});
