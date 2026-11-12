import type { ControlledRegisterResponse } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/pharmacy/controlled-register?from=&to=` (pharmacy.controlled): the movements of controlled drugs */
export const getControlledRegister = (from: string, to: string) =>
  apiFetch<ControlledRegisterResponse>(`/v1/pharmacy/controlled-register?from=${from}&to=${to}`, {
    auth: true,
  });
