import type { AuthResponse, MeResponse } from '@serva/core';

export function makeMe(subscription: Partial<MeResponse['subscription']> = {}): MeResponse {
  return {
    user: {
      id: 'user-1',
      fullName: 'أحمد الخطيب',
      phone: '+963912345678',
      roles: [{ key: 'owner', name: 'المالك', branchId: null }],
      permissions: ['sale.create', 'devices.view', 'devices.manage'],
    },
    tenant: {
      id: 'tenant-1',
      name: 'سوبرماركت الياسمين',
      sectors: ['supermarket', 'cafe'],
      country: 'SY',
      timezone: 'Asia/Damascus',
    },
    settings: {
      baseCurrency: 'SYP',
      enabledCurrencies: ['SYP', 'USD'],
      taxInclusive: true,
      numberFormat: 'latn',
    },
    subscription: {
      status: 'trialing',
      planName: 'تجربة مجانية',
      trialEndsAt: '2026-11-10T00:00:00.000Z',
      currentPeriodEnd: null,
      daysLeft: 12,
      lifecycle: 'trialing',
      readOnly: false,
      writeUntil: null,
      graceDaysLeft: 12,
      ...subscription,
    },
    branches: [{ id: 'branch-1', code: 'MAIN', name: 'الفرع الرئيسي' }],
    // Past the start wizard: tests of the wizard set it back
    onboarding: { step: 4, done: true },
  };
}

export const authResponse: AuthResponse = {
  accessToken: 'access-1',
  expiresIn: 900,
  user: { id: 'user-1', fullName: 'أحمد الخطيب', phone: '+963912345678' },
  tenant: { id: 'tenant-1', name: 'سوبرماركت الياسمين' },
};

export const signedOutRefresh = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'غير مسجّل' } },
};

export const signedInRefresh = { status: 200, body: { accessToken: 'access-1', expiresIn: 900 } };
