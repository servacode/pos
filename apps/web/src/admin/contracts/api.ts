import type {
  ContractPrice,
  ContractPriceInput,
  CustomerKind,
  DebtAgeingReport,
  MaintenanceContract,
  MaintenanceInput,
  PriceListSheet,
  Rental,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

// The back-office requests of rentals, maintenance contracts, contract prices and debt ageing
// (packages/core › contracts/rentals.ts, maintenance.ts, contract-prices.ts, ageing.ts).

/** `GET /v1/rentals?status=` (customers.view): what is out, the soonest due first, or the latest 200 */
export const listRentals = (status: 'out' | 'all') =>
  apiFetch<{ items: Rental[] }>(`/v1/rentals?status=${status}`, { auth: true });

/** `GET /v1/maintenance?view=` (catalog.manage) */
export const listContracts = (view: 'all' | 'upcoming') =>
  apiFetch<{ items: MaintenanceContract[] }>(`/v1/maintenance?view=${view}`, { auth: true });

export const createContract = (input: MaintenanceInput) =>
  apiFetch<MaintenanceContract>('/v1/maintenance', { method: 'POST', body: input, auth: true });

export const logVisit = (
  id: string,
  input: { on?: string; technician: string; note?: string | null; version: number },
) =>
  apiFetch<MaintenanceContract>(`/v1/maintenance/${id}/visits`, { method: 'POST', body: input, auth: true });

export const renewContract = (id: string, version: number) =>
  apiFetch<MaintenanceContract>(`/v1/maintenance/${id}/renew`, {
    method: 'POST',
    body: { version },
    auth: true,
  });

/** `GET /v1/contract-prices?customerId=&kind=` (catalog.manage) */
export const listContractPrices = (filter: { customerId?: string; kind?: CustomerKind }) => {
  const params = new URLSearchParams();
  if (filter.customerId) params.set('customerId', filter.customerId);
  if (filter.kind) params.set('kind', filter.kind);
  const query = params.toString();
  return apiFetch<{ items: ContractPrice[] }>(`/v1/contract-prices${query ? `?${query}` : ''}`, {
    auth: true,
  });
};

export const saveContractPrice = (input: ContractPriceInput, edit?: { id: string; version: number }) =>
  edit
    ? apiFetch<ContractPrice>(`/v1/contract-prices/${edit.id}`, {
        method: 'PUT',
        body: { ...input, version: edit.version },
        auth: true,
      })
    : apiFetch<ContractPrice>('/v1/contract-prices', { method: 'POST', body: input, auth: true });

export const deleteContractPrice = (id: string) =>
  apiFetch<void>(`/v1/contract-prices/${id}`, { method: 'DELETE', auth: true });

/** `GET /v1/reports/debt-ageing?asOf=` (customers.view) */
export const getDebtAgeing = (asOf?: string) =>
  apiFetch<DebtAgeingReport>(`/v1/reports/debt-ageing${asOf ? `?asOf=${asOf}` : ''}`, { auth: true });

/** `GET /v1/contract-prices/price-list` (catalog.manage): every product with the price one customer or type pays today */
export const getPriceListSheet = (
  who: { customerId: string } | { kind: CustomerKind; tier: 'retail' | 'wholesale' },
) => {
  const params = new URLSearchParams();
  if ('customerId' in who) params.set('customerId', who.customerId);
  else {
    params.set('kind', who.kind);
    params.set('tier', who.tier);
  }
  return apiFetch<PriceListSheet>(`/v1/contract-prices/price-list?${params.toString()}`, { auth: true });
};
