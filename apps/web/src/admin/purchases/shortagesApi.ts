import type { ShortagesResponse } from '@serva/core';
import { apiFetch } from '../../lib/api';

/** `GET /v1/pharmacy/shortages` (purchases.manage): what is under its minimum or was asked for and lacked */
export const listShortages = () => apiFetch<ShortagesResponse>('/v1/pharmacy/shortages', { auth: true });

/** `POST /v1/pharmacy/shortages/resolve` (purchases.manage): «تم توفيره», then the list again */
export const resolveShortages = (ids: string[]) =>
  apiFetch<ShortagesResponse>('/v1/pharmacy/shortages/resolve', {
    method: 'POST',
    body: { ids },
    auth: true,
  });
