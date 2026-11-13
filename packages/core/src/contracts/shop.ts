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

export interface ShopOrderTrack {
  number: string;
  status: OnlineOrderStatus;
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
  createdAt: string;
  decidedAt: string | null;
  version: number;
}

export const onlineOrderListQuery = z.object({ status: z.enum(ONLINE_ORDER_STATUSES).optional() });
export const onlineOrderStatusInput = z.object({
  status: z.enum(['accepted', 'rejected', 'done']),
  version: versionSchema,
});

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
