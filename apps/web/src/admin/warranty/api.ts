import type { WarrantyClaim, WarrantyClaimInput, WarrantyLookup, WarrantyStatusInput } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/warranty/lookup?serial=` (catalog.manage): a sold serial with its sale, customer and warranty end */
export const lookupWarranty = (serial: string) =>
  apiFetch<WarrantyLookup>(`/v1/warranty/lookup?serial=${encodeURIComponent(serial)}`, { auth: true });

/** `GET /v1/warranty/claims?status=` (catalog.manage): the open claims, or the latest 200 */
export const listClaims = (status: 'open' | 'all') =>
  apiFetch<{ items: WarrantyClaim[] }>(`/v1/warranty/claims?status=${status}`, { auth: true });

/** `POST /v1/warranty/claims` (catalog.manage): opens a claim on a sold serial */
export const openClaim = (input: WarrantyClaimInput) =>
  apiFetch<WarrantyClaim>('/v1/warranty/claims', { method: 'POST', body: input, auth: true });

/** `POST /v1/warranty/claims/{id}/status` (catalog.manage): sent, ready or delivered */
export const moveClaim = (id: string, input: WarrantyStatusInput) =>
  apiFetch<WarrantyClaim>(`/v1/warranty/claims/${id}/status`, { method: 'POST', body: input, auth: true });
