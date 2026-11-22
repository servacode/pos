import type {
  ContractPriceForTill,
  Quotation,
  QuotationInput,
  QuotationListItem,
  QuotationStatus,
  QuotationUpdateInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** One page of the list: the newest first, with where the next page starts (null on the last) */
export interface QuotationPage {
  items: QuotationListItem[];
  nextCursor: string | null;
}

/** `GET /v1/quotations?status=&q=&cursor=` (customers.manage): 50 a page, the cursor from the page before */
export const listQuotations = (status: string, q: string, cursor: string | null = null) => {
  const params = new URLSearchParams({ status });
  if (q.trim()) params.set('q', q.trim());
  if (cursor) params.set('cursor', cursor);
  return apiFetch<QuotationPage>(`/v1/quotations?${params}`, { auth: true });
};

export const getQuotation = (id: string) => apiFetch<Quotation>(`/v1/quotations/${id}`, { auth: true });

export const createQuotation = (input: QuotationInput) =>
  apiFetch<Quotation>('/v1/quotations', { method: 'POST', body: input, auth: true });

export const updateQuotation = (id: string, input: QuotationUpdateInput) =>
  apiFetch<Quotation>(`/v1/quotations/${id}`, { method: 'PUT', body: input, auth: true });

export const moveQuotation = (id: string, status: QuotationStatus, version: number) =>
  apiFetch<Quotation>(`/v1/quotations/${id}/status`, {
    method: 'POST',
    body: { status, version },
    auth: true,
  });

/** `GET /v1/quotations/customer-pricing?customerId=`: the customer's price tier and contract prices in force */
export const getCustomerPricing = (customerId: string) =>
  apiFetch<{ priceTier: 'retail' | 'wholesale'; items: ContractPriceForTill[] }>(
    `/v1/quotations/customer-pricing?customerId=${encodeURIComponent(customerId)}`,
    { auth: true },
  );
