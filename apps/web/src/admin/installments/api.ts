import type {
  CollectInput,
  CurrencyCode,
  InstalmentSettings,
  InstalmentSettingsInput,
  InstalmentSummary,
  PlanDetail,
  PlanListItem,
  PlanStatus,
  WorklistBucket,
  WorklistRow,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/installment-plans` (installments.view) */
export const listPlans = (
  query: { status?: PlanStatus; q?: string; customerId?: string; overdue?: boolean } = {},
) => {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.customerId) params.set('customerId', query.customerId);
  if (query.overdue) params.set('overdue', '1');
  const qs = params.toString();
  return apiFetch<{ items: PlanListItem[]; baseCurrency: CurrencyCode; today: string }>(
    `/v1/installment-plans${qs ? `?${qs}` : ''}`,
    { auth: true },
  );
};

/** `GET /v1/installment-plans/{id}` */
export const getPlan = (id: string) => apiFetch<PlanDetail>(`/v1/installment-plans/${id}`, { auth: true });

/** `POST /v1/installment-plans/{id}/collect`: the payment posts, the oldest instalments settle */
export const collectOnPlan = (id: string, input: CollectInput) =>
  apiFetch<PlanDetail>(`/v1/installment-plans/${id}/collect`, { method: 'POST', body: input, auth: true });

/** `POST /v1/installment-plans/{id}/cancel` (installments.manage) */
export const cancelPlan = (id: string, reason: string) =>
  apiFetch<PlanDetail>(`/v1/installment-plans/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    auth: true,
  });

/** `GET /v1/installments/worklist?bucket=` */
export const getWorklist = (bucket: WorklistBucket) =>
  apiFetch<{ items: WorklistRow[]; today: string; baseCurrency: CurrencyCode }>(
    `/v1/installments/worklist?bucket=${bucket}`,
    { auth: true },
  );

/** `GET /v1/installments/summary`: the home page cards */
export const getSummary = () => apiFetch<InstalmentSummary>('/v1/installments/summary', { auth: true });

/** `POST /v1/installments/{planId}/{no}/reminders`: a WhatsApp click is logged */
export const logReminder = (planId: string, no: number, kind: 'before' | 'due' | 'late') =>
  apiFetch<{ ok: true }>(`/v1/installments/${planId}/${no}/reminders`, {
    method: 'POST',
    body: { kind },
    auth: true,
  });

/** `GET /v1/store/installments-settings` / `PUT` (settings.manage) */
export const getInstalmentSettings = () =>
  apiFetch<InstalmentSettings>('/v1/store/installments-settings', { auth: true });
export const saveInstalmentSettings = (input: InstalmentSettingsInput) =>
  apiFetch<InstalmentSettings>('/v1/store/installments-settings', { method: 'PUT', body: input, auth: true });
