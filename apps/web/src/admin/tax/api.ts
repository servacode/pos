import type {
  CreateTaxRateInput,
  DefaultTaxRateInput,
  TaxRate,
  TaxRateList,
  UpdateTaxRateInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/tax-rates` (owner, manager): the rates and the store's default percentage */
export const listRates = () => apiFetch<TaxRateList>('/v1/tax-rates', { auth: true });

/** `POST /v1/tax-rates` (owner): a rate is fixed once made */
export const createRate = (input: CreateTaxRateInput) =>
  apiFetch<TaxRate>('/v1/tax-rates', { method: 'POST', body: input, auth: true });

/** `PATCH /v1/tax-rates/{id}` (owner): the name, the receipt flag, or archive */
export const updateRate = (id: string, input: UpdateTaxRateInput) =>
  apiFetch<TaxRate>(`/v1/tax-rates/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, auth: true });

/** `PUT /v1/tax-rates/default` (owner): the rate a new product starts with */
export const setDefaultRate = (input: DefaultTaxRateInput) =>
  apiFetch<TaxRateList>('/v1/tax-rates/default', { method: 'PUT', body: input, auth: true });
