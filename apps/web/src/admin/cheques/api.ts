import type { Cheque, ChequeActionInput, ChequeStatus, CurrencyCode } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/cheques` (customers.view) */
export const listCheques = (status?: ChequeStatus) =>
  apiFetch<{ items: Cheque[]; baseCurrency: CurrencyCode }>(
    `/v1/cheques${status ? `?status=${status}` : ''}`,
    { auth: true },
  );

/** `POST /v1/cheques/actions` (customers.manage): cashed or bounced, once */
export const actOnCheque = (input: ChequeActionInput) =>
  apiFetch<Cheque>('/v1/cheques/actions', { method: 'POST', body: input, auth: true });
