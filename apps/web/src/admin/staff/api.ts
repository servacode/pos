import { apiFetch } from '../../lib/api';

/**
 * `PUT /v1/me/pin` (step 4 brief, «تسجيل الدخول برمز الدخول»): the signed-in user sets the code they
 * type on cashier devices, confirmed with their password. Answers 204.
 *
 * LOCAL SHAPE: `@serva/core/contracts/staff` (`setPinInput`) is written by the server package in
 * parallel. Until it lands this mirrors the brief exactly; replace it with
 * `import type { SetPinInput } from '@serva/core'` when it does.
 */
export interface SetPinInput {
  /** 4 or 6 digits (Arabic digits accepted by the server; this screen sends Latin ones) */
  pin: string;
  password: string;
}

export function setMyPin(input: SetPinInput) {
  return apiFetch<void>('/v1/me/pin', { method: 'PUT', body: input, auth: true });
}
