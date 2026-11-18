import type {
  CommissionPlanInput,
  CommissionPlanRow,
  CommissionPlanUpdateInput,
  CustomerApprovalInput,
  CustomerDetail,
  DistributionSettings,
  NoSaleReasonInput,
  NoSaleReasonRow,
  NoSaleReasonUpdateInput,
  PickingList,
  RegionInput,
  RegionRow,
  RegionUpdateInput,
  RepCandidate,
  RepInput,
  RepRow,
  RepUpdateInput,
  RouteCustomersInput,
  RouteDetail,
  RouteInput,
  RouteRow,
  RouteUpdateInput,
  SalesOrderAssignInput,
  SalesOrderCancelInput,
  SalesOrderListQuery,
  SalesOrderRow,
  VanInput,
  VanRow,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

const get = <T>(url: string) => apiFetch<T>(url, { auth: true });
const send = <T>(method: 'POST' | 'PATCH' | 'PUT', url: string, body: unknown) =>
  apiFetch<T>(url, { method, body, auth: true });

// Regions, vans, reps and routes (routes.manage, on a plan with the reps module)
export const listRegions = () => get<RegionRow[]>('/v1/regions');
export const createRegion = (input: RegionInput) => send<RegionRow>('POST', '/v1/regions', input);
export const updateRegion = (id: string, input: RegionUpdateInput) =>
  send<RegionRow>('PATCH', `/v1/regions/${id}`, input);

export const listVans = () => get<VanRow[]>('/v1/vans');
export const createVan = (input: VanInput) => send<VanRow>('POST', '/v1/vans', input);
export const updateVan = (id: string, input: VanInput) => send<VanRow>('PATCH', `/v1/vans/${id}`, input);
export const setVanActive = (id: string, active: boolean) =>
  send<VanRow>('POST', `/v1/vans/${id}/active`, { active });

export const listReps = () => get<RepRow[]>('/v1/reps');
export const listRepCandidates = () => get<RepCandidate[]>('/v1/reps/candidates');
export const createRep = (input: RepInput) => send<RepRow>('POST', '/v1/reps', input);
export const updateRep = (id: string, input: RepUpdateInput) =>
  send<RepRow>('PATCH', `/v1/reps/${id}`, input);
export const setRepActive = (id: string, active: boolean) =>
  send<RepRow>('POST', `/v1/reps/${id}/active`, { active });

export const listRoutes = () => get<RouteRow[]>('/v1/routes');
export const getRoute = (id: string) => get<RouteDetail>(`/v1/routes/${id}`);
export const createRoute = (input: RouteInput) => send<RouteDetail>('POST', '/v1/routes', input);
export const updateRoute = (id: string, input: RouteUpdateInput) =>
  send<RouteDetail>('PATCH', `/v1/routes/${id}`, input);
export const setRouteCustomers = (id: string, input: RouteCustomersInput) =>
  send<RouteDetail>('PUT', `/v1/routes/${id}/customers`, input);

// Settings, no-sale reasons, commission plans
export const getSettings = () => get<DistributionSettings>('/v1/distribution/settings');
export const saveSettings = (input: DistributionSettings) =>
  send<DistributionSettings>('PUT', '/v1/distribution/settings', input);
export const listReasons = () => get<NoSaleReasonRow[]>('/v1/no-sale-reasons');
export const createReason = (input: NoSaleReasonInput) =>
  send<NoSaleReasonRow>('POST', '/v1/no-sale-reasons', input);
export const updateReason = (id: string, input: NoSaleReasonUpdateInput) =>
  send<NoSaleReasonRow>('PATCH', `/v1/no-sale-reasons/${id}`, input);
export const listPlans = () => get<CommissionPlanRow[]>('/v1/commission-plans');
export const createPlan = (input: CommissionPlanInput) =>
  send<CommissionPlanRow>('POST', '/v1/commission-plans', input);
export const updatePlan = (id: string, input: CommissionPlanUpdateInput) =>
  send<CommissionPlanRow>('PATCH', `/v1/commission-plans/${id}`, input);

// Pre-sale orders (sales_orders.manage)
export function listOrders(query: Partial<SalesOrderListQuery> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  const text = params.toString();
  return get<SalesOrderRow[]>(`/v1/sales-orders${text ? `?${text}` : ''}`);
}
export const getOrder = (id: string) => get<SalesOrderRow>(`/v1/sales-orders/${id}`);
export const cancelOrder = (id: string, input: SalesOrderCancelInput) =>
  send<SalesOrderRow>('POST', `/v1/sales-orders/${id}/cancel`, input);
export const assignOrder = (id: string, input: SalesOrderAssignInput) =>
  send<SalesOrderRow>('POST', `/v1/sales-orders/${id}/assign`, input);
export const getPickingList = (warehouseBranchId: string, ids: string[] = []) =>
  get<PickingList>(
    `/v1/sales-orders/picking?warehouseBranchId=${warehouseBranchId}${ids.length > 0 ? `&ids=${ids.join(',')}` : ''}`,
  );

// A customer a rep added
export const approveCustomer = (id: string, input: CustomerApprovalInput) =>
  send<CustomerDetail>('POST', `/v1/customers/${id}/approval`, input);
