import type { RepDaySheet, RepVisitRecord } from '@serva/core/distribution';
import type { SalesOrderCreateInput } from '@serva/core';
import { call, type Answer } from '../pos/alterations/api';

/**
 * The rep phone's calls to the server (`Authorization: Device <token>`). Reading the day needs the
 * server; the rest are sent when it can be reached and kept on the device until then (state.ts).
 */

export const fetchRepDay = (token: string, fetchFn?: typeof fetch): Promise<Answer<RepDaySheet>> =>
  call<RepDaySheet>('/v1/device/rep/day', token, fetchFn);

export const postDayStart = (
  input: { businessDate: string; openingCash: Record<string, number>; loadConfirmed: boolean },
  token: string,
  fetchFn?: typeof fetch,
): Promise<Answer<{ id: string }>> => call('/v1/device/rep/day', token, fetchFn, input);

export interface VisitReport {
  id: string;
  businessDate: string;
  customerId: string;
  routeId: string | null;
  offRoute: boolean;
  arrivedAt: string;
  leftAt: string | null;
  lat: number | null;
  lng: number | null;
  outcome: 'sale' | 'order' | 'collection' | 'return' | 'no_sale' | 'none';
  noSaleReasonId: string | null;
  docIds: string[];
  note: string | null;
}

export const postVisit = (
  report: VisitReport,
  token: string,
  fetchFn?: typeof fetch,
): Promise<Answer<{ id: string }>> => call('/v1/device/rep/visits', token, fetchFn, report);

/** The blind van count of the day (thousandths); sent again it replaces the last one */
export const postVanCount = (
  input: { businessDate: string; lines: { variantId: string; counted: number }[] },
  token: string,
  fetchFn?: typeof fetch,
): Promise<Answer<{ id: string }>> => call('/v1/device/rep/van-count', token, fetchFn, input);

/** A pre-sale order; sent again with the same id it is the same order */
export const postOrder = (
  input: Pick<
    SalesOrderCreateInput,
    'id' | 'customerId' | 'warehouseBranchId' | 'repId' | 'currency' | 'lines' | 'deliveryDate' | 'note'
  >,
  token: string,
  fetchFn?: typeof fetch,
): Promise<Answer<{ id: string; number: string }>> => call('/v1/device/sales-orders', token, fetchFn, input);

export type { RepVisitRecord };
