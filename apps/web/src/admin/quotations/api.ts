import type {
  Quotation,
  QuotationInput,
  QuotationListItem,
  QuotationStatus,
  QuotationUpdateInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/quotations?status=&q=` (sale.create): the latest 200 */
export const listQuotations = (status: string, q: string) => {
  const params = new URLSearchParams({ status });
  if (q.trim()) params.set('q', q.trim());
  return apiFetch<{ items: QuotationListItem[] }>(`/v1/quotations?${params}`, { auth: true });
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
