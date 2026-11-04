import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission, SectorKey } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { initials } from './AppShell';

function signedIn(permissions?: Permission[], sectors?: SectorKey[]) {
  const base = makeMe();
  const me = sectors ? { ...base, tenant: { ...base.tenant, sectors } } : base;
  mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: permissions ? { ...me, user: { ...me.user, permissions } } : me },
  });
  return renderApp('/');
}

describe('AppShell', () => {
  it('lists only screens that exist, with no «قريباً» items', async () => {
    signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'شاشة الدليل', 'الأجهزة']);
    expect(within(nav).getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('قريباً');
  });

  it('gives every link and button a 48 px touch target', async () => {
    signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    const targets = [
      ...within(nav).getAllByRole('link'),
      screen.getByRole('link', { name: 'سيرفا، الرئيسية' }),
      screen.getByRole('button', { name: /خروج/ }),
      screen.getByRole('link', { name: 'رمز الدخول للكاشير' }),
    ];
    for (const target of targets) expect(target).toHaveClass('min-h-12');
  });

  it('shows each section only to whoever holds its permission key', async () => {
    signedIn(['catalog.manage', 'devices.view']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'الرئيسية',
      'المنتجات',
      'التصنيفات',
      'العروض',
      'تغيير الأسعار',
      'طباعة الملصقات',
      'شاشة الدليل',
      'الأجهزة',
    ]);
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
    ).toEqual([
      'الرئيسية',
      'مبيعات اليوم',
      'الورديات',
      'المنتجات',
      'التصنيفات',
      'العروض',
      'تغيير الأسعار',
      'طباعة الملصقات',
      'حركة الأصناف',
      'المحاسبة',
      'شاشة الدليل',
      'الأجهزة',
    ]);
  });

  it('shows the shifts to a manager who may close any shift, without the books', async () => {
    signedIn(['shift.close_any']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'الورديات']);
  });

  it('gives a cashier only the home page, and their own sign-in code', async () => {
    signedIn(['sale.create']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية']);
    expect(screen.getByRole('link', { name: 'رمز الدخول للكاشير' })).toHaveAttribute('href', '/me/pin');
  });

  it('puts the menu in titled groups', async () => {
    signedIn(['catalog.manage', 'customers.view', 'devices.view', 'report.view']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    for (const title of ['البيع والزبائن', 'البضاعة', 'التقارير والحسابات', 'الإعدادات']) {
      expect(within(nav).getByText(title)).toBeInTheDocument();
    }
  });

  it('hides what a clothing store does not use: expiry, serial numbers and cheques', async () => {
    signedIn(['catalog.manage', 'customers.view', 'purchases.manage'], ['clothing']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toContain('المنتجات');
    expect(labels).toContain('المشتريات');
    expect(labels).not.toContain('الصلاحية');
    expect(labels).not.toContain('الأرقام التسلسلية');
    expect(labels).not.toContain('الشيكات');
  });

  it('shows expiry dates to a pharmacy', async () => {
    signedIn(['purchases.manage'], ['pharmacy']);
    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'الصلاحية' })).toBeInTheDocument();
  });

  it("shows the store name's initials, skipping words like «متجر»", () => {
    expect(initials('متجر أحمد نور')).toBe('أن');
    expect(initials('سوبرماركت الياسمين')).toBe('ا');
    expect(initials('متجر')).toBe('م');
  });
});
