import type {
  CustomerDetail,
  CustomerInput,
  CustomerListResponse,
  CustomerMoneyResult,
  CustomerOpeningDebtInput,
  CustomerPaymentInput,
  CustomerPurchases,
} from '@serva/core';
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

/** `GET /v1/customers/{id}/purchases`: the sizes they buy most and their latest invoices */
export const getPurchases = (id: string) =>
  apiFetch<CustomerPurchases>(`/v1/customers/${id}/purchases`, { auth: true });

/** `POST /v1/customers/{id}/payments`: a payment received at the desk (receipt.create) */
export const receivePayment = (id: string, input: CustomerPaymentInput) =>
  apiFetch<CustomerMoneyResult>(`/v1/customers/${id}/payments`, { method: 'POST', body: input, auth: true });

/** `POST /v1/customers/{id}/opening-debt`: a debt from before the system (accounting.post) */
export const openDebt = (id: string, input: CustomerOpeningDebtInput) =>
  apiFetch<CustomerMoneyResult>(`/v1/customers/${id}/opening-debt`, {
    method: 'POST',
    body: input,
    auth: true,
  });
