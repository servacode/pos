import type {
  CatalogOptions,
  OnboardingInput,
  PharmacySettings,
  TillSettings,
  StoreCurrencyInput,
  StoreProfileInput,
  StoreLoyaltyInput,
  StoreResponse,
  StoreScaleInput,
  StoreServiceInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/store`: the store's settings (packages/core › contracts/store.ts) */
export const getStore = () => apiFetch<StoreResponse>('/v1/store', { auth: true });

/** `PUT /v1/store/profile`: name, activity and what the receipt shows (settings.manage) */
export const saveProfile = (input: StoreProfileInput) =>
  apiFetch<StoreResponse>('/v1/store/profile', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/currency`: the dollar, its rate, and whether prices include tax (settings.manage) */
export const saveCurrency = (input: StoreCurrencyInput) =>
  apiFetch<StoreResponse>('/v1/store/currency', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/onboarding`: the wizard's step, or that it is over */
export const saveOnboarding = (input: OnboardingInput) =>
  apiFetch<StoreResponse>('/v1/store/onboarding', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/scale`: how the store's scales print their labels, or null for none (settings.manage) */
export const saveScale = (input: StoreScaleInput) =>
  apiFetch<StoreResponse>('/v1/store/scale', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/service`: tables, order numbers and kitchen tickets, or null for none (settings.manage) */
export const saveService = (input: StoreServiceInput) =>
  apiFetch<StoreResponse>('/v1/store/service', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/loyalty`: the loyalty points' rates, or null for none (settings.manage) */
export const saveLoyalty = (input: StoreLoyaltyInput) =>
  apiFetch<StoreResponse>('/v1/store/loyalty', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/pharmacy`: is a prescription's number and doctor required at the till (settings.manage) */
export const savePharmacy = (input: PharmacySettings) =>
  apiFetch<StoreResponse>('/v1/store/pharmacy', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/till`: the return window and whether a card payment needs its approval number (settings.manage) */
export const saveTill = (input: TillSettings) =>
  apiFetch<StoreResponse>('/v1/store/till', { method: 'PUT', body: input, auth: true });

/** `PUT /v1/store/catalog-options`: barcode generation for new variants and the size runs (catalog.manage) */
export const saveCatalogOptions = (input: CatalogOptions) =>
  apiFetch<StoreResponse>('/v1/store/catalog-options', { method: 'PUT', body: input, auth: true });
