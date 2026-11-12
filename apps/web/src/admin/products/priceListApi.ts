import type { PriceListApplied, PriceListPreview } from '@serva/core';
import { apiFetch } from '../../lib/api';
import type { PriceListFileRow } from './priceList';

export const previewPriceList = (rows: PriceListFileRow[]) =>
  apiFetch<PriceListPreview>('/v1/prices/list/preview', { method: 'POST', body: { rows }, auth: true });

export const applyPriceList = (fileName: string, changes: { variantId: string; newMinor: number }[]) =>
  apiFetch<PriceListApplied>('/v1/prices/list/apply', {
    method: 'POST',
    body: { fileName, changes },
    auth: true,
  });
