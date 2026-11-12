import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse, Permission, SectorKey } from '@serva/core';
import { THEME_STORAGE_KEY } from '@serva/ui';
import { mockFetch, type MockReply } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { initials, SIDEBAR_STORAGE_KEY } from './AppShell';
import { navFor } from './nav';

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

/** A waiting order of the online shop: an order to accept, or a hold paid with a deposit. */
const pending = (id: string, source: 'shop' | 'hold') => ({ id, source, status: 'pending' });

/** Under a finger every target is 48 (the admin's controls are 40 with a mouse: هوية 4 › Size). */
const TOUCH_TARGET = /(?:^|\s)(?:pointer-coarse:)?min-h-12(?:\s|$)/;

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

  it('gives every link and button a 48 px target under a finger', async () => {
    const { user } = signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    const targets = [
      ...within(nav).getAllByRole('link'),
      screen.getByRole('link', { name: 'سيرفا، الرئيسية' }),
      screen.getByRole('button', { name: /خروج/ }),
      screen.getByRole('link', { name: 'رمز الدخول للكاشير' }),
      screen.getAllByRole('button', { name: 'ابحث عن صفحة' })[0]!,
    ];
    for (const target of targets) expect(target.className).toMatch(TOUCH_TARGET);
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

  it('shows the shifts to a manager who may close any shift, without the books', async () => {
    signedIn(['shift.close_any']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'المبيعات']);
    expect(within(nav).getByRole('link', { name: 'المبيعات' })).toHaveAttribute('href', '/shifts');
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
    for (const title of ['البيع والزبائن', 'البضاعة', 'الإدارة']) {
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
      'تحديث الأسعار من ملف',
      'طباعة الملصقات',
      'استيراد البيانات',
    ]);
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
    const bar = await screen.findByRole('banner');
    expect(within(bar).getByRole('link', { name: /افتح الكاشير/ })).toHaveAttribute('href', '/pos');
  });

  it('jumps to any page it may open from the page search', async () => {
    const { user } = signedIn(['catalog.manage', 'devices.view']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    await user.keyboard('{Control>}k{/Control}');
    const list = await screen.findByRole('list', { name: 'الصفحات' });
    expect(within(list).queryByRole('button', { name: /الورديات/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'اسم الصفحة' }), 'الأسعار');
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
    expect(screen.getByRole('complementary')).toHaveClass('w-66');

    await user.click(screen.getByRole('button', { name: 'طيّ القائمة' }));

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
    expect(screen.getByRole('complementary')).toHaveClass('w-18');
    // Only the icons show; the words stay the links' names.
    const products = within(nav).getByRole('link', { name: 'المنتجات' });
    expect(within(products).getByText('المنتجات')).toHaveClass('sr-only');

    // Every page mounts its own frame: the next one opens folded too.
    await user.click(screen.getByRole('button', { name: /^حسابي/ }));
    await user.click(screen.getByRole('link', { name: 'رمز الدخول للكاشير' }));
    expect(await screen.findByRole('heading', { name: 'رمز الدخول للكاشير', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'توسيع القائمة' }));
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded');
    expect(screen.getByRole('complementary')).toHaveClass('w-66');
  });

  it('opens folded when this device chose it', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    signedIn(['catalog.manage']);
    expect(await screen.findByRole('button', { name: 'توسيع القائمة' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveClass('w-18');
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

  it('switches the theme from the top bar', async () => {
    const { user } = signedIn();
    const bar = await screen.findByRole('banner');

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
      const bar = await screen.findByRole('banner');
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

  it("shows the store name's initials, skipping words like «متجر»", () => {
    expect(initials('متجر أحمد نور')).toBe('أن');
    expect(initials('سوبرماركت الياسمين')).toBe('ا');
    expect(initials('متجر')).toBe('م');
  });
});

describe('the notices (the bell)', () => {
  it('lists the online shop’s waiting orders and a trial about to end, each a link to where it is dealt with', async () => {
    const { user } = signedIn(
      ['customers.view', 'subscription.manage'],
      undefined,
      '/',
      {
        'GET /v1/online-orders?status=pending': {
          status: 200,
          body: { items: [pending('o-1', 'shop'), pending('o-2', 'shop'), pending('o-3', 'hold')] },
        },
      },
      { status: 'trialing', daysLeft: 2 },
    );

    // Two orders, one hold, and a trial with two days left: four things wait.
    const bell = await screen.findByRole('button', { name: 'التنبيهات (4)' });
    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: /المتجر الإلكتروني/ })).toHaveTextContent('3');

    await user.click(bell);
    const menu = screen.getByRole('menu', { name: 'التنبيهات' });
    expect(within(menu).getByRole('menuitem', { name: /طلبات جديدة من المتجر الإلكتروني/ })).toHaveAttribute(
      'href',
      '/online-store',
    );
    expect(within(menu).getByRole('menuitem', { name: /قطعة محجوزة بعربون/ })).toHaveAttribute(
      'href',
      '/online-store',
    );
    expect(within(menu).getByRole('menuitem', { name: /باقي يومان من الباقة المجانية/ })).toHaveAttribute(
      'href',
      '/subscription',
    );
  });

  it('says when nothing waits', async () => {
    const { user } = signedIn(['customers.view'], undefined, '/', {
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
    });

    await user.click(await screen.findByRole('button', { name: 'التنبيهات' }));
    const menu = screen.getByRole('menu', { name: 'التنبيهات' });
    expect(within(menu).getByText('لا تنبيهات جديدة')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('asks for the orders only with customers.view, and shows no bell to whoever gets no notices', async () => {
    const { requestsTo } = signedIn(['sale.create']);
    await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(screen.queryByRole('button', { name: /التنبيهات/ })).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/online-orders?status=pending')).toHaveLength(0);
  });
});
