import type { AuthResponse, MeResponse } from '@serva/core';

export function makeMe(subscription: Partial<MeResponse['subscription']> = {}): MeResponse {
  return {
    user: {
      id: 'user-1',
      fullName: 'أحمد الخطيب',
      phone: '+963912345678',
      roles: [{ key: 'owner', name: 'المالك', branchId: null }],
      permissions: ['sale.create'],
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
      ...subscription,
    },
    branches: [{ id: 'branch-1', code: 'MAIN', name: 'الفرع الرئيسي' }],
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
