import type { CustomerDetail, CustomerInput, CustomerListResponse } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/customers`: every customer with what they owe (customers.view) */
export const listCustomers = (q = '', owing = false) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (owing) params.set('owing', 'true');
  const query = params.toString();
  return apiFetch<CustomerListResponse>(`/v1/customers${query ? `?${query}` : ''}`, { auth: true });
};

/** `GET /v1/customers/{id}`: one customer and their statement */
export const getCustomer = (id: string) => apiFetch<CustomerDetail>(`/v1/customers/${id}`, { auth: true });

/** `POST /v1/customers` (customers.manage) */
export const createCustomer = (input: Partial<CustomerInput>) =>
  apiFetch<CustomerDetail>('/v1/customers', { method: 'POST', body: input, auth: true });

/** `PUT /v1/customers/{id}` (customers.manage) */
export const updateCustomer = (id: string, input: Partial<CustomerInput>) =>
  apiFetch<CustomerDetail>(`/v1/customers/${id}`, { method: 'PUT', body: input, auth: true });
