import type {
  OnboardingInput,
  StoreCurrencyInput,
  StoreProfileInput,
  StoreResponse,
  StoreScaleInput,
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
