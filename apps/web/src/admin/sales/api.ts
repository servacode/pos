import type { SaleDetail, SaleListPage, SaleSummary } from '@serva/core';
import { apiFetch } from '../../lib/api';
import { withQuery } from '../reports/api';

// The invoice list (الفواتير): read-only requests; the server checks report.view and the branch.

export interface SaleFilters {
  from: string;
  to: string;
  branchId: string | null;
  deviceId: string | null;
  cashierId: string | null;
  customerId: string | null;
  method: string | null;
  status: string | null;
  q: string;
  /** Minor units, as text; empty for none */
  minTotal: string;
  maxTotal: string;
}

const filterQuery = (filters: SaleFilters) => ({
  from: filters.from,
  to: filters.to,
  branchId: filters.branchId,
  deviceId: filters.deviceId,
  cashierId: filters.cashierId,
  customerId: filters.customerId,
  method: filters.method,
  status: filters.status,
  q: filters.q.trim(),
  minTotal: filters.minTotal,
  maxTotal: filters.maxTotal,
});

export function listSales(filters: SaleFilters, cursor: string | null, limit = 50) {
  return apiFetch<SaleListPage>(
    withQuery('/v1/sales', { ...filterQuery(filters), cursor, limit: String(limit) }),
    { auth: true },
  );
}

/** Count, total and returns of the same filters (the strip above the list). */
export function getSalesSummary(filters: SaleFilters) {
  return apiFetch<SaleSummary>(withQuery('/v1/sales/summary', filterQuery(filters)), { auth: true });
}

export function getSale(id: string) {
  return apiFetch<SaleDetail>(`/v1/sales/${encodeURIComponent(id)}`, { auth: true });
}
