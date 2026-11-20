import type { CurrencyCode } from '@serva/core';
import { apiFetch } from '../lib/api';

/** `GET /v1/me/home-summary`: the few numbers the home page needs, each only for who may open them */
export interface HomeSummary {
  baseCurrency: CurrencyCode;
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

export const getHomeSummary = () => apiFetch<HomeSummary>('/v1/me/home-summary', { auth: true });
