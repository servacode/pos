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
    await user.click((await screen.findAllByRole('button', { name: 'ابحث عن منتج أو زبون أو دفعة' }))[0]!);
    const box = await screen.findByRole('textbox', { name: 'اسم الصفحة' });
    await user.type(box, 'ش');
    expect(requests.some((r) => r.path.startsWith('/v1/products?q='))).toBe(false);
    await user.type(box, 'اش');
    expect(await screen.findByRole('button', { name: /شاش طبي/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /مشفى الشاش/ })).toBeInTheDocument());
  });
});

describe('the search box finds purchase invoices', () => {
  it('lists a PUR number with its supplier and opens the purchases list on it', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['purchases.manage']) },
      'GET /v1/suppliers': { status: 200, body: { items: [] } },
      'GET /v1/purchases': {
        status: 200,
        body: {
          items: [
            { id: 'u-1', number: 'PUR-000012', supplierName: 'مورد الشفاء', reference: null },
            { id: 'u-2', number: 'PUR-000013', supplierName: 'مورد آخر', reference: 'ABC' },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/inventory/recall?batchNo=PUR-000012': { status: 200, body: { batches: [] } },
    });
    const { user } = renderApp('/products');
    await user.click((await screen.findAllByRole('button', { name: 'ابحث عن منتج أو زبون أو دفعة' }))[0]!);
    await user.type(await screen.findByRole('textbox', { name: 'اسم الصفحة' }), 'PUR-000012');
    const hit = await screen.findByRole('button', { name: /PUR-000012/ });
    expect(hit).toHaveTextContent('مورد الشفاء');
    expect(screen.queryByRole('button', { name: /PUR-000013/ })).not.toBeInTheDocument();
  });
});

describe('the search box finds online orders, rentals and cheques', () => {
  it('lists each by its number under its own group', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['customers.view']) },
      'GET /v1/customers?q=11': { status: 200, body: { items: [] } },
      'GET /v1/online-orders': {
        status: 200,
        body: { items: [{ id: 'o-1', number: 'ONL-1100', customerName: 'ريم', phone: '0999' }] },
      },
      'GET /v1/rentals?status=all': {
        status: 200,
        body: { items: [{ id: 'r-1', number: 'RNT-1101', item: 'كرسي', customerName: 'هدى' }] },
      },
      'GET /v1/cheques': {
        status: 200,
        body: {
          items: [
            {
              sourceType: 'invoice',
              sourceId: 'i-1',
              paymentNo: 1,
              documentNumber: 'INV-1',
              reference: 'CH-1102',
              customerName: 'سامر',
            },
          ],
        },
      },
    });
    const { user } = renderApp('/products');
    await user.click((await screen.findAllByRole('button', { name: 'ابحث عن منتج أو زبون أو دفعة' }))[0]!);
    await user.type(await screen.findByRole('textbox', { name: 'اسم الصفحة' }), '11');
    expect(await screen.findByRole('button', { name: /ONL-1100/ })).toHaveTextContent('ريم');
    expect(await screen.findByRole('button', { name: /RNT-1101/ })).toHaveTextContent('كرسي');
    expect(await screen.findByRole('button', { name: /CH-1102/ })).toHaveTextContent('سامر');
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
