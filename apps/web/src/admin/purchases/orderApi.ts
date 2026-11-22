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
export async function listOrders(status?: PurchaseOrderStatus): Promise<PurchaseOrderListResponse> {
  // Round 60: the list comes in pages of 500 that are joined here; `nextCursor` stays set only if the safety stop of 8 pages was reached
  const items: PurchaseOrderListResponse['items'] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    // The first page is the plain list (the newest 500); the next ones continue from its cursor
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    const got: PurchaseOrderListResponse = await apiFetch<PurchaseOrderListResponse>(
      `/v1/purchase-orders${query.size > 0 ? `?${query.toString()}` : ''}`,
      { auth: true },
    );
    items.push(...got.items);
    cursor = got.nextCursor ?? null;
    if (!cursor) break;
  }
  return { items, nextCursor: cursor };
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
