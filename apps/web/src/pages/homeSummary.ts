import type { CurrencyCode } from '@serva/core';
import { apiFetch } from '../lib/api';

/** `GET /v1/me/home-summary`: the few numbers the home page needs, each only for who may open them */
export interface HomeSummary {
  baseCurrency: CurrencyCode;
  /** At least one invoice exists, on any day */
  hasEverSold: boolean;
  /** reports.financial: the cash in the drawers now, in the base currency */
  cashMinor: number | null;
  /** reports.financial: the dollars in the drawers (cents), when the store uses dollars */
  cashUsdMinor?: number | null;
  /** The latest dollar rate in liras (a decimal text), when the store uses dollars */
  usdRate: string | null;
  debts: {
    totalOwedMinor: number;
    overLimitCount: number;
    overLimitOne: { name: string; balanceMinor: number; creditLimitMinor: number } | null;
  } | null;
  photos: { goodsCount: number; withoutPhoto: number } | null;
  lowStock: {
    total: number;
    items: {
      variantId: string;
      productId: string;
      name: string;
      label: string | null;
      attributes: { name: string; value: string }[];
      stockQty: number;
      productPieces: number;
      productInStock: number;
    }[];
  } | null;
}

/** One branch's low pieces and drawer cash when `branchId` is given; the whole store otherwise */
export const getHomeSummary = (branchId: string | null = null) =>
  apiFetch<HomeSummary>(`/v1/me/home-summary${branchId ? `?branchId=${branchId}` : ''}`, { auth: true });
