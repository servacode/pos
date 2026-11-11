import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { HomeIcon, InboxIcon } from '../icons';
import { renderUi } from '../test/render';
import { TextLink } from '../TextLink';
import { AdminShell, NavGroup, NavItem } from './AdminShell';
import { CashierShell, CashierStatusBar } from './CashierShell';
import { PhoneShell, PhoneTab } from './PhoneShell';

describe('AdminShell', () => {
  it('puts the sidebar first, so it sits on the right in Arabic, then the top bar and the content', () => {
    renderUi(
      <AdminShell
        sidebar={
          <nav aria-label="القائمة الرئيسية">
            <NavGroup label="اليوم">
              <li>
                <NavItem href="/" active icon={<HomeIcon size={24} />}>
                  الرئيسية
                </NavItem>
              </li>
              <li>
                <NavItem href="/inbox" icon={<InboxIcon size={24} />} count={3}>
                  بانتظارك
                </NavItem>
              </li>
            </NavGroup>
          </nav>
        }
        topBar={<p>بقالية أبو خليل</p>}
      >
        <h1>الرئيسية</h1>
      </AdminShell>,
    );

    const [aside, column] = [...screen.getByRole('complementary').parentElement!.children];
    expect(aside).toHaveClass('sticky');
    // هوية 4: the deep-emerald panel, floating on the page.
    expect(aside!.firstElementChild).toHaveClass('rounded-panel', 'bg-sidebar', 'text-sidebar-ink');
    expect(within(column as HTMLElement).getByRole('banner')).toHaveTextContent('بقالية أبو خليل');
    expect(screen.getByRole('main')).toHaveClass('max-w-330');

    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    const home = within(nav).getByRole('link', { name: 'الرئيسية' });
    expect(home).toHaveAttribute('aria-current', 'page');
    // 40 with a mouse, 48 under a finger; the open page on sidebar-active, in white.
    expect(home).toHaveClass(
      'min-h-10',
      'pointer-coarse:min-h-12',
      'bg-sidebar-active',
      'text-sidebar-strong',
    );
    expect(within(nav).getByRole('link', { name: /بانتظارك/ })).toHaveTextContent('3');
    expect(within(nav).getByRole('list', { name: 'اليوم' })).toBeInTheDocument();
  });

  it('folds to a rail of icons: the words stay for screen readers and show in a hint', async () => {
    const { user } = renderUi(
      <AdminShell
        collapsed
        sidebar={({ collapsed }) => (
          <nav aria-label="القائمة الرئيسية" data-collapsed={collapsed}>
            <NavGroup label="اليوم">
              <li>
                <NavItem href="/" active icon={<HomeIcon />}>
                  الرئيسية
                </NavItem>
              </li>
              <li>
                <NavItem href="/inbox" icon={<InboxIcon />} count={3}>
                  بانتظارك
                </NavItem>
              </li>
            </NavGroup>
          </nav>
        )}
        topBar={<p>بقالية أبو خليل</p>}
      >
        <h1>الرئيسية</h1>
      </AdminShell>,
    );

    expect(screen.getByRole('complementary')).toHaveClass('w-18');
    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(nav).toHaveAttribute('data-collapsed', 'true');
    const inbox = within(nav).getByRole('link', { name: /بانتظارك/ });
    expect(inbox).toHaveTextContent('3');
    expect(within(inbox).getByText('بانتظارك')).toHaveClass('sr-only');
    expect(within(nav).getByText('اليوم')).toHaveClass('sr-only');

    await user.tab();
    await user.tab();
    expect(inbox).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('بانتظارك');
  });

  it('opens the sidebar as a drawer from the start side, and closes it with Esc', async () => {
    const onDrawerOpenChange = vi.fn();
    const { user } = renderUi(
      <AdminShell
        collapsed
        drawerOpen
        onDrawerOpenChange={onDrawerOpenChange}
        drawerLabel="القائمة"
        sidebar={({ collapsed }) => (
          <nav aria-label="القائمة الرئيسية" data-collapsed={collapsed}>
            <NavGroup>
              <li>
                <NavItem href="/" active icon={<HomeIcon />}>
                  الرئيسية
                </NavItem>
              </li>
            </NavGroup>
          </nav>
        )}
        topBar={<p>بقالية أبو خليل</p>}
      >
        <h1>الرئيسية</h1>
      </AdminShell>,
    );

    const drawer = screen.getByRole('dialog', { name: 'القائمة' });
    expect(drawer).toHaveClass('start-0', 'bg-sidebar');
    // Never folded in the drawer, whatever the desktop rail is.
    const nav = within(drawer).getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(nav).toHaveAttribute('data-collapsed', 'false');
    expect(within(nav).getByText('الرئيسية')).not.toHaveClass('sr-only');
    expect(within(drawer).getByRole('button', { name: 'أغلق القائمة' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onDrawerOpenChange).toHaveBeenCalledWith(false);
  });

  it('puts the section bar under the top bar, inside the sticky header', () => {
    renderUi(
      <AdminShell
        sidebar={<nav aria-label="القائمة الرئيسية" />}
        topBar={<p>بقالية أبو خليل</p>}
        subBar={<nav aria-label="صفحات المنتجات" />}
      >
        <h1>المنتجات</h1>
      </AdminShell>,
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', 'backdrop-blur-xl');
    expect(within(header).getByRole('navigation', { name: 'صفحات المنتجات' })).toBeInTheDocument();
  });
});

describe('CashierShell', () => {
  it('puts the cart first (on the right), the status bar on top, and everything inside on touch density', () => {
    renderUi(
      <CashierShell statusBar={<CashierStatusBar>مقهى الياسمين</CashierStatusBar>} cart={<p>السلة</p>}>
        <Button>اسبريسو</Button>
      </CashierShell>,
    );

    expect(screen.getByRole('banner')).toHaveClass('z-60', 'h-14');
    const cart = screen.getByRole('complementary', { name: 'السلة' });
    expect(cart.nextElementSibling).toBe(screen.getByRole('main'));
    expect(screen.getByRole('button', { name: 'اسبريسو' })).toHaveClass('min-h-14');
  });
});

describe('PhoneShell', () => {
  it('has the five bottom tabs, each 52 high, the active one marked', () => {
    renderUi(
      <PhoneShell
        top={<h1>كيف اليوم؟</h1>}
        tabs={
          <>
            {['الرئيسية', 'بانتظارك', 'المبيعات', 'المنتجات', 'المزيد'].map((label, index) => (
              <PhoneTab
                key={label}
                href={`#${index}`}
                active={index === 0}
                icon={<HomeIcon />}
                count={index === 1 ? 3 : undefined}
              >
                {label}
              </PhoneTab>
            ))}
          </>
        }
      >
        <p>المحتوى</p>
      </PhoneShell>,
    );

    const tabs = within(screen.getByRole('navigation', { name: 'القائمة الرئيسية' })).getAllByRole('link');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');
    for (const tab of tabs) expect(tab).toHaveClass('h-13');
    expect(tabs[1]).toHaveTextContent('3');
  });
});

describe('TextLink', () => {
  it('renders an <a> by default, or the component it is given', () => {
    function RouterLink(props: { to: string; className?: string; children: string }) {
      return (
        <a href={props.to} data-router="yes" className={props.className}>
          {props.children}
        </a>
      );
    }
    renderUi(
      <>
        <TextLink href="/terms">الشروط</TextLink>
        <TextLink as={RouterLink} to="/register">
          افتح متجرك
        </TextLink>
      </>,
    );

    expect(screen.getByRole('link', { name: 'الشروط' })).toHaveClass('text-brand-ink');
    const routed = screen.getByRole('link', { name: 'افتح متجرك' });
    expect(routed).toHaveAttribute('data-router', 'yes');
    expect(routed).toHaveAttribute('href', '/register');
    expect(routed).toHaveClass('text-brand-ink');
  });
});
