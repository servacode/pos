import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SectorKey } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

function open(path: string, sectors: SectorKey[]) {
  const base = makeMe();
  const me = {
    ...base,
    tenant: { ...base.tenant, sectors },
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'purchases.manage', 'pharmacy.controlled'],
    },
  };
  mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: me },
    'GET /v1/expiry': { status: 200, body: { items: [], baseCurrency: 'SYP' } },
  });
  return renderApp(path);
}

describe('screens of other business types', () => {
  it('say so when opened by address in a store without that type', async () => {
    open('/controlled-register', ['clothing']);
    expect(await screen.findByText('هذه الشاشة لا تخص نشاط محلّك')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'إعدادات المتجر' })).toBeInTheDocument();
  });

  it('say so for expiry and serials in a clothing store', async () => {
    open('/expiry', ['clothing']);
    expect(await screen.findByText('هذه الشاشة لا تخص نشاط محلّك')).toBeInTheDocument();
  });

  it('do not get in the way in a store that has the type', async () => {
    open('/expiry', ['supermarket']);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('هذه الشاشة لا تخص نشاط محلّك')).toBeNull();
  });
});
