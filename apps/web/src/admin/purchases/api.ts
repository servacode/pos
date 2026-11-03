import type {
  SerialRow,
  ExpiryResponse,
  InventoryResponse,
  ProfitReport,
  PurchaseDetail,
  PurchaseInput,
  PurchaseListResponse,
  StocktakeDetail,
  StocktakeInput,
  SupplierInput,
  SupplierListResponse,
  SupplierPaymentInput,
  SupplierPaymentRow,
  SupplierRow,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

export const listSuppliers = () => apiFetch<SupplierListResponse>('/v1/suppliers', { auth: true });
export const createSupplier = (input: Partial<SupplierInput>) =>
  apiFetch<SupplierRow>('/v1/suppliers', { method: 'POST', body: input, auth: true });
export const listPurchases = () => apiFetch<PurchaseListResponse>('/v1/purchases', { auth: true });
export const createPurchase = (input: PurchaseInput) =>
  apiFetch<PurchaseDetail>('/v1/purchases', { method: 'POST', body: input, auth: true });
export const paySupplier = (input: SupplierPaymentInput) =>
  apiFetch<SupplierPaymentRow>('/v1/supplier-payments', { method: 'POST', body: input, auth: true });
export const getInventory = () => apiFetch<InventoryResponse>('/v1/inventory', { auth: true });
export const createStocktake = (input: StocktakeInput) =>
  apiFetch<StocktakeDetail>('/v1/stocktakes', { method: 'POST', body: input, auth: true });
export const getProfit = (from: string, to: string) =>
  apiFetch<ProfitReport>(`/v1/reports/profit?from=${from}&to=${to}`, { auth: true });

/** Today in the browser's calendar, YYYY-MM-DD */
export const today = () => new Date().toLocaleDateString('en-CA');

/** «12.5» pieces (or kg) to thousandths; null while unusable */
export function qtyOf(text: string): number | null {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 1000);
}

/** «1,250.50» pounds to minor units; null while unusable */
export function moneyOf(text: string): number | null {
  const clean = text
    .replace(/[,\s]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** `GET /v1/inventory/expiry?days=` (purchases.manage): batches on the shelf ending within `days` */
export const listExpiry = (days: number) =>
  apiFetch<ExpiryResponse>(`/v1/inventory/expiry?days=${days}`, { auth: true });

/** `GET /v1/serials?q=` (catalog.manage): a piece by its serial number or IMEI */
export const findSerials = (q: string) =>
  apiFetch<{ items: SerialRow[] }>(`/v1/serials${q ? `?q=${encodeURIComponent(q)}` : ''}`, { auth: true });

/** `GET /v1/purchases/{id}` (purchases.manage): one purchase with its lines */
export const getPurchase = (id: string) => apiFetch<PurchaseDetail>(`/v1/purchases/${id}`, { auth: true });
