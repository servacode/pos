import type {
  CustomerDetail,
  CustomerInput,
  CustomerGroup,
  CustomerGroupInput,
  CustomerKind,
  CustomerListResponse,
  CustomerMoneyResult,
  CustomerOpeningDebtInput,
  CustomerPaymentInput,
  CustomerPurchases,
  VoucherList,
  VoucherUpdateInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/customers`: every customer with what they owe (customers.view) */
export const listCustomers = (q = '', owing = false, kind?: CustomerKind) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (owing) params.set('owing', 'true');
  if (kind) params.set('kind', kind);
  const query = params.toString();
  return apiFetch<CustomerListResponse>(`/v1/customers${query ? `?${query}` : ''}`, { auth: true });
};

/** `GET /v1/customers/{id}`: one customer and their statement */
export const getCustomer = (id: string) => apiFetch<CustomerDetail>(`/v1/customers/${id}`, { auth: true });

/**
 * `POST /v1/customers/{id}/archive-duplicate` (customers.manage): archives a duplicate with no balance,
 * no uncashed cheque and no loyalty points; 409 with the reason otherwise. Customers are never merged.
 */
export const archiveDuplicate = (id: string) =>
  apiFetch<CustomerDetail>(`/v1/customers/${id}/archive-duplicate`, { method: 'POST', auth: true });

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

/** What the customers page asks for: filters of the list, and which page of it */
export interface CustomerPageQuery {
  q?: string;
  owing?: boolean;
  kind?: CustomerKind | '';
  /** Only customers who bought before and not since this day */
  lastBefore?: string;
  approval?: 'pending';
  sort?: 'balance' | 'name' | 'last' | 'spent';
  dir?: 'asc' | 'desc';
  groupId?: string;
  birthMonth?: number;
  limit: number;
  cursor?: string | null;
}

/** `GET /v1/customers?limit=`: one page, with the last purchase, spend and size of each */
export const listCustomerPage = (query: CustomerPageQuery) => {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.owing) params.set('owing', 'true');
  if (query.kind) params.set('kind', query.kind);
  if (query.lastBefore) params.set('lastBefore', query.lastBefore);
  if (query.approval) params.set('approval', query.approval);
  if (query.sort) params.set('sort', query.sort);
  if (query.dir) params.set('dir', query.dir);
  if (query.groupId) params.set('groupId', query.groupId);
  if (query.birthMonth) params.set('birthMonth', String(query.birthMonth));
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return apiFetch<CustomerListResponse & { nextCursor: string | null }>(
    `/v1/customers?${params.toString()}`,
    {
      auth: true,
    },
  );
};

/** `GET /v1/vouchers`: the exchange and gift vouchers with what is left on each (customers.view) */
export const listVouchers = (
  status: 'open' | 'all',
  cursor?: string | null,
  filter: { kind?: string; q?: string } = {},
) => {
  const params = new URLSearchParams({ status, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.q) params.set('q', filter.q);
  return apiFetch<VoucherList>(`/v1/vouchers?${params.toString()}`, { auth: true });
};

/** `PUT /v1/vouchers/{code}`: the last day of a voucher, or void it (customers.manage) */
export const updateVoucher = (code: string, input: VoucherUpdateInput) =>
  apiFetch<{ code: string; expiresOn: string | null; voidedAt: string | null }>(
    `/v1/vouchers/${encodeURIComponent(code)}`,
    { method: 'PUT', body: input, auth: true },
  );

/** `GET /v1/customer-groups`: the groups with their discount and how many customers each holds */
export const listGroups = () => apiFetch<CustomerGroup[]>('/v1/customer-groups', { auth: true });
export const createGroup = (input: CustomerGroupInput) =>
  apiFetch<CustomerGroup>('/v1/customer-groups', { method: 'POST', body: input, auth: true });
export const updateGroup = (id: string, input: CustomerGroupInput) =>
  apiFetch<CustomerGroup>(`/v1/customer-groups/${id}`, { method: 'PUT', body: input, auth: true });
