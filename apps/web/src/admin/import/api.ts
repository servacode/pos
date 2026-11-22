import type { ImportInput, ImportResponse } from '@serva/core';
import { apiDownload, apiFetch } from '../../lib/api';

/** One chunk of an import, dry or real (packages/core › contracts/import.ts). */
export const postImport = (body: ImportInput) =>
  apiFetch<ImportResponse>('/v1/import', { method: 'POST', body, auth: true });

/** The whole store as a ZIP (GET only, so it still works when the subscription has lapsed). */
export const downloadStoreExport = () => apiDownload('/v1/export');
