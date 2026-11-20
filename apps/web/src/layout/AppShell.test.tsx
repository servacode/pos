import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse, Permission, SectorKey } from '@serva/core';
import { THEME_STORAGE_KEY } from '@serva/ui';
import { mockFetch, type MockReply } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { initials, SIDEBAR_STORAGE_KEY, splitPending } from './AppShell';
import { navFor, navSectionsFor } from './nav';

function signedIn(
  permissions?: Permission[],
  sectors?: SectorKey[],
  path = '/',
  routes: Record<string, MockReply> = {},
  subscription: Partial<MeResponse['subscription']> = {},
) {
  const base = makeMe(subscription);
  const me = sectors ? { ...base, tenant: { ...base.tenant, sectors } } : base;
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: permissions ? { ...me, user: { ...me.user, permissions } } : me },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

/** The top bar once the session is restored (until then the shell's skeleton has a banner too) */
async function signedInBar() {
  await screen.findAllByRole('button', { name: 'ابحث عن منتج أو زبون أو دفعة' });
  return screen.getByRole('banner');
}

/** A waiting order of the online shop: an order to accept, or a hold paid with a deposit. */
const pending = (id: string, source: 'shop' | 'hold') => ({ id, source, status: 'pending' });

afterEach(() => {
  localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  localStorage.removeItem(THEME_STORAGE_KEY);
  delete document.documentElement.dataset.theme;
});

describe('AppShell', () => {
  it('lists only screens that exist, with no «قريباً» items', async () => {
    signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'التقارير', 'الإعدادات']);
    expect(within(nav).getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('قريباً');
  });

  it('keeps the whole store name in the breadcrumb: a hover title, and up to two lines on every width, never cut with dots', async () => {
    signedIn();
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    const crumb = within(screen.getByRole('navigation', { name: 'أنت هنا' })).getByRole('link');
    const name = within(crumb).getByTitle(makeMe().tenant.name);
    expect(name).toHaveClass('line-clamp-2');
    expect(name).not.toHaveClass('truncate');
    expect(name.className).not.toMatch(/sm:/);
  });

  it('keeps its controls reachable: the menu, the account and the search are all there to use', async () => {
    const { user } = signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    const targets = [
      ...within(nav).getAllByRole('link'),
      screen.getByRole('link', { name: 'سيرفا، الرئيسية' }),
      screen.getByRole('button', { name: /خروج/ }),
      screen.getByRole('link', { name: 'رمز الدخول للكاشير' }),
      screen.getAllByRole('button', { name: 'ابحث عن منتج أو زبون أو دفعة' })[0]!,
    ];
    for (const target of targets) expect(target).toBeVisible();
  });

  it('links the legal texts from the account menu, in a new tab', async () => {
    const { user } = signedIn();

    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    const link = screen.getByRole('link', { name: 'الشروط والخصوصية' });
    expect(link).toHaveAttribute('href', '/terms');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows each section only to whoever holds its permission key', async () => {
    signedIn(['catalog.manage', 'devices.view']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'المنتجات', 'العروض', 'التقارير', 'الإعدادات']);
  });

  it('gives the owner with the report and accounting keys every report, in the menu order', async () => {
    signedIn([
      'catalog.manage',
      'devices.view',
      'reports.financial',
      'report.view',
      'accounting.view',
    ] as Permission[]);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'المبيعات', 'المنتجات', 'العروض', 'التقارير', 'الإعدادات']);
    expect(within(nav).getByRole('link', { name: 'المبيعات' })).toHaveAttribute('href', '/sales/today');
  });

  it('does not show the shifts to a key that only closes shifts at the till: the list needs report.view', async () => {
    signedIn(['shift.close_any']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await waitFor(() => {
      const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['الرئيسية']);
    });
  });

  it('gives a cashier only the home page, and their own sign-in code', async () => {
    const { user } = signedIn(['sale.create']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية']);
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    expect(screen.getByRole('link', { name: 'رمز الدخول للكاشير' })).toHaveAttribute('href', '/me/pin');
    expect(screen.queryByRole('link', { name: /الاشتراك/ })).not.toBeInTheDocument();
  });

  it('puts the menu in titled groups', async () => {
    signedIn(['catalog.manage', 'customers.view', 'devices.view', 'report.view']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    for (const title of ['البيع والزبائن', 'المنتجات والمخزون', 'التقارير والإعدادات']) {
      expect(within(nav).getByText(title)).toBeInTheDocument();
    }
  });

  it('shows the pages of the current section as tabs, and marks the section in the menu', async () => {
    signedIn(['catalog.manage'], undefined, '/prices');
    const tabs = await screen.findByRole('navigation', { name: 'صفحات المنتجات' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'المنتجات',
      'التصنيفات',
      'تغيير الأسعار',
      'تحديث الأسعار',
      'سجل الأسعار',
      'الملصقات',
      'الاستيراد',
    ]);
    // a shortened tab still carries the page's full name for a screen reader
    expect(within(tabs).getByRole('link', { name: 'تحديث الأسعار من ملف' })).toBeInTheDocument();
    expect(within(tabs).getByRole('link', { name: 'تغيير الأسعار' })).toHaveAttribute('aria-current', 'page');
    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'المنتجات' })).toHaveAttribute('aria-current', 'page');
  });

  it('says where you are: the store, the section and the page', async () => {
    signedIn(['catalog.manage'], undefined, '/prices');
    const crumbs = await screen.findByRole('navigation', { name: 'أنت هنا' });
    expect(within(crumbs).getByRole('link', { name: 'المنتجات' })).toHaveAttribute('href', '/products');
    expect(within(crumbs).getByText('تغيير الأسعار')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the till from the top bar, away from the home page that has its own button', async () => {
    signedIn(['sale.create', 'catalog.manage'], undefined, '/prices');
    const bar = await signedInBar();
    expect(within(bar).getByRole('link', { name: /افتح الكاشير/ })).toHaveAttribute('href', '/pos');
  });

  it('jumps to any page it may open from the page search', async () => {
    const { user } = signedIn(['catalog.manage', 'devices.view']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.keyboard('{Control>}k{/Control}');
    const list = await screen.findByRole('listbox', { name: 'الصفحات' });
    expect(within(list).queryByRole('button', { name: /الورديات/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'اسم الصفحة' }), 'الأسعار');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('navigation', { name: 'صفحات المنتجات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'تغيير الأسعار' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows no tabs for a section of one page', async () => {
    signedIn(['catalog.manage'], undefined, '/');
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(screen.queryByRole('navigation', { name: /^صفحات/ })).not.toBeInTheDocument();
  });

  it('folds the sidebar to a rail of icons, and keeps the fold on this device for the next page', async () => {
    const { user } = signedIn(['catalog.manage']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(screen.getByRole('complementary')).toHaveAttribute('data-rail', 'false');

    await user.click(screen.getByRole('button', { name: 'طيّ القائمة' }));

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
    expect(screen.getByRole('complementary')).toHaveAttribute('data-rail', 'true');
    // Only the icons show (the stylesheet hides the words visually); they stay the links' names.
    const products = within(nav).getByRole('link', { name: 'المنتجات' });
    expect(within(products).getByText('المنتجات')).toHaveClass('sh-t');

    // Every page mounts its own frame: the next one opens folded too.
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    await user.click(screen.getByRole('link', { name: 'رمز الدخول للكاشير' }));
    expect(await screen.findByRole('heading', { name: 'رمز الدخول للكاشير', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'توسيع القائمة' }));
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded');
    expect(screen.getByRole('complementary')).toHaveAttribute('data-rail', 'false');
  });

  it('opens folded when this device chose it', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    signedIn(['catalog.manage']);
    expect(await screen.findByRole('button', { name: 'توسيع القائمة' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveAttribute('data-rail', 'true');
  });

  it('opens the menu as a drawer on a phone, closed by a chosen page', async () => {
    const { user } = signedIn(['catalog.manage']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });

    await user.click(screen.getByRole('button', { name: 'افتح القائمة' }));
    const drawer = await screen.findByRole('dialog', { name: 'القائمة' });
    const nav = within(drawer).getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'المنتجات', 'العروض']);

    await user.click(within(nav).getByRole('link', { name: 'الرئيسية' }));
    expect(screen.queryByRole('dialog', { name: 'القائمة' })).not.toBeInTheDocument();
  });

  it('shows the Ctrl K hint to an owner, not to a cashier with a handful of pages', async () => {
    signedIn([
      'catalog.manage',
      'customers.view',
      'devices.view',
      'report.view',
      'purchases.manage',
      'sale.create',
    ]);
    const ownerBar = await signedInBar();
    expect(within(ownerBar).getByText('Ctrl K')).toBeInTheDocument();
    cleanup();

    signedIn(['sale.create']);
    const cashierBar = await signedInBar();
    expect(within(cashierBar).queryByText('Ctrl K')).not.toBeInTheDocument();
  });

  it('switches the theme from the top bar', async () => {
    const { user } = signedIn();
    const bar = await signedInBar();

    await user.click(within(bar).getByRole('button', { name: 'تبديل المظهر' }));
    await user.click(
      within(screen.getByRole('menu', { name: 'المظهر' })).getByRole('menuitemradio', { name: 'داكن' }),
    );

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('says so in the top bar when the connection is lost, and nothing while online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      signedIn();
      const bar = await signedInBar();
      expect(within(bar).getByText('دون إنترنت')).toBeInTheDocument();
      onLine.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(within(bar).queryByText('دون إنترنت')).not.toBeInTheDocument());
    } finally {
      onLine.mockRestore();
    }
  });

  it('hides what a clothing store does not use: expiry, serial numbers and cheques', () => {
    const me = { ...makeMe(), tenant: { sectors: ['clothing'] as SectorKey[] } };
    const user = {
      ...me.user,
      permissions: ['catalog.manage', 'customers.view', 'purchases.manage'] as Permission[],
    };
    const pages = navFor({ ...me, user }).map((page) => page.label);
    expect(pages).toContain('المنتجات');
    expect(pages).toContain('المشتريات');
    expect(pages).not.toContain('الصلاحية');
    expect(pages).not.toContain('الأرقام التسلسلية');
    expect(pages).not.toContain('الشيكات');
  });

  it('shows expiry dates to a pharmacy, in the stock section', async () => {
    signedIn(['purchases.manage'], ['pharmacy']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'المخزون' })).toHaveAttribute('href', '/expiry');
  });

  it('groups cheques, expenses and debt ageing under «المال», and rentals, maintenance and warranty under «الخدمات»', async () => {
    const me = { ...makeMe(), tenant: { sectors: ['electronics'] as SectorKey[] } };
    const user = {
      ...me.user,
      permissions: ['catalog.manage', 'customers.view', 'expenses.manage'] as Permission[],
    };
    const labelsIn = (section: string) =>
      navSectionsFor({ ...me, user })
        .find((s) => s.key === section)
        ?.pages.map((page) => page.label);
    expect(labelsIn('money')).toEqual(['الشيكات', 'المصاريف', 'أعمار الديون']);
    expect(labelsIn('services')).toEqual(['التأجير', 'عقود الصيانة', 'طلبات الكفالة']);
    // None of them is a tab of the customers any more, and the routes are unchanged
    expect(labelsIn('customers')).not.toContain('الشيكات');
    expect(navFor({ ...me, user }).find((page) => page.label === 'الشيكات')?.to).toBe('/cheques');
    signedIn(['catalog.manage', 'customers.view', 'expenses.manage'], ['electronics']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'المال' })).toHaveAttribute('href', '/cheques');
    expect(within(nav).getByRole('link', { name: 'الخدمات' })).toHaveAttribute('href', '/rentals');
  });

  it('leaves «المال» and «الخدمات» out for a store that uses none of it', () => {
    const me = { ...makeMe(), tenant: { sectors: ['clothing'] as SectorKey[] } };
    const user = { ...me.user, permissions: ['catalog.manage'] as Permission[] };
    const keys = navSectionsFor({ ...me, user }).map((s) => s.key);
    expect(keys).not.toContain('services');
    expect(keys).not.toContain('money');
  });

  it("shows the store name's initials, skipping words like «متجر»", () => {
    expect(initials('متجر أحمد نور')).toBe('أن');
    expect(initials('سوبرماركت الياسمين')).toBe('ا');
    expect(initials('متجر')).toBe('م');
  });
});

describe('the notices (the bell)', () => {
  const ordersAndTrial = () =>
    signedIn(
      ['customers.view', 'subscription.manage'],
      undefined,
      '/',
      {
        'GET /v1/online-orders?status=pending': {
          status: 200,
          body: {
            items: [
              { ...pending('o-1', 'shop'), customerName: 'سلمى', createdAt: new Date().toISOString() },
              { ...pending('o-2', 'shop'), createdAt: new Date(Date.now() - 600_000).toISOString() },
              { ...pending('o-3', 'hold'), createdAt: new Date(Date.now() - 86_400_000).toISOString() },
            ],
          },
        },
      },
      { status: 'trialing', daysLeft: 2 },
    );

  it('lists the online shop’s waiting orders, each a link to where it is dealt with, grouped by day; the trial is not repeated here', async () => {
    const { user } = ordersAndTrial();

    // Two kinds wait (the orders, the hold): two unread notices. The trial is the sidebar card's alone.
    const bell = await screen.findByRole('button', { name: 'التنبيهات (2)' });
    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: /المتجر الإلكتروني/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /إدارة الاشتراك/ })).toHaveTextContent('باقي يومان');

    await user.click(bell);
    const pop = screen.getByRole('dialog', { name: 'الإشعارات' });
    const orders = within(pop).getByRole('link', { name: /طلبات جديدة من المتجر الإلكتروني/ });
    expect(orders).toHaveAttribute('href', '/online-store');
    expect(orders).toHaveTextContent('آخرها من سلمى');
    expect(orders).toHaveTextContent('غير مقروء');
    expect(within(pop).getByRole('link', { name: /قطعة محجوزة بعربون/ })).toHaveAttribute(
      'href',
      '/online-store',
    );
    expect(within(pop).queryByText(/باقي يومان/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'اليوم' })).getByRole('link', { name: /طلبات جديدة/ }),
    ).toBe(orders);
    expect(
      within(screen.getByRole('region', { name: 'أمس' })).getByRole('link', { name: /قطعة محجوزة/ }),
    ).toBeVisible();
  });

  it('marks all read for this user on this device, and closes on Esc', async () => {
    const { user } = ordersAndTrial();
    await user.click(await screen.findByRole('button', { name: 'التنبيهات (2)' }));
    await user.click(screen.getByRole('button', { name: 'تعليم الكل كمقروء' }));
    expect(screen.getByRole('button', { name: 'التنبيهات' })).toBeInTheDocument();
    expect(localStorage.getItem('serva.notices.read.user-1')).toContain('orders');
    expect(screen.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /غير المقروءة/ }));
    expect(screen.getByText('لا إشعارات غير مقروءة')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'الإشعارات' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'التنبيهات' })).toHaveFocus();
  });

  it('says when nothing waits', async () => {
    const { user } = signedIn(['customers.view'], undefined, '/', {
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
    });

    await user.click(await screen.findByRole('button', { name: 'التنبيهات' }));
    const pop = screen.getByRole('dialog', { name: 'الإشعارات' });
    expect(within(pop).getByText('لا تنبيهات جديدة')).toBeInTheDocument();
    expect(within(pop).queryByRole('link', { name: /طلب/ })).not.toBeInTheDocument();
  });

  it('asks for the orders only with customers.view, and shows no bell to whoever gets no notices', async () => {
    const { requestsTo } = signedIn(['sale.create']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(screen.queryByRole('button', { name: /التنبيهات/ })).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/online-orders?status=pending')).toHaveLength(0);
  });
});

describe('the shop’s pending list', () => {
  it('splits into new orders, cancel requests and holds that add up to the badge', () => {
    const items = [
      { id: '1', source: 'shop', status: 'pending' },
      { id: '2', source: 'shop', status: 'cancel_requested' },
      { id: '3', source: 'hold', status: 'pending' },
      { id: '4', source: 'hold', status: 'pending' },
    ] as never[];
    expect(splitPending(items)).toEqual({ newOrders: 1, cancelRequests: 1, holds: 2 });
    expect(splitPending([])).toEqual({ newOrders: 0, cancelRequests: 0, holds: 0 });
  });

  it('gives a cancel request its own line under the bell, not a «new order»', async () => {
    const { user } = signedIn(['customers.view'], undefined, '/', {
      'GET /v1/online-orders?status=pending': {
        status: 200,
        body: { items: [{ id: 'o-1', source: 'shop', status: 'cancel_requested' }] },
      },
    });
    await user.click(await screen.findByRole('button', { name: 'التنبيهات (1)' }));
    const pop = screen.getByRole('dialog', { name: 'الإشعارات' });
    expect(within(pop).getByText('زبون يطلب إلغاء طلبه')).toBeInTheDocument();
    expect(within(pop).queryByText(/طلب جديد/)).not.toBeInTheDocument();
  });

  it('asks again when the window gets focus after the last answer went stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { requestsTo } = signedIn(['customers.view'], undefined, '/', {
        'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      });
      await screen.findByRole('button', { name: 'التنبيهات' });
      expect(requestsTo('GET', '/v1/online-orders?status=pending')).toHaveLength(1);
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => expect(requestsTo('GET', '/v1/online-orders?status=pending')).toHaveLength(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the page search (Ctrl K)', () => {
  it('is a combobox over a listbox, and finds «الأسعار» typed as the stem «سعر»', async () => {
    const { user } = signedIn(['catalog.manage', 'devices.view']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.keyboard('{Control>}k{/Control}');
    const box = await screen.findByRole('combobox', { name: 'اسم الصفحة' });
    await user.type(box, 'سعر');
    const list = await screen.findByRole('listbox', { name: 'الصفحات' });
    expect(within(list).getAllByRole('option', { name: /الأسعار/ }).length).toBeGreaterThan(0);
    // The arrow keys move the active option the screen reader hears
    expect(box).toHaveAttribute('aria-activedescendant', within(list).getAllByRole('option')[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', within(list).getAllByRole('option')[1]!.id);
  });
});

describe('the signed-in profile', () => {
  it('is read again when the tab comes back after minutes, not on every focus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { requestsTo } = signedIn(['catalog.manage']);
      await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
      const before = requestsTo('GET', '/v1/me').length;
      window.dispatchEvent(new Event('focus'));
      expect(requestsTo('GET', '/v1/me')).toHaveLength(before);
      vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => expect(requestsTo('GET', '/v1/me')).toHaveLength(before + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});
