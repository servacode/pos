import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

const meWith = (permissions: string[]) => {
  const me = makeMe();
  return { ...me, user: { ...me.user, permissions } };
};

afterEach(() => localStorage.removeItem('serva.trialBannerDismissed'));

describe('the search box finds records as well as pages', () => {
  it('lists a product and a customer under the pages, and asks nothing for one letter', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['catalog.manage', 'customers.view']) },
      'GET /v1/products?q=%D8%B4%D8%A7%D8%B4&limit=4': {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'شاش طبي', categoryName: 'مستهلكات' }], nextCursor: null },
      },
      'GET /v1/customers?q=%D8%B4%D8%A7%D8%B4': {
        status: 200,
        body: { items: [{ id: 'c-1', name: 'مشفى الشاش', phone: '0999' }] },
      },
    });
    const { user } = renderApp('/products');
    await user.click((await screen.findAllByRole('button', { name: 'ابحث عن صفحة' }))[0]!);
    const box = await screen.findByRole('textbox', { name: 'اسم الصفحة' });
    await user.type(box, 'ش');
    expect(requests.some((r) => r.path.startsWith('/v1/products?q='))).toBe(false);
    await user.type(box, 'اش');
    expect(await screen.findByRole('button', { name: /شاش طبي/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /مشفى الشاش/ })).toBeInTheDocument());
  });
});

describe('the trial banner', () => {
  it('can be hidden on this device', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe({ status: 'trialing', daysLeft: 12 }) },
    });
    const { user } = renderApp('/');
    expect(await screen.findByText('باقي 12 يوماً من الباقة المجانية')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أخفِ هذا الشريط' }));
    expect(screen.queryByText('باقي 12 يوماً من الباقة المجانية')).not.toBeInTheDocument();
    expect(localStorage.getItem('serva.trialBannerDismissed')).toBe('1');
  });
});
