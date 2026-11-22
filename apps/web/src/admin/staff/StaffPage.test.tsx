import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, StaffListResponse, StaffMember } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { navFor } from '../../layout/nav';

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'users.manage'] } };
}

const person = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u-2',
  fullName: 'سامر الكاشير',
  phone: null,
  status: 'active',
  isOwner: false,
  roleKey: 'cashier',
  roleName: 'كاشير',
  branchIds: null,
  hasPin: true,
  pinLength: 4,
  hasLogin: false,
  lastLoginAt: null,
  createdAt: '2026-10-30T09:00:00.000Z',
  commissionBp: null,
  ...over,
});

const ownerRow = person({
  id: 'user-1',
  fullName: 'أحمد الخطيب',
  isOwner: true,
  roleKey: 'owner',
  roleName: 'المالك',
  hasPin: false,
  pinLength: null,
  hasLogin: true,
});

function open(
  initial: StaffMember[] = [ownerRow, person()],
  me: MeResponse = owner(),
  shared: string[] = [],
) {
  let staff = initial;
  const list = (): StaffListResponse => ({
    staff,
    roles: [
      { key: 'owner', name: 'المالك', permissions: [], pinLength: 6, assignable: false },
      { key: 'manager', name: 'مدير الفرع', permissions: [], pinLength: 6, assignable: true },
      { key: 'cashier', name: 'كاشير', permissions: [], pinLength: 4, assignable: true },
      { key: 'waiter', name: 'نادل', permissions: [], pinLength: 4, assignable: true },
      { key: 'pharmacist', name: 'صيدلاني', permissions: [], pinLength: 4, assignable: true },
      { key: 'accountant', name: 'محاسب', permissions: [], pinLength: 4, assignable: true },
    ],
    branches: [
      { id: 'branch-1', name: 'الفرع الرئيسي' },
      { id: 'branch-2', name: 'فرع الميدان' },
    ],
  });
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: me }),
    'GET /v1/staff': () => ({ status: 200, body: list() }),
    'POST /v1/staff/pin-check': () => ({ status: 200, body: { sharedWith: shared } }),
    'POST /v1/staff': (r: MockRequest) => {
      const body = r.body as { fullName: string; pin: string };
      if (body.pin === '1234')
        return apiError(400, 'validation_failed', 'تحقّق', { pin: 'هذا الرمز سهل التخمين' });
      const made = person({ id: 'u-3', fullName: body.fullName });
      staff = [...staff, made];
      return { status: 201, body: made };
    },
    'PATCH /v1/staff/u-2': (r: MockRequest) => {
      staff = staff.map((p) => (p.id === 'u-2' ? { ...p, ...(r.body as Partial<StaffMember>) } : p));
      return { status: 200, body: staff.find((p) => p.id === 'u-2') };
    },
    'POST /v1/staff/u-2/pin': { status: 204 },
    'POST /v1/staff/u-2/deactivate': () => {
      staff = staff.map((p) => (p.id === 'u-2' ? { ...p, status: 'disabled' as const } : p));
      return { status: 200, body: staff.find((p) => p.id === 'u-2') };
    },
    'POST /v1/staff/u-2/reactivate': () => {
      staff = staff.map((p) => (p.id === 'u-2' ? { ...p, status: 'active' as const } : p));
      return { status: 200, body: staff.find((p) => p.id === 'u-2') };
    },
  });
  return { ...mock, ...renderApp('/staff') };
}

describe('«الموظفون»', () => {
  it('lists the people with role badges and status; the owner has no menu', async () => {
    open([
      ownerRow,
      person(),
      person({
        id: 'u-4',
        fullName: 'منى',
        roleKey: 'manager',
        roleName: 'مدير الفرع',
        status: 'disabled',
        branchIds: ['branch-2'],
      }),
    ]);
    expect(await screen.findByRole('heading', { name: 'الموظفون', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'الموظفون' });
    expect(await within(table).findByText('سامر الكاشير')).toBeInTheDocument();
    // The role shows in its column, and again under the name for phones (CSS picks one).
    expect(within(table).getAllByText('مدير الفرع').length).toBeGreaterThan(0);
    expect(within(table).getByText('موقوف')).toBeInTheDocument();
    expect(within(table).getAllByText('يعمل')).toHaveLength(2);
    expect(within(table).getByText('فرع الميدان')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'خيارات أحمد الخطيب' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'خيارات سامر الكاشير' })).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('adds a cashier, showing the server message on the code field', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'موظف جديد' }));
    await user.type(await screen.findByLabelText('اسم الموظف'), 'ليلى');
    await user.type(screen.getByLabelText('رمز الدخول للكاشير'), '1234');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('هذا الرمز سهل التخمين')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('رمز الدخول للكاشير'));
    await user.type(screen.getByLabelText('رمز الدخول للكاشير'), '4829');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('ليلى')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/staff').at(-1)?.body).toEqual({
      fullName: 'ليلى',
      roleKey: 'cashier',
      branchIds: null,
      pin: '4829',
    });
  });

  it('sends only what changed when editing', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'عدّل' }));
    const name = await screen.findByLabelText('اسم الموظف');
    await user.clear(name);
    await user.type(name, 'سامر الجديد');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('سامر الجديد')).toBeInTheDocument();
    expect(requestsTo('PATCH', '/v1/staff/u-2').at(-1)?.body).toEqual({ fullName: 'سامر الجديد' });
  });

  it('sets the commission of a seller as a percent and sends it in basis points', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'عدّل' }));
    await user.type(await screen.findByLabelText(/نسبة العمولة/), '2.5');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await waitFor(() =>
      expect(requestsTo('PATCH', '/v1/staff/u-2').at(-1)?.body).toEqual({ commissionBp: 250 }),
    );
  });

  it('refuses a commission that is no percent before sending anything', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'عدّل' }));
    await user.type(await screen.findByLabelText(/نسبة العمولة/), '150');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اكتب نسبة من 0 إلى 100')).toBeInTheDocument();
    expect(requestsTo('PATCH', '/v1/staff/u-2')).toHaveLength(0);
  });

  it('sets a new till code', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'رمز دخول جديد' }));
    await user.type(await screen.findByLabelText('رمز الدخول الجديد'), '7391');
    await user.click(screen.getByRole('button', { name: 'احفظ الرمز' }));
    expect(await screen.findByText(/تم تغيير رمز الدخول/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/staff/u-2/pin').at(-1)?.body).toEqual({ pin: '7391' });
  });

  it('stops a person only after confirming, and brings them back', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'أوقف الموظف' }));
    expect(await screen.findByText('أوقف «سامر الكاشير»؟')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/staff/u-2/deactivate')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'أوقفه' }));
    expect(await screen.findByText('موقوف')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/staff/u-2/deactivate')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'خيارات سامر الكاشير' }));
    await user.click(await screen.findByRole('menuitem', { name: 'أعد تفعيله' }));
    await user.click(await screen.findByRole('button', { name: 'أعد تفعيله' }));
    expect(await screen.findAllByText('يعمل')).toHaveLength(2);
  });

  it('shows the menu entry only to whoever holds users.manage', () => {
    expect(navFor(owner()).some((e) => e.to === '/staff')).toBe(true);
    expect(navFor(makeMe()).some((e) => e.to === '/staff')).toBe(false);
  });

  it('offers the waiter to a store with a café and the pharmacist only to a pharmacy', async () => {
    const base = owner();
    const withSectors = (sectors: MeResponse['tenant']['sectors']): MeResponse => ({
      ...base,
      tenant: { ...base.tenant, sectors },
    });
    const first = open([ownerRow], withSectors(['cafe']));
    await first.user.click(await screen.findByRole('button', { name: 'موظف جديد' }));
    const roles = within(await screen.findByLabelText('الدور'));
    expect(roles.getByRole('option', { name: 'نادل' })).toBeInTheDocument();
    expect(roles.getByRole('option', { name: 'محاسب' })).toBeInTheDocument();
    expect(roles.queryByRole('option', { name: 'صيدلاني' })).toBeNull();
  });

  it('hides the waiter from a clothing store', async () => {
    const base = owner();
    const { user } = open([ownerRow], { ...base, tenant: { ...base.tenant, sectors: ['clothing'] } });
    await user.click(await screen.findByRole('button', { name: 'موظف جديد' }));
    const roles = within(await screen.findByLabelText('الدور'));
    expect(roles.queryByRole('option', { name: 'نادل' })).toBeNull();
    expect(roles.getByRole('option', { name: 'كاشير' })).toBeInTheDocument();
  });

  it('warns, without blocking, when the till code is already used by someone', async () => {
    const { user } = open([ownerRow, person()], owner(), ['سامر الكاشير']);
    await user.click(await screen.findByRole('button', { name: 'موظف جديد' }));
    await user.type(screen.getByLabelText('رمز الدخول للكاشير'), '4829');
    expect(await screen.findByText(/هذا الرمز يستعمله أيضاً: سامر الكاشير/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^احفظ|أضف/ })).toBeEnabled();
  });
});
