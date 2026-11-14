import type { BranchInput, BranchAdminRow } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/branches` (settings.manage) */
export const listBranches = () => apiFetch<BranchAdminRow[]>('/v1/branches', { auth: true });

/** `POST /v1/branches`: within the plan's limit (settings.manage) */
export const createBranch = (input: Partial<BranchInput>) =>
  apiFetch<BranchAdminRow>('/v1/branches', { method: 'POST', body: input, auth: true });

/** `PATCH /v1/branches/{id}` */
export const updateBranch = (id: string, input: Partial<BranchInput>) =>
  apiFetch<BranchAdminRow>(`/v1/branches/${id}`, { method: 'PATCH', body: input, auth: true });

/** `POST /v1/branches/{id}/active`: stop or restart a branch */
export const setBranchActive = (id: string, active: boolean) =>
  apiFetch<BranchAdminRow>(`/v1/branches/${id}/active`, { method: 'POST', body: { active }, auth: true });
