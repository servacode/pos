import { z } from 'zod';
import { normalizeArabic } from '../text';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Importing a store's data from a spreadsheet (docs/specs/05-migration.md › ملفات Excel), and taking
 * all of it out again (docs/specs/24-legal.md: «بياناتك ملكك»).
 *
 * The browser reads the .xlsx or .csv file, the owner maps its columns to the fields below, and the
 * rows travel as they were typed in the file (text and numbers): every rule about them lives on the
 * server, in one place, in Arabic. One request is one chunk of at most IMPORT_CHUNK_MAX rows in one
 * transaction; a bad row is rolled back alone and named in the answer, the rest of the chunk stands.
 *
 *   POST /v1/import   importInput → ImportResponse     (permission by type, below)
 *   GET  /v1/export   → application/zip (streamed)      (the owner)
 *
 * `mode: 'dry_run'` runs exactly the code of the real import and rolls it back, so what it reports
 * (new, updated, skipped, refused, and why) is what the real run will do.
 *
 * Permissions: products catalog.manage (an opening quantity also needs inventory.adjust); customers
 * customers.manage; suppliers purchases.manage; an opening balance of either also accounting.post
 * (the owner's), because it posts a journal entry against 3900 الأرصدة الافتتاحية.
 */

export const IMPORT_TYPES = ['products', 'customers', 'suppliers'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  products: 'المنتجات',
  customers: 'الزبائن',
  suppliers: 'الموردون',
};

/** Rows in one request. A file of 20,000 rows is 40 requests. */
export const IMPORT_CHUNK_MAX = 500;
/** Rows in one file: more than this is split by the owner, not silently cut. */
export const IMPORT_FILE_MAX_ROWS = 20_000;

/** A field of the import: what the server understands, and the headers that name it in other programs. */
export interface ImportFieldDef {
  key: string;
  /** Arabic name shown in the mapping step and in the template */
  label: string;
  /** Headers (Arabic and English) that are guessed to mean this field */
  aliases: readonly string[];
  required?: boolean;
  /** One line telling what to type, shown under the template */
  hint: string;
  /** A value for the template's sample row */
  example: string;
}

const PRODUCT_FIELDS: readonly ImportFieldDef[] = [
  {
    key: 'name',
    label: 'اسم المنتج',
    aliases: [
      'اسم المنتج',
      'اسم الصنف',
      'اسم المادة',
      'المادة',
      'الصنف',
      'المنتج',
      'الاسم',
      'اسم',
      'name',
      'product',
      'item',
      'item name',
      'product name',
      'description',
    ],
    required: true,
    hint: 'مطلوب. الصفوف التي لها الاسم نفسه ومقاس أو لون مختلف تصير متغيّرات منتج واحد',
    example: 'قميص قطن',
  },
  {
    key: 'nameEn',
    label: 'الاسم بالإنجليزية',
    aliases: [
      'الاسم الانجليزي',
      'الاسم الإنجليزي',
      'الاسم بالانجليزية',
      'الاسم اللاتيني',
      'name en',
      'english name',
      'name english',
      'latin name',
    ],
    hint: 'اختياري',
    example: 'Cotton shirt',
  },
  {
    key: 'barcode',
    label: 'الباركود',
    aliases: [
      'الباركود',
      'باركود',
      'رمز المادة',
      'رقم المادة',
      'كود',
      'الكود',
      'barcode',
      'bar code',
      'ean',
      'upc',
      'code',
      'item code',
      'gtin',
    ],
    hint: 'مفتاح التكرار: صنف باركوده موجود يُعدَّل أو يُتخطّى ولا يتكرر',
    example: '6291003011223',
  },
  {
    key: 'sku',
    label: 'رمز الصنف (SKU)',
    aliases: ['sku', 'رمز الصنف', 'رمز داخلي', 'الرمز', 'ref', 'reference'],
    hint: 'اختياري',
    example: 'SH-001',
  },
  {
    key: 'model',
    label: 'رمز الموديل',
    aliases: ['رمز الموديل', 'كود الموديل', 'الموديل', 'موديل', 'model', 'model code', 'style', 'style code'],
    hint: 'اختياري: الصفوف التي لها رمز الموديل نفسه تصير منتجاً واحداً بمقاسات وألوان',
    example: 'SH-001',
  },
  {
    key: 'season',
    label: 'الموسم/التشكيلة',
    aliases: ['الموسم', 'التشكيلة', 'الموسم/التشكيلة', 'موسم', 'season', 'collection'],
    hint: 'اختياري: صيف 2026، شتاء 2026…',
    example: 'صيف 2026',
  },
  {
    key: 'category',
    label: 'التصنيف',
    aliases: ['التصنيف', 'الفئة', 'المجموعة', 'القسم', 'النوع', 'category', 'group', 'department', 'family'],
    hint: 'يُنشأ التصنيف إن لم يكن موجوداً',
    example: 'ألبسة رجالية',
  },
  {
    key: 'brand',
    label: 'الماركة',
    aliases: ['الماركة', 'العلامة التجارية', 'الشركة المصنعة', 'الشركة', 'brand', 'manufacturer', 'maker'],
    hint: 'اختياري',
    example: 'سيرفا',
  },
  {
    key: 'unit',
    label: 'الوحدة',
    aliases: ['الوحدة', 'وحدة القياس', 'وحدة', 'unit', 'uom', 'unit of measure'],
    hint: 'اسم وحدة موجودة في المتجر (قطعة، كيلو…). الفارغ: قطعة',
    example: 'قطعة',
  },
  {
    key: 'tax',
    label: 'الضريبة',
    aliases: ['الضريبة', 'نسبة الضريبة', 'ضريبة', 'tax', 'vat', 'tax rate', 'tax %'],
    hint: 'اسم ضريبة موجودة في المتجر أو نسبتها (11). الفارغ: بلا ضريبة',
    example: '',
  },
  {
    key: 'price',
    label: 'سعر البيع',
    aliases: [
      'سعر البيع',
      'السعر',
      'سعر',
      'سعر المفرق',
      'سعر المبيع',
      'مفرق',
      'بيع',
      'price',
      'sale price',
      'selling price',
      'retail',
      'retail price',
      'unit price',
    ],
    hint: 'مطلوب للمنتج الجديد. بعملة المتجر الأساسية ما لم تُحدَّد عملة',
    example: '85000',
  },
  {
    key: 'currency',
    label: 'عملة السعر',
    aliases: ['عملة السعر', 'العملة', 'currency', 'cur'],
    hint: 'SYP أو USD. الفارغ: عملة المتجر الأساسية',
    example: 'SYP',
  },
  {
    key: 'wholesalePrice',
    label: 'سعر الجملة',
    aliases: ['سعر الجملة', 'الجملة', 'جملة', 'wholesale', 'wholesale price'],
    hint: 'اختياري',
    example: '75000',
  },
  {
    key: 'cost',
    label: 'التكلفة',
    aliases: [
      'التكلفة',
      'الكلفة',
      'سعر الشراء',
      'سعر التكلفة',
      'سعر الكلفة',
      'شراء',
      'تكلفة',
      'cost',
      'purchase price',
      'buy price',
      'cost price',
    ],
    hint: 'كلفة القطعة بعملة المتجر الأساسية؛ تُستعمل لقيمة المخزون الافتتاحي فقط',
    example: '60000',
  },
  {
    key: 'quantity',
    label: 'الكمية الافتتاحية',
    aliases: [
      'الكمية',
      'الكمية الافتتاحية',
      'كمية',
      'المخزون',
      'الرصيد',
      'رصيد المادة',
      'رصيد',
      'quantity',
      'qty',
      'stock',
      'on hand',
      'opening stock',
      'opening qty',
    ],
    hint: 'تدخل المخزون برصيد افتتاحي في الفرع المختار؛ الصنف الذي له حركة مخزون سابقة لا تُلمس كميته',
    example: '24',
  },
  {
    key: 'batch',
    label: 'رقم الدفعة',
    aliases: ['رقم الدفعة', 'الدفعة', 'دفعة', 'باتش', 'batch', 'batch no', 'batch number', 'lot', 'lot no'],
    hint: 'اختياري: دفعة الكمية الافتتاحية. دفعة ثانية لنفس الصنف: سطر آخر بالباركود نفسه ودفعته وكميته',
    example: 'B-2406',
  },
  {
    key: 'expiry',
    label: 'تاريخ الانتهاء',
    aliases: [
      'تاريخ الانتهاء',
      'تاريخ الصلاحية',
      'الانتهاء',
      'الصلاحية',
      'انتهاء الصلاحية',
      'expiry',
      'expiry date',
      'expiration',
      'expiration date',
      'exp',
      'exp date',
    ],
    hint: 'اختياري: تاريخ انتهاء دفعة الكمية الافتتاحية (2027-06-30 أو 30/6/2027)',
    example: '2027-06-30',
  },
  {
    key: 'serials',
    label: 'الأرقام التسلسلية',
    aliases: [
      'الأرقام التسلسلية',
      'الارقام التسلسلية',
      'الرقم التسلسلي',
      'رقم تسلسلي',
      'ارقام IMEI',
      'serials',
      'serial',
      'serial number',
      'serial numbers',
      'imei',
    ],
    hint: 'للصنف ذي الأرقام: رقم لكل قطعة من الكمية الافتتاحية، يفصل بينها فاصلة أو سطر جديد',
    example: '',
  },
  {
    key: 'size',
    label: 'المقاس',
    aliases: ['المقاس', 'القياس', 'مقاس', 'size'],
    hint: 'اختياري: يجعل الصف متغيّراً من منتج',
    example: 'L',
  },
  {
    key: 'colour',
    label: 'اللون',
    aliases: ['اللون', 'لون', 'colour', 'color'],
    hint: 'اختياري: يجعل الصف متغيّراً من منتج',
    example: 'أزرق',
  },
  {
    key: 'minStock',
    label: 'الحد الأدنى للمخزون',
    aliases: [
      'الحد الادنى',
      'الحد الأدنى',
      'حد الطلب',
      'الحد الأدنى للمخزون',
      'min stock',
      'minimum',
      'reorder level',
      'min qty',
    ],
    hint: 'اختياري',
    example: '5',
  },
  {
    key: 'packName',
    label: 'اسم العبوة',
    aliases: ['اسم العبوة', 'العبوة', 'نوع العبوة', 'الكرتونة', 'العلبة', 'pack', 'pack name', 'packaging'],
    hint: 'اختياري: علبة، كرتونة… عبوة الجملة التي تُباع وتُشترى بها (تلزمها كمية العبوة)',
    example: 'علبة',
  },
  {
    key: 'packQty',
    label: 'كمية العبوة',
    aliases: [
      'كمية العبوة',
      'عدد القطع في العبوة',
      'القطع في العبوة',
      'محتوى العبوة',
      'حجم العبوة',
      'عدد في العبوة',
      'pack qty',
      'pack quantity',
      'pack size',
      'units per pack',
      'qty per pack',
    ],
    hint: 'كم قطعة في العبوة (12 للعلبة من 12). أكبر من واحد',
    example: '12',
  },
  {
    key: 'packBarcode',
    label: 'باركود العبوة',
    aliases: [
      'باركود العبوة',
      'باركود العلبة',
      'باركود الكرتونة',
      'باركود الكرتون',
      'pack barcode',
      'carton barcode',
      'box barcode',
    ],
    hint: 'اختياري: الفارغ يولّد النظام باركوداً داخلياً للعبوة',
    example: '6291003011230',
  },
  {
    key: 'packPrice',
    label: 'سعر العبوة',
    aliases: [
      'سعر العبوة',
      'سعر العلبة',
      'سعر الكرتونة',
      'سعر الكرتون',
      'pack price',
      'carton price',
      'box price',
    ],
    hint: 'اختياري: سعر العبوة كاملة؛ الفارغ: كمية العبوة × سعر القطعة',
    example: '900000',
  },
  {
    key: 'warrantyMonths',
    label: 'الكفالة بالأشهر',
    aliases: [
      'الكفالة بالأشهر',
      'الكفالة',
      'مدة الكفالة',
      'كفالة',
      'الضمان',
      'مدة الضمان',
      'warranty',
      'warranty months',
    ],
    hint: 'اختياري: عدد الأشهر من يوم البيع (من 1 إلى 120)',
    example: '12',
  },
  {
    key: 'tracksSerial',
    label: 'له رقم تسلسلي',
    aliases: [
      'له رقم تسلسلي',
      'يحتاج رقم تسلسلي',
      'تتبع الأرقام التسلسلية',
      'تتبع IMEI',
      'tracks serial',
      'serial tracked',
      'track serial',
      'track imei',
    ],
    hint: 'اختياري: نعم للجوال والأجهزة التي تُباع كل قطعة منها برقمها؛ لا لغيرها',
    example: '',
  },
];

const CUSTOMER_FIELDS: readonly ImportFieldDef[] = [
  {
    key: 'name',
    label: 'اسم الزبون',
    aliases: [
      'اسم الزبون',
      'الزبون',
      'اسم العميل',
      'العميل',
      'الاسم',
      'اسم',
      'name',
      'customer',
      'customer name',
      'client',
    ],
    required: true,
    hint: 'مطلوب',
    example: 'أحمد الحلبي',
  },
  {
    key: 'phone',
    label: 'الجوال',
    aliases: [
      'الجوال',
      'رقم الجوال',
      'الموبايل',
      'موبايل',
      'الهاتف',
      'رقم الهاتف',
      'هاتف',
      'تلفون',
      'phone',
      'mobile',
      'tel',
      'telephone',
      'cell',
    ],
    hint: 'مفتاح التكرار: زبون رقمه موجود يُعدَّل أو يُتخطّى ولا يتكرر',
    example: '0912345678',
  },
  {
    key: 'taxNumber',
    label: 'الرقم الضريبي',
    aliases: ['الرقم الضريبي', 'رقم ضريبي', 'tax number', 'tax id', 'vat number'],
    hint: 'اختياري',
    example: '',
  },
  {
    key: 'address',
    label: 'العنوان',
    aliases: ['العنوان', 'عنوان', 'address', 'location'],
    hint: 'اختياري',
    example: 'حلب، الفرقان',
  },
  {
    key: 'notes',
    label: 'ملاحظات',
    aliases: ['ملاحظات', 'ملاحظة', 'notes', 'note', 'remarks', 'comment'],
    hint: 'اختياري',
    example: '',
  },
  {
    key: 'creditLimit',
    label: 'حد الدين',
    aliases: ['حد الدين', 'سقف الدين', 'حد الائتمان', 'سقف الائتمان', 'credit limit', 'limit'],
    hint: 'أقصى ما يجوز أن يدينه الزبون؛ الفارغ: بلا حد',
    example: '500000',
  },
  {
    key: 'priceTier',
    label: 'نوع السعر',
    aliases: ['نوع السعر', 'فئة السعر', 'زبون جملة', 'price tier', 'tier'],
    hint: 'جملة أو مفرق (مفرق إن ترك فارغاً)',
    example: 'مفرق',
  },
  {
    key: 'balance',
    label: 'الرصيد الافتتاحي',
    aliases: [
      'الرصيد',
      'الرصيد الافتتاحي',
      'رصيد',
      'رصيد الزبون',
      'المبلغ المستحق',
      'الذمم',
      'مدين',
      'balance',
      'opening balance',
      'debt',
      'owes',
    ],
    hint: 'ما على الزبون للمتجر (موجب)، أو للزبون على المتجر (سالب). للمالك فقط، ويُقيَّد مقابل 3900',
    example: '150000',
  },
];

const SUPPLIER_FIELDS: readonly ImportFieldDef[] = [
  {
    key: 'name',
    label: 'اسم المورد',
    aliases: [
      'اسم المورد',
      'المورد',
      'الموردين',
      'اسم الشركة',
      'الاسم',
      'اسم',
      'name',
      'supplier',
      'supplier name',
      'vendor',
    ],
    required: true,
    hint: 'مطلوب',
    example: 'شركة النور للتجارة',
  },
  {
    key: 'phone',
    label: 'الجوال',
    aliases: [
      'الجوال',
      'رقم الجوال',
      'الموبايل',
      'موبايل',
      'الهاتف',
      'رقم الهاتف',
      'هاتف',
      'تلفون',
      'phone',
      'mobile',
      'tel',
      'telephone',
      'cell',
    ],
    hint: 'مفتاح التكرار: مورد رقمه موجود يُعدَّل أو يُتخطّى ولا يتكرر',
    example: '0933123456',
  },
  {
    key: 'notes',
    label: 'ملاحظات',
    aliases: ['ملاحظات', 'ملاحظة', 'العنوان', 'notes', 'note', 'address', 'remarks'],
    hint: 'اختياري',
    example: '',
  },
  {
    key: 'balance',
    label: 'الرصيد الافتتاحي',
    aliases: [
      'الرصيد',
      'الرصيد الافتتاحي',
      'رصيد',
      'رصيد المورد',
      'المبلغ المستحق',
      'الذمم',
      'دائن',
      'balance',
      'opening balance',
      'payable',
      'we owe',
    ],
    hint: 'ما على المتجر للمورد (موجب)، أو للمتجر عند المورد (سالب). للمالك فقط، ويُقيَّد مقابل 3900',
    example: '2000000',
  },
];

export const IMPORT_FIELDS: Record<ImportType, readonly ImportFieldDef[]> = {
  products: PRODUCT_FIELDS,
  customers: CUSTOMER_FIELDS,
  suppliers: SUPPLIER_FIELDS,
};

/** The key of a branch's own opening-quantity column: «qty:<branch id>». */
export const BRANCH_QTY_PREFIX = 'qty:';
export const branchQtyKey = (branchId: string) => `${BRANCH_QTY_PREFIX}${branchId}`;

/** A header as compared: folded Arabic letters, Latin lower case, punctuation turned to spaces. */
function headerKey(header: string): string {
  return normalizeArabic(header)
    .replace(/[_\-./\\:()[\]{}*#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The field a column header most probably means: its exact name or alias first, then a header that
 * contains an alias of three letters or more. A field is guessed once (the first column wins).
 * Pure, so the wizard and its tests share it.
 */
export function guessImportFields(type: ImportType, headers: readonly string[]): (string | null)[] {
  const fields = IMPORT_FIELDS[type];
  const keyed = headers.map(headerKey);
  const guess: (string | null)[] = headers.map(() => null);
  const taken = new Set<string>();
  const take = (index: number, key: string) => {
    guess[index] = key;
    taken.add(key);
  };
  // Exact names first, so «سعر الشراء» is the cost although it also contains «سعر»
  for (const [index, header] of keyed.entries()) {
    if (header === '') continue;
    const field = fields.find(
      (f) =>
        !taken.has(f.key) &&
        (headerKey(f.label) === header || f.aliases.some((alias) => headerKey(alias) === header)),
    );
    if (field) take(index, field.key);
  }
  // Then headers that carry an alias («سعر البيع بالليرة»), longest alias first
  const aliases = fields
    .flatMap((f) => f.aliases.map((alias) => ({ key: f.key, alias: headerKey(alias) })))
    .filter((a) => a.alias.length >= 3)
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const [index, header] of keyed.entries()) {
    if (guess[index] !== null || header === '') continue;
    const hit = aliases.find((a) => !taken.has(a.key) && header.includes(a.alias));
    if (hit) take(index, hit.key);
  }
  return guess;
}

// ─── Request ─────────────────────────────────────────────────────────────────

const FIELD_KEY = /^[a-zA-Z]+(:[0-9a-f-]{36})?$/;

/** A cell as it was in the file: text or a number (a date cell is sent as its ISO text). */
export const importCellSchema = z.union([z.string().max(300), z.number().finite(), z.null()]);

export const importRowSchema = z.object({
  /** The row's number in the file, for the report */
  line: z.int().positive(),
  values: z.record(z.string().max(60).regex(FIELD_KEY), importCellSchema),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/** `skip` leaves a record that already exists as it is; `update` fills it with what the file has. */
export const IMPORT_EXISTING = ['skip', 'update'] as const;
export type ImportExisting = (typeof IMPORT_EXISTING)[number];

export const importInput = z.object({
  type: z.enum(IMPORT_TYPES),
  mode: z.enum(['dry_run', 'commit']),
  existing: z.enum(IMPORT_EXISTING).default('skip'),
  /** The date opening stock and opening balances are posted at (the day the store starts here) */
  date: isoDateSchema,
  /** The branch the «الكمية الافتتاحية» column goes to; omitted: the first branch */
  branchId: uuidSchema.optional(),
  rows: z
    .array(importRowSchema)
    .min(1, 'لا صفوف للاستيراد')
    .max(IMPORT_CHUNK_MAX, `${IMPORT_CHUNK_MAX} صف على الأكثر في الطلب الواحد`),
});
export type ImportInput = z.input<typeof importInput>;
export type ImportData = z.output<typeof importInput>;

// ─── Answer ──────────────────────────────────────────────────────────────────

/** What happens (or happened) to a row. */
export type ImportStatus = 'create' | 'update' | 'skip' | 'error';

export interface ImportIssue {
  /** The import field the message is about (a key of IMPORT_FIELDS), or `_` for the row as a whole */
  field: string;
  message: string;
}

export interface ImportRowResult {
  line: number;
  status: ImportStatus;
  /** Why the row is refused (status error), in Arabic */
  errors: ImportIssue[];
  /** Things worth knowing about a row that goes through («سيُنشأ تصنيف جديد») */
  notes: string[];
}

export interface ImportTotals {
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface ImportResponse {
  type: ImportType;
  mode: 'dry_run' | 'commit';
  results: ImportRowResult[];
  totals: ImportTotals;
}

export const emptyImportTotals = (): ImportTotals => ({ create: 0, update: 0, skip: 0, error: 0 });

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * What the export holds, in the order of the archive. `table` is the store's table; every column of
 * it is written (the secrets of a user — password and PIN hashes — are never in it).
 */
export const EXPORT_ENTITIES = [
  'settings',
  'branches',
  'users',
  'units',
  'tax_rates',
  'exchange_rates',
  'categories',
  'products',
  'variants',
  'prices',
  'barcodes',
  'stock_levels',
  'stock_movements',
  'customers',
  'suppliers',
  'invoices',
  'invoice_lines',
  'invoice_payments',
  'sale_returns',
  'sale_return_lines',
  'receipts',
  'purchases',
  'purchase_lines',
  'supplier_payments',
  'supplier_returns',
  'stocktakes',
  'transfers',
  'shifts',
  'cash_movements',
  'expenses',
  'accounts',
  'journal_entries',
  'journal_lines',
  'promotions',
  'vouchers',
  'serials',
] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

/** The archive's table of contents, `manifest.json` */
export interface ExportManifest {
  format: 'serva-export';
  version: 1;
  exportedAt: string;
  tenantId: string;
  /** Amounts are integers in the smallest unit of their currency (SYP and USD: hundredths); quantities in thousandths */
  amounts: 'minor-units';
  entities: { name: ExportEntity; rows: number }[];
}
