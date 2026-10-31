import type { SetPinInput } from '@serva/core';

export type { SetPinInput };
import { apiFetch } from '../../lib/api';

/** `PUT /v1/me/pin`: the signed-in user sets the code they type on cashier devices, confirmed with their password. Answers 204. */
export function setMyPin(input: SetPinInput) {
  return apiFetch<void>('/v1/me/pin', { method: 'PUT', body: input, auth: true });
}
