import { eq } from 'drizzle-orm';
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
