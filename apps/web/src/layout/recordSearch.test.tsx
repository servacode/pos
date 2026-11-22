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

const OPEN = 'ابحث عن منتج أو زبون أو دفعة';
const searchUrl = (q: string) => `GET /v1/me/search?q=${encodeURIComponent(q)}`;
const customerHit = {
  key: 'c:c-1',
  group: 'الزبائن',
  label: 'ريم',
  detail: '0999',
  to: '/customers/c-1',
};

describe('the search box finds records as well as pages', () => {
  it('lists a product and a customer under the pages, and asks nothing for one letter', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['catalog.manage', 'customers.view']) },
      'GET /v1/products?q=%D8%B4%D8%A7%D8%B4&limit=4': {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'شاش طبي', categoryName: 'مستهلكات' }], nextCursor: null },
      },
      [searchUrl('شاش')]: {
        status: 200,
        body: {
          items: [
            { key: 'c:c-2', group: 'الزبائن', label: 'مشفى الشاش', detail: '0999', to: '/customers/c-2' },
          ],
        },
      },
    });
    const { user } = renderApp('/products');
    // The page's own shell replaces the loading shell once its code arrives: open the box after that
    await screen.findByRole('heading', { level: 1, name: 'المنتجات' });
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    const box = await screen.findByRole('combobox', { name: 'ابحث في المتجر' });
    await user.type(box, 'ش');
    expect(requests.some((r) => r.path.startsWith('/v1/products?q='))).toBe(false);
    expect(requests.some((r) => r.path.startsWith('/v1/me/search'))).toBe(false);
    await user.type(box, 'اش');
    expect(await screen.findByRole('option', { name: /شاش طبي/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: /مشفى الشاش/ })).toBeInTheDocument());
  });
});

describe('the search box finds what the server finds by name or number', () => {
  it('lists a PUR number with its supplier, an order and a rental, each under its group', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['purchases.manage', 'customers.view', 'catalog.manage']) },
      [searchUrl('11')]: {
        status: 200,
        body: {
          items: [
            {
              key: 'u:u-1',
              group: 'فواتير الشراء',
              label: 'PUR-000011',
              detail: 'مورد الشفاء',
              to: '/purchases?q=PUR-000011',
            },
            {
              key: 'o:o-1',
              group: 'طلبات المتجر الإلكتروني',
              label: 'ONL-1100',
              detail: 'ريم',
              to: '/online-store',
            },
            { key: 'r:r-1', group: 'التأجير', label: 'RNT-1101', detail: 'كرسي · هدى', to: '/rentals' },
          ],
        },
      },
      'GET /v1/inventory/recall?batchNo=11': { status: 200, body: { batches: [] } },
    });
    const { user } = renderApp('/products');
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    await user.type(await screen.findByRole('combobox', { name: 'ابحث في المتجر' }), '11');
    expect(await screen.findByRole('option', { name: /PUR-000011/ })).toHaveTextContent('مورد الشفاء');
    expect(await screen.findByRole('option', { name: /ONL-1100/ })).toHaveTextContent('ريم');
    expect(await screen.findByRole('option', { name: /RNT-1101/ })).toHaveTextContent('كرسي');
    expect(await screen.findByText('ONL-1100')).toHaveAttribute('dir', 'ltr');
  });

  it('finds a cheque by its reference (the server finds it) and writes its date in words', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['customers.view']) },
      [searchUrl('11')]: {
        status: 200,
        body: {
          items: [
            {
              key: 'q:sale:i-1:1',
              group: 'الشيكات',
              label: 'بنك سورية · 1100 · 2026-12-01',
              detail: 'سامر',
              to: '/cheques',
            },
          ],
        },
      },
    });
    const { user } = renderApp('/products');
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    await user.type(await screen.findByRole('combobox', { name: 'ابحث في المتجر' }), '11');
    const cheque = await screen.findByRole('option', { name: /بنك سورية/ });
    expect(cheque).toHaveTextContent('01/12/2026');
    expect(cheque).not.toHaveTextContent('2026-12-01');
    // The cheques list is never downloaded for the search
    expect(requests.some((r) => r.path === '/v1/cheques')).toBe(false);
  });
});

describe('the search box is quick', () => {
  it('opens without downloading any list, and shows a record as soon as the server answers', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['customers.view', 'purchases.manage', 'catalog.manage']) },
      [searchUrl('ري')]: { status: 200, body: { items: [customerHit] } },
      [searchUrl('ريم')]: { status: 200, body: { items: [customerHit] } },
    });
    const { user } = renderApp('/products');
    await screen.findByRole('heading', { level: 1, name: 'المنتجات' });
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    const box = await screen.findByRole('combobox', { name: 'ابحث في المتجر' });
    // Opening the box fetched none of the lists the old search downloaded whole
    for (const list of [
      '/v1/suppliers',
      '/v1/purchases',
      '/v1/online-orders',
      '/v1/rentals',
      '/v1/cheques',
    ]) {
      expect(requests.some((r) => r.path === list)).toBe(false);
    }
    await user.type(box, 'ري');
    expect(await screen.findByRole('option', { name: /ريم/ })).toBeInTheDocument();
    await user.type(box, 'م');
    await screen.findByRole('option', { name: /ريم/ });
  });

  it('offers a cashier no customer or product tabs', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['sale.create']) },
    });
    const { user } = renderApp('/');
    // The frame drawn while the home page loads is swapped for the page's own: open the search on the page
    await screen.findByRole('heading', { name: /أهلاً/ });
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    await screen.findByRole('combobox', { name: 'ابحث في المتجر' });
    expect(screen.queryByRole('button', { name: 'زبائن' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'منتجات' })).not.toBeInTheDocument();
    // A cashier cannot open invoices or quotations either: no tab that cannot return a result
    expect(screen.queryByRole('button', { name: 'فواتير' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'صفحات' })).toBeInTheDocument();
  });

  it('never asks the quotations list for a person who may not open it', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(['sale.create']) },
    });
    const { user } = renderApp('/');
    // The frame drawn while the home page loads is swapped for the page's own: open the search on the page
    await screen.findByRole('heading', { name: /أهلاً/ });
    await user.click((await screen.findAllByRole('button', { name: OPEN }))[0]!);
    await user.type(await screen.findByRole('combobox', { name: 'ابحث في المتجر' }), 'رنا');
    await screen.findByText('لا صفحة ولا سجل بهذا الاسم.');
    expect(requests.some((r) => r.path === '/v1/quotations')).toBe(false);
  });
});

describe('the trial banner', () => {
  it('can be hidden on this device', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: (() => {
          const me = makeMe({ status: 'trialing', daysLeft: 12 });
          return {
            ...me,
            user: { ...me.user, permissions: [...me.user.permissions, 'subscription.manage'] },
          };
        })(),
      },
    });
    const { user } = renderApp('/');
    expect(await screen.findByText('باقي 12 يوماً من الباقة المجانية')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أخفِ هذا الشريط' }));
    expect(screen.queryByText('باقي 12 يوماً من الباقة المجانية')).not.toBeInTheDocument();
    expect(localStorage.getItem('serva.trialBannerDismissed.tenant-1')).toBe('1');
  });
});
