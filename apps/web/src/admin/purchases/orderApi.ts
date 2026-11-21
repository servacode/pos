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
export const listOrders = (status?: PurchaseOrderStatus) =>
  apiFetch<PurchaseOrderListResponse>(`/v1/purchase-orders${status ? `?status=${status}` : ''}`, {
    auth: true,
  });

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
