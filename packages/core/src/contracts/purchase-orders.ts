import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, nonNegativeMinorSchema, uuidSchema } from './common';

/**
 * «طلبية شراء»: an order to a supplier (08 › المستندات، 11 › الدورة التشغيلية). A promise, not a posting:
 * no stock moves and nothing reaches the books. The goods arrive as ordinary purchases made from the
 * order (`purchaseOrderId` on the purchase), each taking what is still owed.
 *
 *   GET  /v1/purchase-orders?status&supplierId   PurchaseOrderListResponse   (purchases.manage)
 *   GET  /v1/purchase-orders/suggest?supplierId  PurchaseOrderSuggestion     (purchases.manage)
 *   POST /v1/purchase-orders                     purchaseOrderInput → PurchaseOrderDetail
 *   GET  /v1/purchase-orders/{id}                PurchaseOrderDetail
 *   PUT  /v1/purchase-orders/{id}                purchaseOrderUpdateInput → PurchaseOrderDetail
 *   POST /v1/purchase-orders/{id}/status         purchaseOrderStatusInput → PurchaseOrderDetail
 */

export const PURCHASE_ORDER_STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  sent: 'مُرسلة',
  partial: 'استُلم جزء',
  received: 'مستلمة',
  cancelled: 'ملغاة',
};

/** A waiting order can still be received: sent, or partly received */
export const purchaseOrderOpen = (status: PurchaseOrderStatus): boolean =>
  status === 'sent' || status === 'partial';

/** The moves a person makes by hand: send a draft, close a part-received order, or cancel one that is waiting */
export const PURCHASE_ORDER_NEXT: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const purchaseOrderLineInput = z.object({
  variantId: uuidSchema,
  /** Base units ordered, thousandths (12.5 kg is 12500) */
  qty: z.int('الكمية مطلوبة').positive('الكمية أكبر من صفر').max(1_000_000_000, 'الكمية كبيرة'),
  /** What the line is expected to cost in all, base currency minor units */
  costMinor: nonNegativeMinorSchema,
  /**
   * What one unit is expected to cost, minor units. When it is sent the line's cost is worked out
   * from it (`unit × qty`); without it the unit cost is worked out from `costMinor`.
   */
  unitCostMinor: nonNegativeMinorSchema.optional(),
});

const orderFields = {
  /** Round 44: the order's own id, made by the form (a retry answers the order already made) */
  id: uuidSchema.optional(),
  supplierId: uuidSchema,
  branchId: uuidSchema.optional(),
  expectedDate: isoDateSchema.nullable().optional(),
  notes: optionalText(500, 'الملاحظات طويلة'),
  lines: z.array(purchaseOrderLineInput).min(1, 'أضف صنفاً واحداً على الأقل').max(500),
};
const oneLinePerItem = {
  path: ['lines'],
  message: 'كل صنف مرة واحدة في الطلبية',
};

export const purchaseOrderInput = z
  .object(orderFields)
  .refine((p) => new Set(p.lines.map((l) => l.variantId)).size === p.lines.length, oneLinePerItem);
export type PurchaseOrderInput = z.output<typeof purchaseOrderInput>;

export const purchaseOrderUpdateInput = z
  .object({ ...orderFields, version: z.int().positive() })
  .refine((p) => new Set(p.lines.map((l) => l.variantId)).size === p.lines.length, oneLinePerItem);
export type PurchaseOrderUpdateInput = z.output<typeof purchaseOrderUpdateInput>;

export const purchaseOrderStatusInput = z.object({
  status: z.enum(['sent', 'received', 'cancelled']),
  version: z.int().positive(),
});

export const purchaseOrderListQuery = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: uuidSchema.optional(),
});

export const purchaseOrderSuggestQuery = z.object({
  supplierId: uuidSchema,
  /** `1`: every item that runs low, not only the ones last bought from this supplier */
  all: z.enum(['0', '1']).optional(),
});

export interface PurchaseOrderLine {
  lineNo: number;
  variantId: string;
  productId: string;
  name: string;
  qty: number;
  costMinor: number;
  /** What one unit is expected to cost, minor units (worked out from `costMinor` on an old line) */
  unitCostMinor: number;
  /** What arrived so far, in purchases made from the order (may pass `qty`) */
  receivedQty: number;
}

export interface PurchaseOrderRow {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  /** yyyy-mm-dd the order was made */
  date: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  expectedDate: string | null;
  totalMinor: number;
  orderedQty: number;
  /** Received, counting each line up to what was ordered of it */
  receivedQty: number;
  version: number;
}

export interface PurchaseOrderReceipt {
  purchaseId: string;
  number: string;
  date: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  branchId: string;
  notes: string | null;
  lines: PurchaseOrderLine[];
  receipts: PurchaseOrderReceipt[];
  baseCurrency: CurrencyCode;
  createdAt: string;
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrderRow[];
}

/** `requested`: a customer asked for it and the shelf lacked it (round 38, «النواقص») */
export type PurchaseOrderSuggestReason = 'below_min' | 'selling_fast' | 'requested';

export interface PurchaseOrderSuggestionLine {
  variantId: string;
  productId: string;
  name: string;
  /** The product's own name, for grouping the sizes and colours of one model */
  productName: string;
  /** The variant's sizes and colours («المقاس: 42») */
  attributes: { name: string; value: string }[];
  stockQty: number;
  minStockQty: number | null;
  /** Sold over the last `periodDays` */
  soldQty: number;
  /** Still owed on orders already waiting */
  onOrderQty: number;
  suggestedQty: number;
  /** The expected cost of `suggestedQty` at the last purchase's price; 0 when never bought */
  costMinor: number;
  /** What one unit cost on the last purchase; 0 when never bought */
  unitCostMinor: number;
  /** The last cost looks wrong (far from the usual cost, or far above the shelf price) */
  costDoubtful: boolean;
  /** The shelf price of one unit in the base currency, null when unknown */
  priceMinor: number | null;
  reason: PurchaseOrderSuggestReason;
  /** The supplier the item was last bought from, null when never bought */
  lastSupplierId: string | null;
}

/** An item that runs short but is already owed on an order waiting at a supplier */
export interface PurchaseOrderAlreadyOrdered {
  variantId: string;
  name: string;
  onOrderQty: number;
  /** The waiting orders that owe it */
  orderNumbers: string[];
}

export interface PurchaseOrderSuggestion {
  periodDays: number;
  /** Days of sales the suggestion covers on top of the minimum */
  coverDays: number;
  items: PurchaseOrderSuggestionLine[];
  /** Short items left out because a waiting order already owes enough of them */
  alreadyOrdered: PurchaseOrderAlreadyOrdered[];
  baseCurrency: CurrencyCode;
}

/** The cost of `qty` thousandths at `unitCostMinor` per unit, rounded once */
export const orderLineCost = (unitCostMinor: number, qty: number): number =>
  Math.round((unitCostMinor * qty) / 1000);

/** What one unit costs when only the line's whole cost is known, rounded to a minor unit */
export const orderUnitCost = (costMinor: number, qty: number): number =>
  qty > 0 ? Math.round((costMinor * 1000) / qty) : 0;

/** The quantity still owed on a line: never below zero */
export const orderLineRemaining = (l: Pick<PurchaseOrderLine, 'qty' | 'receivedQty'>): number =>
  Math.max(0, l.qty - l.receivedQty);

/** The text a supplier gets on WhatsApp: the order, its lines and the expected day */
export function purchaseOrderText(
  order: Pick<PurchaseOrderDetail, 'number' | 'expectedDate' | 'notes' | 'lines'>,
  storeName: string,
  qtyText: (qty: number) => string,
  dayText: (day: string) => string,
  moneyText?: (minor: number) => string,
): string {
  const out: string[] = [`طلبية شراء رقم ${order.number} من ${storeName}`, ''];
  let total = 0;
  order.lines.forEach((l, i) => {
    const qty = orderLineRemaining(l) || l.qty;
    const unit = l.unitCostMinor;
    const cost = orderLineCost(unit, qty);
    total += cost;
    const price = moneyText && unit > 0 ? ` × ${moneyText(unit)} = ${moneyText(cost)}` : '';
    out.push(`${i + 1}. ${l.name} × ${qtyText(qty)}${price}`);
  });
  if (moneyText && total > 0) out.push('', `المجموع المتوقع: ${moneyText(total)}`);
  out.push('');
  if (order.expectedDate) out.push(`موعد التسليم المطلوب: ${dayText(order.expectedDate)}`);
  if (order.notes) out.push(`ملاحظات: ${order.notes}`);
  out.push('شكراً لكم');
  return out.join('\n');
}
