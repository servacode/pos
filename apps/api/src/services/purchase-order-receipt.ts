import { eq, sql } from 'drizzle-orm';
import {
  purchaseOrderOpen,
  type PurchaseOrderLine,
  type PurchaseOrderReceipt,
  type PurchaseOrderStatus,
} from '@serva/core';
import { purchaseOrders, type Transaction } from '@serva/db';
import { AppError } from '../errors';

/**
 * What a purchase made from an order does to the order (purchase_orders): the pieces it received are
 * added to the lines' received quantities, the purchase is listed as a receipt, and the order reads
 * «استُلم جزء» until every line has arrived. It runs inside the purchase's own transaction, so a
 * refused receipt takes no stock and posts nothing. The purchase itself posts as it always does.
 */
export async function applyReceipt(
  tx: Transaction,
  orderId: string,
  supplierId: string,
  purchase: { id: string; number: string; date: string },
  lines: readonly { variantId: string; qty: number }[],
): Promise<void> {
  const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for('update');
  if (!order) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
      purchaseOrderId: 'هذه الطلبية غير موجودة',
    });
  }
  if (!purchaseOrderOpen(order.status as PurchaseOrderStatus)) {
    throw new AppError(
      409,
      'conflict',
      'هذه الطلبية لا تنتظر استلاماً: أرسلها أولاً، أو هي مستلمة أو ملغاة.',
    );
  }
  if (order.supplierId !== supplierId) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
      supplierId: 'الطلبية لمورد آخر',
    });
  }
  const arrived = new Map<string, number>();
  for (const l of lines) arrived.set(l.variantId, (arrived.get(l.variantId) ?? 0) + l.qty);
  const next = (order.lines as PurchaseOrderLine[]).map((l) => ({
    ...l,
    receivedQty: l.receivedQty + (arrived.get(l.variantId) ?? 0),
  }));
  const status: PurchaseOrderStatus = next.every((l) => l.receivedQty >= l.qty) ? 'received' : 'partial';
  const receipts: PurchaseOrderReceipt[] = [
    ...(order.receipts as PurchaseOrderReceipt[]),
    { purchaseId: purchase.id, number: purchase.number, date: purchase.date },
  ];
  await tx
    .update(purchaseOrders)
    .set({ lines: next, receipts, status, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, orderId));
}

/**
 * A corrected purchase (round 36, decision 12) no longer received its order: the pieces it brought are
 * taken off the lines' received quantities, its receipt is dropped from the order's list, and the order
 * goes back to waiting («استُلم جزء» while some of it has come, «مُرسلة» when none has). An order that was
 * cancelled stays cancelled. The order the purchase did not come from is not touched.
 */
export async function undoReceipt(
  tx: Transaction,
  purchaseId: string,
  lines: readonly { variantId: string; qty: number }[],
): Promise<void> {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(
      sql`${purchaseOrders.receipts} @> jsonb_build_array(jsonb_build_object('purchaseId', ${purchaseId}::text))`,
    )
    .for('update');
  if (!order) return;
  const back = new Map<string, number>();
  for (const l of lines) back.set(l.variantId, (back.get(l.variantId) ?? 0) + l.qty);
  const next = (order.lines as PurchaseOrderLine[]).map((l) => ({
    ...l,
    receivedQty: Math.max(0, l.receivedQty - (back.get(l.variantId) ?? 0)),
  }));
  const receipts = (order.receipts as PurchaseOrderReceipt[]).filter((r) => r.purchaseId !== purchaseId);
  const status: PurchaseOrderStatus =
    order.status === 'partial' || order.status === 'received'
      ? next.every((l) => l.receivedQty >= l.qty)
        ? 'received'
        : next.some((l) => l.receivedQty > 0)
          ? 'partial'
          : 'sent'
      : (order.status as PurchaseOrderStatus);
  await tx
    .update(purchaseOrders)
    .set({ lines: next, receipts, status, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, order.id));
}
