import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { phoneSchema } from './auth';
import { uuidSchema, versionSchema } from './common';

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
}

export interface ShopProductCard {
  id: string;
  name: string;
  categoryId: string | null;
  imageUrl: string | null;
  currency: CurrencyCode;
  priceMinor: number;
  /** Above priceMinor when the pieces cost differently */
  maxPriceMinor: number;
  available: boolean;
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
  images: { url: string; thumbUrl: string; optionValue: string | null }[];
  /** The options of the pieces in order («المقاس»، «اللون») with their values */
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    label: string | null;
    attributes: { name: string; value: string }[];
    priceMinor: number;
    available: boolean;
  }[];
}

export const MAX_ORDER_LINES = 30;

export const shopOrderInput = z.object({
  name: z.string().trim().min(2, 'اكتب الاسم').max(80),
  phone: phoneSchema,
  fulfilment: z.enum(['delivery', 'pickup']),
  address: z.string().trim().max(300).nullable().default(null),
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
  fulfilment: 'delivery' | 'pickup';
  currency: CurrencyCode;
  totalMinor: number;
  lines: { name: string; label: string | null; qty: number; totalMinor: number }[];
  createdAt: string;
}

export interface ShopOrderPlaced {
  /** The customer's own page for the order, in the shop: /shop/{slug}/o/{token} */
  trackPath: string;
  number: string;
  currency: CurrencyCode;
  totalMinor: number;
  /** The text WhatsApp opens with */
  message: string;
  /** https://wa.me/<number>?text=…, or null when the store has no WhatsApp number */
  whatsappUrl: string | null;
}

export const ONLINE_ORDER_STATUSES = ['pending', 'accepted', 'rejected', 'done'] as const;
export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

export interface OnlineOrder {
  id: string;
  number: string;
  status: OnlineOrderStatus;
  source: 'whatsapp' | 'shop';
  customerName: string;
  phone: string;
  fulfilment: 'delivery' | 'pickup';
  address: string | null;
  note: string | null;
  currency: CurrencyCode;
  totalMinor: number;
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
  version: number;
}
