import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(aside).toHaveClass('border-e');
    expect(within(column as HTMLElement).getByRole('banner')).toHaveTextContent('بقالية أبو خليل');
    expect(screen.getByRole('main')).toHaveClass('max-w-7xl');

    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    const home = within(nav).getByRole('link', { name: 'الرئيسية' });
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(home).toHaveClass('min-h-12', 'bg-brand-soft');
    expect(within(nav).getByRole('link', { name: /بانتظارك/ })).toHaveTextContent('3');
  });
});

describe('CashierShell', () => {
  it('puts the cart first (on the right), the status bar on top, and everything inside on touch density', () => {
    renderUi(
      <CashierShell statusBar={<CashierStatusBar>مقهى الياسمين</CashierStatusBar>} cart={<p>السلة</p>}>
        <Button>اسبريسو</Button>
      </CashierShell>,
    );

    expect(screen.getByRole('banner')).toHaveClass('z-60', 'h-11');
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
