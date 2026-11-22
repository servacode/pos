import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, StoreResponse } from '@serva/core';
import { apiError, mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import './SettingsPage';

const store: StoreResponse = {
  name: 'مقهى الشام',
  legalName: null,
  taxNumber: null,
  sectors: ['supermarket'],
  address: null,
  phone: null,
  receiptFooter: null,
  baseCurrency: 'SYP',
  enabledCurrencies: ['SYP'],
  taxInclusive: true,
  usdRate: null,
  onboarding: { step: 4, done: true },
  scaleBarcode: null,
  service: null,
  loyalty: null,
};

function owner(subscription: Partial<MeResponse['subscription']> = {}): MeResponse {
  const base = makeMe(subscription);
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] } };
}

describe('«بيانات المتجر» in the settings', () => {
  it('offers the import and downloads the whole store, also when the subscription has lapsed', async () => {
    const created = vi.fn(() => 'blob:export');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.fn();
    HTMLAnchorElement.prototype.click = click;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: owner({ status: 'suspended', readOnly: true, lifecycle: 'read_only', daysLeft: 0 }),
      }),
      'GET /v1/store': () => ({ status: 200, body: store }),
      'GET /v1/export': {
        status: 200,
        body: 'PK',
        headers: { 'Content-Disposition': 'attachment; filename="serva-export-2026-11-12.zip"' },
      },
    });
    const { user } = renderApp('/settings');
    expect(await screen.findByRole('link', { name: 'استيراد البيانات' })).toHaveAttribute('href', '/import');
    await user.click(screen.getByRole('button', { name: 'نزّل كل بيانات المتجر' }));
    await screen.findByText(/نزل الملف/);
    expect(requestsTo('GET', '/v1/export')).toHaveLength(1);
    expect(created).toHaveBeenCalled();
    await waitFor(() => expect(click).toHaveBeenCalled());
  });

  it('says why when the export is refused', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: store }),
      'GET /v1/export': apiError(429, 'rate_limited', 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.'),
    });
    const { user } = renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'نزّل كل بيانات المتجر' }));
    expect(await screen.findByText('محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.')).toBeInTheDocument();
  });
});
