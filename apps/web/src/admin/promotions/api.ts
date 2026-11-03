import type { Promotion, PromotionInput } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/promotions` (catalog.manage) */
export const listPromotions = () => apiFetch<{ items: Promotion[] }>('/v1/promotions', { auth: true });

/** `POST /v1/promotions` (catalog.manage) */
export const createPromotion = (input: PromotionInput) =>
  apiFetch<Promotion>('/v1/promotions', { method: 'POST', body: input, auth: true });

/** `PUT /v1/promotions/{id}` (catalog.manage) */
export const updatePromotion = (id: string, input: PromotionInput & { version: number }) =>
  apiFetch<Promotion>(`/v1/promotions/${id}`, { method: 'PUT', body: input, auth: true });
