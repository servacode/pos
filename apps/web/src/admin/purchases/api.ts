import type {
  CountSheet,
  DamagedStock,
  BatchBlockInput,
  BatchBlockResult,
  RecallResponse,
  SerialRow,
  ExpiryResponse,
  InventoryResponse,
  ProfitReport,
  PurchaseCorrection,
  PurchaseCorrectionInput,
  PurchaseDetail,
  PurchaseInput,
  PurchaseListResponse,
  StocktakeDetail,
  StocktakeListResponse,
  StocktakeInput,
  SupplierReturnDetail,
  SupplierReturnInput,
  SupplierInput,
  SupplierListResponse,
  SupplierPaymentInput,
  SupplierPaymentRow,
  SupplierRow,
} from '@serva/core';
import { apiFetch } from '../../lib/api';
import { isoDay } from '../../lib/dates';

export const listSuppliers = () => apiFetch<SupplierListResponse>('/v1/suppliers', { auth: true });
export const createSupplier = (input: Partial<SupplierInput>) =>
  apiFetch<SupplierRow>('/v1/suppliers', { method: 'POST', body: input, auth: true });
export const listPurchases = () => apiFetch<PurchaseListResponse>('/v1/purchases', { auth: true });
/** Round 44: one page of the invoices, newest first, with what the filters match in all (corrected ones left out) */
export interface PurchaseFilters {
  from?: string;
  to?: string;
  supplierId?: string;
  q?: string;
  payment?: string;
}
export const listPurchasePage = (filters: PurchaseFilters, cursor: string | null, limit = 50) => {
  const query = new URLSearchParams({ limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  if (cursor) query.set('cursor', cursor);
  return apiFetch<PurchaseListResponse & { nextCursor: string | null }>(`/v1/purchases?${query.toString()}`, {
    auth: true,
  });
};
/** `PUT /v1/suppliers/{id}`: the name, the phone, the notes and the archive switch of a supplier */
export const updateSupplier = (id: string, input: Partial<SupplierInput>) =>
  apiFetch<SupplierRow>(`/v1/suppliers/${id}`, { method: 'PUT', body: input, auth: true });
export const createPurchase = (input: PurchaseInput) =>
  apiFetch<PurchaseDetail>('/v1/purchases', { method: 'POST', body: input, auth: true });
export const paySupplier = (input: SupplierPaymentInput) =>
  apiFetch<SupplierPaymentRow>('/v1/supplier-payments', { method: 'POST', body: input, auth: true });
export const getInventory = () => apiFetch<InventoryResponse>('/v1/inventory', { auth: true });
// «البضاعة التالفة»: what each store holds as damaged goods. It goes back to the supplier, or is written
// off, through the two calls any branch uses, naming the damaged place as the branch.
export const getDamagedStock = () => apiFetch<DamagedStock>('/v1/damaged-stock', { auth: true });
export const sendBackDamaged = (input: SupplierReturnInput) =>
  apiFetch<SupplierReturnDetail>('/v1/supplier-returns', { method: 'POST', body: input, auth: true });
/** `GET /v1/stocktakes`: the counts already made, newest first (round 44) */
export const listStocktakes = (cursor: string | null) =>
  apiFetch<StocktakeListResponse>(`/v1/stocktakes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
    auth: true,
  });
export const createStocktake = (input: StocktakeInput) =>
  apiFetch<StocktakeDetail>('/v1/stocktakes', { method: 'POST', body: input, auth: true });
/** `GET /v1/inventory/count-sheet`: what the phone counts by: the branch's items (or one category's) with their barcodes */
export const getCountSheet = (branchId?: string, categoryId?: string) => {
  const query = new URLSearchParams();
  if (branchId) query.set('branchId', branchId);
  if (categoryId) query.set('categoryId', categoryId);
  const text = query.toString();
  return apiFetch<CountSheet>(`/v1/inventory/count-sheet${text ? `?${text}` : ''}`, { auth: true });
};
export const getProfit = (from: string, to: string) =>
  apiFetch<ProfitReport>(`/v1/reports/profit?from=${from}&to=${to}`, { auth: true });

/** Today in the browser's calendar, YYYY-MM-DD (kept for the pages that have no store at hand: prefer `storeToday`) */
export const today = () => new Date().toLocaleDateString('en-CA');

/** Round 44: the store's business day (its own zone), so a device in another zone or at midnight posts on the right date */
export const storeToday = (timeZone: string) => isoDay(Date.now(), timeZone);

/** A new id for a document the form is about to post: kept until it is saved, so a retry never posts twice */
export const newDocumentId = () => crypto.randomUUID();

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
    .replace(/[,\s،٬]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** `GET /v1/inventory/expiry?days=` (purchases.manage): batches on the shelf ending within `days` */
export const listExpiry = (days: number, unbatched = false) =>
  apiFetch<ExpiryResponse>(`/v1/inventory/expiry?days=${days}${unbatched ? '&unbatched=1' : ''}`, {
    auth: true,
  });

/** `GET /v1/serials?q=` (catalog.manage): a piece by its serial number or IMEI */
export const findSerials = (q: string) =>
  apiFetch<{ items: SerialRow[] }>(`/v1/serials${q ? `?q=${encodeURIComponent(q)}` : ''}`, { auth: true });

/** `GET /v1/purchases/{id}` (purchases.manage): one purchase with its lines */
export const getPurchase = (id: string) => apiFetch<PurchaseDetail>(`/v1/purchases/${id}`, { auth: true });

/**
 * `POST /v1/purchases/{id}/correct` (purchases.manage): «صحّح الفاتورة». It posts the reversal document and
 * answers the draft of the invoice to write again; refused (409) when part of the goods was sold.
 */
export const correctPurchase = (id: string, input: PurchaseCorrectionInput) =>
  apiFetch<PurchaseCorrection>(`/v1/purchases/${id}/correct`, { method: 'POST', body: input, auth: true });

/** `GET /v1/inventory/expiry?variantId=` (purchases.manage): every batch of one item, whatever its date */
export const listBatchesOf = (variantId: string, branchId?: string) =>
  apiFetch<ExpiryResponse>(
    `/v1/inventory/expiry?days=3650&variantId=${variantId}${branchId ? `&branchId=${branchId}` : ''}`,
    { auth: true },
  );

/** `POST /v1/batches/block|unblock` (purchases.manage): stops, or lets, every till sell a batch (a recall) */
export const setBatchBlocked = (input: BatchBlockInput, blocked: boolean) =>
  apiFetch<BatchBlockResult>(`/v1/batches/${blocked ? 'block' : 'unblock'}`, {
    method: 'POST',
    body: input,
    auth: true,
  });

/** `GET /v1/batches/recall?batchNo=` (purchases.manage): where a batch came from and who got it */
export const getRecall = (batchNo: string) =>
  apiFetch<RecallResponse>(`/v1/batches/recall?batchNo=${encodeURIComponent(batchNo)}`, { auth: true });

/** `POST /v1/supplier-returns` (purchases.manage): pieces back to their supplier, a batch named per line */
export const createSupplierReturn = (input: SupplierReturnInput) =>
  apiFetch<SupplierReturnDetail>('/v1/supplier-returns', { method: 'POST', body: input, auth: true });
