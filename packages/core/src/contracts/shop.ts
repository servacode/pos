import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { phoneSchema } from './auth';
import { nonNegativeMinorSchema, uuidSchema, versionSchema } from './common';

/**
 * The online shop (26 › المتجر الإلكتروني), first step: the store's own link shows its goods, the
 * pictures, the sizes and colours on the shelf and the prices; the customer fills a cart and
 * «اطلب عبر واتساب» saves the order and opens WhatsApp on the store's number with it written out.
 *
 * Public, no sign-in (rate limited):
 *   GET  /v1/shop/{slug}                  → ShopHome
 *   GET  /v1/shop/{slug}/products/{id}    → ShopProduct
 *   POST /v1/shop/{slug}/orders           shopOrderInput → ShopOrderPlaced (201)
 *
 * The dashboard:
 *   GET  /v1/online-store                 settings.manage → OnlineStoreSettings
 *   PUT  /v1/online-store                 settings.manage onlineStoreInput → OnlineStoreSettings
 *   GET  /v1/online-orders[?status]       customers.view  → { items: OnlineOrder[] }
 *   POST /v1/online-orders/{id}/status    customers.view  { status, version } → OnlineOrder
 */

/** The identity's colour families a shop may take as its accent (emerald is the brand itself) */
export const SHOP_ACCENTS = ['emerald', 'teal', 'blue'] as const;
export type ShopAccent = (typeof SHOP_ACCENTS)[number];

const RESERVED = new Set(['admin', 'api', 'app', 'shop', 'serva', 'www', 'pos', 'login', 'help']);

/** Small Latin letters, digits and dashes, 3 to 40, not starting or ending with a dash (no regex). */
export function isShopSlug(slug: string): boolean {
  if (slug.length < 3 || slug.length > 40 || slug.startsWith('-') || slug.endsWith('-')) return false;
  for (const c of slug) {
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return false;
  }
  return true;
}

export const shopSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isShopSlug, 'من 3 إلى 40 حرفاً إنجليزياً صغيراً أو رقماً أو شرطة، مثل nour-fashion')
  .refine((s) => !RESERVED.has(s), 'هذا الاسم محجوز، اختر غيره');

export const onlineStoreInput = z.object({
  version: versionSchema.nullable(),
  enabled: z.boolean(),
  slug: shopSlugSchema,
  whatsapp: phoneSchema.nullable(),
  delivery: z.boolean(),
  pickup: z.boolean(),
  note: z.string().trim().max(300).nullable(),
  showOutOfStock: z.boolean(),
  /** whatsapp: «اطلب عبر واتساب»; shop: placed in the shop, the phone confirmed by a code */
  orderMode: z.enum(['whatsapp', 'shop']).default('whatsapp'),
  /**
   * «اعرض الأسعار في المتجر الإلكتروني»: off, the public shop sends no price at all (the pieces and
   * their availability only) and an order is an inquiry the store prices later.
   */
  showPrices: z.boolean().default(true),
  /**
   * «أجرة التوصيل» (03 › الألبسة): added to a delivered order for the customer to pay the courier, not
   * a sale of the store. With areas, the customer picks one and pays its fee; otherwise the flat fee.
   */
  deliveryFeeMinor: nonNegativeMinorSchema.default(0),
  deliveryAreas: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'اكتب اسم المنطقة').max(40),
        feeMinor: nonNegativeMinorSchema,
      }),
    )
    .max(40)
    .refine((a) => new Set(a.map((x) => x.name)).size === a.length, 'كل منطقة مرة واحدة')
    .default([]),
  /** «عبارة قصيرة» under the store's name in the header and in the shared preview */
  tagline: z.string().trim().max(80, 'العبارة طويلة').nullable().default(null),
  /** The colour family of the shop's buttons: only the identity's own, never a free colour */
  accent: z.enum(SHOP_ACCENTS).default('emerald'),
});
export type OnlineStoreInput = z.input<typeof onlineStoreInput>;

export interface OnlineStoreSettings {
  /** Null until the owner first saves */
  version: number | null;
  enabled: boolean;
  slug: string;
  whatsapp: string | null;
  delivery: boolean;
  pickup: boolean;
  note: string | null;
  showOutOfStock: boolean;
  orderMode: 'whatsapp' | 'shop';
  showPrices: boolean;
  deliveryFeeMinor: number;
  deliveryAreas: DeliveryArea[];
  tagline?: string | null;
  accent?: ShopAccent;
  /** The logo and the cover banner (the pictures of the store); null: none */
  logoUrl?: string | null;
  coverUrl?: string | null;
}

export interface DeliveryArea {
  name: string;
  feeMinor: number;
}

export interface ShopStore {
  name: string;
  slug: string;
  currency: CurrencyCode;
  /** Digits only, for https://wa.me/… */
  whatsapp: string | null;
  delivery: boolean;
  pickup: boolean;
  note: string | null;
  orderMode: 'whatsapp' | 'shop';
  /** False: no price is sent anywhere in the public shop; the fees below are 0 then, not to be shown */
  showPrices: boolean;
  deliveryFeeMinor: number;
  deliveryAreas: DeliveryArea[];
  tagline?: string | null;
  accent?: ShopAccent;
  logoUrl?: string | null;
  coverUrl?: string | null;
}

export interface ShopProductCard {
  id: string;
  name: string;
  categoryId: string | null;
  imageUrl: string | null;
  currency: CurrencyCode;
  /** Null when the store hides its prices (showPrices false) */
  priceMinor: number | null;
  /** Above priceMinor when the pieces cost differently; null when prices are hidden */
  maxPriceMinor: number | null;
  /** The cheapest piece's price before its markdown or offer, struck through; null: none */
  wasPriceMinor: number | null;
  /** The running offer's name («تنزيلات الصيف −30٪»); null: none */
  offer: string | null;
  available: boolean;
  /** When the piece was added to the catalogue: «الأحدث» */
  createdAt: string;
  /** The options of the pieces on the shelf («المقاس»، «اللون») with their values: the shop's filters */
  options: { name: string; values: string[] }[];
}

export interface ShopHome {
  store: ShopStore;
  categories: { id: string; name: string; parentId: string | null }[];
  products: ShopProductCard[];
}

export interface ShopProduct {
  id: string;
  name: string;
  categoryId: string | null;
  currency: CurrencyCode;
  showPrices: boolean;
  images: { url: string; thumbUrl: string; optionValue: string | null }[];
  /** The options of the pieces in order («المقاس»، «اللون») with their values */
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    label: string | null;
    attributes: { name: string; value: string }[];
    /** After a running percent offer, as the order is priced; null when prices are hidden */
    priceMinor: number | null;
    /** Before the markdown or offer, struck through; null: none */
    wasPriceMinor: number | null;
    available: boolean;
    /** «بقي 2 فقط»: the pieces left, only when 3 or fewer are (the shop never gives a bigger count) */
    left: number | null;
  }[];
  /** The running offer's name on any of its pieces; null: none */
  offer: string | null;
  /** Plain text the store wrote for the page (shown as text, never as markup); null: none */
  description?: string | null;
  sizeGuide?: string | null;
}

export const MAX_ORDER_LINES = 30;

export const shopOrderInput = z.object({
  name: z.string().trim().min(2, 'اكتب الاسم').max(80),
  phone: phoneSchema,
  fulfilment: z.enum(['delivery', 'pickup']),
  address: z.string().trim().max(300).nullable().default(null),
  /** The delivery area, when the store charges by area */
  area: z.string().trim().max(40).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
  lines: z
    .array(z.object({ variantId: uuidSchema, qty: z.int().min(1).max(50) }))
    .min(1, 'السلة فارغة')
    .max(MAX_ORDER_LINES),
  /** In «من المتجر مباشرة»: the code sent to the phone (POST /v1/shop/{slug}/orders/code) */
  challengeId: uuidSchema.optional(),
  code: z.string().trim().min(4).max(8).optional(),
  /** «كود الخصم» typed in the cart; checked by the server, applied at the till when the order is sold */
  coupon: z.string().trim().max(20).nullable().default(null),
});
export type ShopOrderInput = z.input<typeof shopOrderInput>;

/**
 *   POST /v1/shop/{slug}/orders/code   { phone } → ShopCodeSent   (the shop's order mode is «shop»)
 *   GET  /v1/shop/{slug}/orders/{token}            → ShopOrderTrack
 *   POST /v1/shop/{slug}/orders/{token}/cancel-request → ShopOrderTrack   (a pending order only)
 */
export const shopCodeInput = z.object({ phone: phoneSchema });
export interface ShopCodeSent {
  challengeId: string;
  expiresIn: number;
  /** The local server's test mode only: no message is sent there */
  testCode?: string;
}

/**
 *   GET  /v1/shop/{slug}/coupon?code=…                 → ShopCoupon   (the code of a running offer, else 400)
 *   POST /v1/shop/{slug}/products/{id}/notify  { variantId, phone } → 204   («أبلغني عند التوفر»)
 */
export const shopCouponQuery = z.object({ code: z.string().trim().min(1).max(20) });
export interface ShopCoupon {
  /** The offer the code opens: «خصم 10٪ على الصيفي» */
  name: string;
  /** Null when the store hides its prices, or the offer is a buy-and-get one */
  percentBp: number | null;
}
export const stockAlertInput = z.object({ variantId: uuidSchema, phone: phoneSchema });

export interface ShopOrderTrack {
  number: string;
  status: OnlineOrderStatus;
  /** «خرج للتوصيل» / «سُلّم» (apart from the sale at the till); null: not yet */
  deliveryStage?: DeliveryStage | null;
  /** The coupon the order carries, when it has one */
  coupon?: string | null;
  customerName: string;
  fulfilment: 'delivery' | 'pickup';
  /** The delivery area the customer picked; null: none (or a pickup) */
  area: string | null;
  currency: CurrencyCode;
  /** Prices are null when the store hides them (showPrices false) */
  showPrices: boolean;
  /** The pieces; the delivery fee is on top, for the courier */
  totalMinor: number | null;
  deliveryFeeMinor: number | null;
  lines: { name: string; label: string | null; qty: number; totalMinor: number | null }[];
  createdAt: string;
}

export interface ShopOrderPlaced {
  /** The customer's own page for the order, in the shop: /shop/{slug}/o/{token} */
  trackPath: string;
  number: string;
  currency: CurrencyCode;
  showPrices: boolean;
  /** The pieces; null when the store hides its prices (it confirms the price later) */
  totalMinor: number | null;
  /** For the courier, on top of the pieces; null when prices are hidden */
  deliveryFeeMinor: number | null;
  /** The text WhatsApp opens with */
  message: string;
  /** https://wa.me/<number>?text=…, or null when the store has no WhatsApp number */
  whatsappUrl: string | null;
}

/**
 * cancel_requested: the customer asked, from the order's page, to cancel it while it was still
 * pending; the owner sees it in the orders box and agrees (rejected) or keeps the order (accepted).
 */
export const DELIVERY_STAGES = ['out', 'delivered'] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export const ONLINE_ORDER_STATUSES = ['pending', 'cancel_requested', 'accepted', 'rejected', 'done'] as const;
export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

export interface OnlineOrder {
  id: string;
  number: string;
  status: OnlineOrderStatus;
  /** hold: pieces held at the counter for a customer, with a deposit (03 › الألبسة: الحجز بعربون) */
  source: 'whatsapp' | 'shop' | 'hold';
  customerName: string;
  phone: string;
  fulfilment: 'delivery' | 'pickup';
  address: string | null;
  note: string | null;
  currency: CurrencyCode;
  totalMinor: number;
  /** A hold's deposit: the code of the voucher the customer paid it as, spent at pickup */
  depositCode: string | null;
  /** For the courier, on top of totalMinor; 0 for a pickup */
  deliveryFeeMinor: number;
  deliveryArea: string | null;
  lines: {
    variantId: string;
    productId: string;
    name: string;
    label: string | null;
    qty: number;
    priceMinor: number;
    totalMinor: number;
  }[];
  /** «خرج للتوصيل» (with the courier's name) then «سُلّم»; null: not out yet */
  deliveryStage?: DeliveryStage | null;
  courierName?: string | null;
  outAt?: string | null;
  deliveredAt?: string | null;
  /** The coupon the customer typed; the till applies its offer when it sells the order */
  couponCode?: string | null;
  createdAt: string;
  decidedAt: string | null;
  version: number;
}

/**
 * «التوصيل» (26 › حياة الطلب): a delivery order that is accepted (or already sold at the till) goes
 * out with a courier's name, then is delivered. Apart from the order's status and the sale: no
 * posting of its own, the money is the till sale's.
 *
 *   POST /v1/online-orders/{id}/delivery   customers.view  onlineOrderDeliveryInput → OnlineOrder
 *   GET  /v1/online-orders/cod             customers.view  → CodSummary
 */
export const onlineOrderDeliveryInput = z.discriminatedUnion('stage', [
  z.object({
    stage: z.literal('out'),
    courier: z.string().trim().min(1, 'اكتب اسم المندوب').max(60, 'الاسم طويل'),
    version: versionSchema,
  }),
  z.object({ stage: z.literal('delivered'), version: versionSchema }),
]);

export interface CodOrder {
  id: string;
  number: string;
  customerName: string;
  phone: string;
  address: string | null;
  deliveryArea: string | null;
  /** The pieces and the courier's fee: what the courier collects from the customer */
  collectMinor: number;
  outAt: string | null;
}

/** The orders out for delivery, by courier, with the cash each is expected to bring back */
export interface CodSummary {
  currency: CurrencyCode;
  couriers: { courier: string; expectedMinor: number; orders: CodOrder[] }[];
}

export const onlineOrderListQuery = z.object({ status: z.enum(ONLINE_ORDER_STATUSES).optional() });
export const onlineOrderStatusInput = z.object({
  status: z.enum(['accepted', 'rejected', 'done']),
  version: versionSchema,
});

/** The shape of core's PromotionRule without its clock: what the till needs of a coupon's offer */
export interface OrderCouponRule {
  id: string;
  name: string;
  kind: 'percent' | 'buy_get';
  percentBp: number | null;
  buyQty: number | null;
  getQty: number | null;
  scope: 'all' | 'categories' | 'products';
  categoryIds: string[];
  productIds: string[];
  couponCode: string;
}

/**
 * `online_orders` pulled to the tills of the branch that holds them (26 › حياة الطلب): the accepted
 * orders only, for the cashier to open into the cart and sell; a sold or rejected one leaves.
 */
export interface OnlineOrderRow {
  id: string;
  number: string;
  status: OnlineOrderStatus;
  customerName: string;
  phone: string;
  fulfilment: 'delivery' | 'pickup';
  address: string | null;
  note: string | null;
  currency: CurrencyCode;
  totalMinor: number;
  lines: OnlineOrder['lines'];
  depositCode: string | null;
  deliveryFeeMinor: number;
  deliveryArea: string | null;
  /** The offer the customer's code opened, as it was at the order: the till applies it when it sells it */
  couponRule?: OrderCouponRule | null;
  version: number;
}

/**
 * «احجز» at the till (03 › الألبسة: الحجز بعربون): the cart held for a customer. The deposit is
 * sold first as a voucher (GFT), its code kept on the hold and offered at pickup; the hold is an
 * accepted order of this branch, so its pieces are held and it waits on the tills like a shop order.
 *
 *   POST /v1/device/holds   (Authorization: Device)   holdInput → HoldPlaced (201)
 */
export const holdInput = z.object({
  customerName: z.string().trim().min(1, 'اكتب اسم الزبون').max(80),
  phone: phoneSchema,
  note: z.string().trim().max(300).nullable().optional(),
  depositCode: z.string().trim().min(1).max(40).nullable(),
  lines: z
    .array(z.object({ variantId: uuidSchema, qty: z.int().min(1).max(50) }))
    .min(1, 'السلة فارغة')
    .max(MAX_ORDER_LINES),
});
export interface HoldPlaced {
  id: string;
  number: string;
  currency: CurrencyCode;
  totalMinor: number;
}

/**
 * «وصف المنتج ودليل المقاسات» (26 › المتجر الإلكتروني): plain text the shop's product page shows,
 * edited on the product's page. Text only: line breaks stay, markup is shown as typed, never run.
 *
 *   GET /v1/products/{id}/shop-text   catalog.manage → ProductTexts
 *   PUT /v1/products/{id}/shop-text   catalog.manage productTextsInput → ProductTexts
 */
export const productTextsInput = z.object({
  description: z.string().max(4000, 'الوصف طويل').nullable(),
  sizeGuide: z.string().max(2000, 'دليل المقاسات طويل').nullable(),
});
export interface ProductTexts {
  description: string | null;
  sizeGuide: string | null;
}

/**
 * «أبلغني عند التوفر»: the phones customers left on the out-of-stock pieces of a product.
 *
 *   GET  /v1/products/{id}/stock-alerts   catalog.manage → { items: StockAlert[] }
 *   POST /v1/stock-alerts/{id}/notified   catalog.manage → StockAlert   (the owner wrote to them)
 */
export interface StockAlert {
  id: string;
  variantId: string;
  /** «M / أحمر» */
  variantLabel: string | null;
  phone: string;
  createdAt: string;
  notifiedAt: string | null;
  /** The piece is on the shelf again: time to write to them */
  inStock: boolean;
}

/**
 * «سجل تغيير الأسعار»: who changed a price, when, from what to what and from where, read from the
 * audit trail (price.changed, product.updated, prices.list_applied, prices.bulk_changed).
 *
 *   GET /v1/price-history[?productId&from&to&limit]   catalog.manage → { items: PriceChange[] }
 */
export const priceHistoryQuery = z.object({
  productId: uuidSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});
export type PriceChangeSource = 'product_edit' | 'price_list' | 'bulk' | 'price_list_summary';
export interface PriceChange {
  id: string;
  at: string;
  userName: string | null;
  source: PriceChangeSource;
  productId: string | null;
  productName: string | null;
  variantLabel: string | null;
  /** The piece's price currency now; null on a summary row */
  currency: CurrencyCode | null;
  /** Null on a summary row (a bulk change or a price list applied, with its count in `note`) */
  oldMinor: number | null;
  newMinor: number | null;
  note: string | null;
}
