import type {
  SetPinInput,
  StaffCreateInput,
  StaffListResponse,
  StaffMember,
  StaffPinCheck,
  StaffUpdateInput,
} from '@serva/core';

export type { SetPinInput };
import { apiFetch } from '../../lib/api';

/** `PUT /v1/me/pin`: the signed-in user sets the code they type on cashier devices, confirmed with their password. Answers 204. */
export function setMyPin(input: SetPinInput) {
  return apiFetch<void>('/v1/me/pin', { method: 'PUT', body: input, auth: true });
}

/** `GET /v1/staff`: the people, the roles to pick from and the branches (users.manage) */
export const listStaff = () => apiFetch<StaffListResponse>('/v1/staff', { auth: true });

/** `POST /v1/staff` (users.manage) */
export const createStaff = (input: StaffCreateInput) =>
  apiFetch<StaffMember>('/v1/staff', { method: 'POST', body: input, auth: true });

/** `PATCH /v1/staff/{id}`: only the fields sent change (users.manage) */
export const updateStaff = (id: string, input: StaffUpdateInput) =>
  apiFetch<StaffMember>(`/v1/staff/${id}`, { method: 'PATCH', body: input, auth: true });

/** `POST /v1/staff/{id}/pin`: a new till code; the old one stops working. Answers 204. */
export const resetStaffPin = (id: string, pin: string) =>
  apiFetch<void>(`/v1/staff/${id}/pin`, { method: 'POST', body: { pin }, auth: true });

/** `POST /v1/staff/{id}/deactivate` and `/reactivate` */
export const setStaffActive = (id: string, active: boolean) =>
  apiFetch<StaffMember>(`/v1/staff/${id}/${active ? 'reactivate' : 'deactivate'}`, {
    method: 'POST',
    auth: true,
  });

/** `POST /v1/staff/pin-check`: who already has this till code, a warning only (users.manage) */
export const checkPin = (pin: string, exceptId?: string) =>
  apiFetch<StaffPinCheck>('/v1/staff/pin-check', {
    method: 'POST',
    body: { pin, ...(exceptId ? { exceptId } : {}) },
    auth: true,
  });
