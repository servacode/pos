import type {
  PurchaseOrderDetail,
  PurchaseOrderInput,
  PurchaseOrderListResponse,
  PurchaseOrderStatus,
  PurchaseOrderSuggestion,
  PurchaseOrderUpdateInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/purchase-orders?status=` (purchases.manage): the store's orders to suppliers, newest first */
export async function listOrders(
  status?: PurchaseOrderStatus,
  from: string | null = null,
): Promise<PurchaseOrderListResponse> {
  // Round 60: the list comes in pages of 500 that are joined here; `nextCursor` stays set only if the safety stop of 8 pages was reached.
  // Round 62: the pages are keyset pages (an order made meanwhile shifts none), a row seen twice is kept once, the counts per status
  // come from the server's first page, and `from` continues after the cursor a safety stop left («حمّل الأقدم»)
  const items: PurchaseOrderListResponse['items'] = [];
  const seen = new Set<string>();
  let counts: PurchaseOrderListResponse['counts'];
  let cursor: string | null = from;
  for (let page = 0; page < 8; page += 1) {
    // The first page is the plain list (the newest 500); the next ones continue from its cursor
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    const got: PurchaseOrderListResponse = await apiFetch<PurchaseOrderListResponse>(
      `/v1/purchase-orders${query.size > 0 ? `?${query.toString()}` : ''}`,
      { auth: true },
    );
    for (const row of got.items) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push(row);
    }
    counts ??= got.counts;
    cursor = got.nextCursor ?? null;
    if (!cursor) break;
  }
  return { items, nextCursor: cursor, ...(counts ? { counts } : {}) };
}

export const getOrder = (id: string) =>
  apiFetch<PurchaseOrderDetail>(`/v1/purchase-orders/${id}`, { auth: true });

export const createOrder = (input: PurchaseOrderInput) =>
  apiFetch<PurchaseOrderDetail>('/v1/purchase-orders', { method: 'POST', body: input, auth: true });

export const updateOrder = (id: string, input: PurchaseOrderUpdateInput) =>
  apiFetch<PurchaseOrderDetail>(`/v1/purchase-orders/${id}`, { method: 'PUT', body: input, auth: true });

export const moveOrder = (id: string, status: 'sent' | 'received' | 'cancelled', version: number) =>
  apiFetch<PurchaseOrderDetail>(`/v1/purchase-orders/${id}/status`, {
    method: 'POST',
    body: { status, version },
    auth: true,
  });

/** `GET /v1/purchase-orders/suggest?supplierId=` (purchases.manage): what runs short, for one supplier */
export const suggestOrder = (supplierId: string, all: boolean) =>
  apiFetch<PurchaseOrderSuggestion>(
    `/v1/purchase-orders/suggest?supplierId=${supplierId}${all ? '&all=1' : ''}`,
    { auth: true },
  );
