import type {
  ActivateDeviceInput,
  ActivateDeviceResponse,
  ActivationStatusResponse,
  AuthResponse,
  LoginInput,
  MeResponse,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/**
 * The requests of «ربط الجهاز». None of them uses the admin's session: the owner's token, when he
 * signs in here, stays in memory for these few calls and is signed out once the device is linked.
 */
export function activateDevice(input: ActivateDeviceInput, ownerToken?: string) {
  return apiFetch<ActivateDeviceResponse>('/v1/devices/activate', {
    method: 'POST',
    body: input,
    authorization: ownerToken ? `Bearer ${ownerToken}` : undefined,
  });
}

export function activationStatus(activationId: string, secret: string) {
  return apiFetch<ActivationStatusResponse>(`/v1/devices/activations/${encodeURIComponent(activationId)}`, {
    authorization: `Activation ${secret}`,
  });
}

export interface OwnerSignIn {
  token: string;
  me: MeResponse;
}

export async function signInOwner(input: LoginInput): Promise<OwnerSignIn> {
  const auth = await apiFetch<AuthResponse>('/v1/auth/login', { method: 'POST', body: input });
  const me = await apiFetch<MeResponse>('/v1/me', { authorization: `Bearer ${auth.accessToken}` });
  return { token: auth.accessToken, me };
}

/** Ends the owner's sign-in on this cashier (the refresh cookie the login set). */
export function signOutOwner(token: string): Promise<void> {
  return apiFetch<void>('/v1/auth/logout', {
    method: 'POST',
    authorization: `Bearer ${token}`,
  }).catch(() => undefined);
}
