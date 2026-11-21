import type {
  Promotion,
  PromotionInput,
  PromotionPreview,
  PromotionPreviewInput,
  PromotionReport,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/promotions` (catalog.manage) */
export const listPromotions = () => apiFetch<{ items: Promotion[] }>('/v1/promotions', { auth: true });

/** `POST /v1/promotions` (catalog.manage) */
export const createPromotion = (input: PromotionInput) =>
  apiFetch<Promotion>('/v1/promotions', { method: 'POST', body: input, auth: true });

/** `PUT /v1/promotions/{id}` (catalog.manage) */
export const updatePromotion = (id: string, input: PromotionInput & { version: number }) =>
  apiFetch<Promotion>(`/v1/promotions/${id}`, { method: 'PUT', body: input, auth: true });

/** `POST /v1/promotions/{id}/archive` (catalog.manage): stop or restart one offer, whatever else is in its row */
export const archivePromotion = (id: string, input: { version: number; archived: boolean }) =>
  apiFetch<Promotion>(`/v1/promotions/${id}/archive`, { method: 'POST', body: input, auth: true });

/** `POST /v1/promotions/preview` (catalog.manage): how many products a scope reaches */
export const previewPromotion = (input: PromotionPreviewInput) =>
  apiFetch<PromotionPreview>('/v1/promotions/preview', { method: 'POST', body: input, auth: true });

/** `GET /v1/promotions/report?from&to` (catalog.manage): what each offer did at the tills */
export const promotionReport = (from: string, to: string) =>
  apiFetch<PromotionReport>(`/v1/promotions/report?from=${from}&to=${to}`, { auth: true });

/** `POST /v1/promotions/{id}/end-date` (catalog.manage): move or clear the end of one offer, whatever else is in its row */
export const setPromotionEndDate = (id: string, input: { version: number; endsAt: string | null }) =>
  apiFetch<Promotion>(`/v1/promotions/${id}/end-date`, { method: 'POST', body: input, auth: true });
