import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_DELAY_HOURS,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_AREAS,
  PLATFORM_COOKIE_PATH,
  PLATFORM_REFRESH_COOKIE,
  PLATFORM_TOKEN_AUDIENCE,
  agentListQuery,
  agentReferralPath,
  approveInput,
  auditLogQuery,
  cancelApprovalInput,
  confirmPaymentInput,
  createAgentInput,
  createPaymentAccountInput,
  createPlanInput,
  extendStoreInput,
  normalizeRecoveryCode,
  normalizeTotp,
  paymentAccountChangeIsSensitive,
  paymentChecks,
  platformLoginInput,
  platformPaymentListQuery,
  platformStoreListQuery,
  platformTotpInput,
  rejectPaymentInput,
  setBillingRateInput,
  storeNoteInput,
  storeReasonInput,
  unconfirmPaymentInput,
  updateAgentInput,
  updatePaymentAccountInput,
  updatePlanInput,
} from './platform';

const CHALLENGE = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5c01';
const AGENT_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5c02';

const pathOf = (result: { error?: { issues: { path: PropertyKey[] }[] } }) => result.error?.issues[0]?.path;

describe('the platform gate', () => {
  it('has its own audience and a refresh cookie apart from the store sign-in', () => {
    expect(PLATFORM_TOKEN_AUDIENCE).not.toBe('serva-store');
    expect(PLATFORM_REFRESH_COOKIE).not.toBe('serva_rt');
    // The store cookie lives on /v1/auth; the platform one never reaches it, nor the reverse.
    expect(PLATFORM_COOKIE_PATH.startsWith('/v1/auth')).toBe(false);
    expect('/v1/auth'.startsWith(PLATFORM_COOKIE_PATH)).toBe(false);
  });

  it('signs in with a lower-cased email and a password', () => {
    expect(platformLoginInput.parse({ email: ' Yousef@Serva.SY ', password: 'x' })).toEqual({
      email: 'yousef@serva.sy',
      password: 'x',
    });
    expect(platformLoginInput.safeParse({ email: 'yousef', password: 'x' }).success).toBe(false);
    expect(platformLoginInput.safeParse({ email: 'a@b.sy', password: '' }).success).toBe(false);
  });
});

describe('second factor codes', () => {
  it('reads a TOTP code as typed', () => {
    expect(normalizeTotp('123 456')).toBe('123456');
    expect(normalizeTotp('١٢٣٤٥٦')).toBe('123456');
    for (const bad of ['12345', '1234567', '12a456', '']) expect(normalizeTotp(bad)).toBeNull();
  });

  it('reads a recovery code in any case, with or without its dash', () => {
    expect(normalizeRecoveryCode('abcde-fgh23')).toBe('ABCDE-FGH23');
    expect(normalizeRecoveryCode(' ABCDE FGH23 ')).toBe('ABCDE-FGH23');
    // 0, 1, O and I are not in the alphabet, so they are never misread
    for (const bad of ['ABCDE-FGH20', 'ABCDE-FGHI2', 'ABCD-FGH23', 'ABCDEF-FGH234', '']) {
      expect(normalizeRecoveryCode(bad)).toBeNull();
    }
  });

  it('tells a TOTP code from a recovery code on the sign-in step', () => {
    expect(platformTotpInput.parse({ challengeId: CHALLENGE, code: '١٢٣ ٤٥٦' })).toEqual({
      challengeId: CHALLENGE,
      code: { kind: 'totp', value: '123456' },
    });
    expect(platformTotpInput.parse({ challengeId: CHALLENGE, code: 'abcde-fgh23' }).code).toEqual({
      kind: 'recovery',
      value: 'ABCDE-FGH23',
    });
    expect(
      platformTotpInput.safeParse({ challengeId: CHALLENGE, code: '12345' }).error?.issues[0]?.message,
    ).toBe('اكتب الرمز من 6 أرقام، أو أحد رموز الاسترداد');
    expect(platformTotpInput.safeParse({ challengeId: 'x', code: '123456' }).success).toBe(false);
  });

  it('never mistakes one kind for the other', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 14 }), (text) => {
        expect(normalizeTotp(text) !== null && normalizeRecoveryCode(text) !== null).toBe(false);
      }),
    );
  });
});

describe('stores', () => {
  it('filters the list by state, pending payment, sector, agent and governorate', () => {
    expect(
      platformStoreListQuery.parse({
        q: ' الفرات ',
        state: 'grace',
        pendingPayment: 'true',
        sector: 'supermarket',
        agentId: 'none',
        governorate: 'raqqa',
      }),
    ).toEqual({
      q: 'الفرات',
      state: 'grace',
      pendingPayment: true,
      sector: 'supermarket',
      agentId: 'none',
      governorate: 'raqqa',
      sort: 'newest',
      limit: 50,
    });
    expect(platformStoreListQuery.parse({ agentId: AGENT_ID, pendingPayment: 'false' })).toMatchObject({
      agentId: AGENT_ID,
      pendingPayment: false,
    });
    for (const bad of [
      { state: 'dormant' },
      { pendingPayment: 'yes' },
      { agentId: 'furat' },
      { limit: '500' },
    ]) {
      expect(platformStoreListQuery.safeParse(bad).success).toBe(false);
    }
  });

  it('extends by whole days with a written reason (23 › 6: ten days)', () => {
    expect(extendStoreInput.parse({ target: 'trial', days: 10, reason: ' بدأ النقل من الأمين ' })).toEqual({
      target: 'trial',
      days: 10,
      reason: 'بدأ النقل من الأمين',
    });
    expect(pathOf(extendStoreInput.safeParse({ target: 'trial', days: 0, reason: 'x' }))).toEqual(['days']);
    expect(pathOf(extendStoreInput.safeParse({ target: 'trial', days: 366, reason: 'x' }))).toEqual(['days']);
    expect(pathOf(extendStoreInput.safeParse({ target: 'trial', days: 2.5, reason: 'x' }))).toEqual(['days']);
    expect(pathOf(extendStoreInput.safeParse({ target: 'forever', days: 1, reason: 'x' }))).toEqual([
      'target',
    ]);
    expect(pathOf(extendStoreInput.safeParse({ target: 'trial', days: 1, reason: '  ' }))).toEqual([
      'reason',
    ]);
  });

  it('suspends, resumes and notes with text', () => {
    expect(storeReasonInput.parse({ reason: 'احتيال' })).toEqual({ reason: 'احتيال' });
    expect(storeReasonInput.safeParse({}).success).toBe(false);
    expect(storeNoteInput.parse({ text: 'طلب تأجيل الدفع' })).toEqual({ text: 'طلب تأجيل الدفع' });
    expect(storeNoteInput.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('the payments queue', () => {
  const invoice = {
    amountSypMinor: 3_250_000,
    amountUsdMinor: 25_000,
    priceValidUntil: new Date('2026-11-06T00:00:00Z'),
  };
  const clean = {
    paidAmountMinor: 3_250_000,
    paidCurrency: 'SYP' as const,
    invoice,
    submittedAt: new Date('2026-10-30T13:42:00Z'),
    receiptReused: false,
    transactionResubmitted: false,
    accountActive: true,
  };

  it('finds nothing to say about a matching payment («مطابق»)', () => {
    expect(paymentChecks(clean)).toEqual([]);
    expect(paymentChecks({ ...clean, paidCurrency: 'USD', paidAmountMinor: 25_000 })).toEqual([]);
  });

  it('flags a short or over amount, a reused receipt, a resubmitted number, a late price and an old account', () => {
    expect(paymentChecks({ ...clean, paidAmountMinor: 3_200_000 })).toEqual(['amount_short']);
    expect(paymentChecks({ ...clean, paidAmountMinor: 3_300_000 })).toEqual(['amount_over']);
    expect(
      paymentChecks({
        ...clean,
        receiptReused: true,
        transactionResubmitted: true,
        accountActive: false,
        submittedAt: new Date('2026-11-07T00:00:00Z'),
      }),
    ).toEqual(['receipt_reused', 'transaction_resubmitted', 'price_expired', 'account_changed']);
  });

  it('lists the pending payments by default', () => {
    expect(platformPaymentListQuery.parse({})).toEqual({ status: 'pending', limit: 50 });
    expect(
      platformPaymentListQuery.parse({ status: 'confirmed', method: 'sham_cash', q: '884213907' }),
    ).toMatchObject({
      status: 'confirmed',
      method: 'sham_cash',
    });
    expect(platformPaymentListQuery.safeParse({ method: 'paypal' }).success).toBe(false);
    expect(platformPaymentListQuery.safeParse({ from: '2026-10-01' }).success).toBe(false);
  });

  it('confirms with an optional note, rejects and reverses with a reason', () => {
    expect(confirmPaymentInput.parse({})).toEqual({});
    expect(confirmPaymentInput.parse({ note: 'تحققت من الكشف' })).toEqual({ note: 'تحققت من الكشف' });
    expect(confirmPaymentInput.safeParse({ note: '' }).success).toBe(false);
    expect(rejectPaymentInput.parse({ reason: 'رقم العملية مستخدم في دفعة سابقة' }).reason).toBe(
      'رقم العملية مستخدم في دفعة سابقة',
    );
    expect(rejectPaymentInput.safeParse({ reason: '' }).success).toBe(false);
    expect(unconfirmPaymentInput.parse({ reason: 'أُكّدت بالخطأ', totp: '123456' })).toEqual({
      reason: 'أُكّدت بالخطأ',
      totp: '123456',
    });
    expect(pathOf(unconfirmPaymentInput.safeParse({ reason: 'x' }))).toEqual(['totp']);
  });
});

describe('plans and the billing rate', () => {
  it('creates a hidden plan with dollar prices in cents', () => {
    expect(
      createPlanInput.parse({
        code: ' Basic ',
        name: 'الأساسية',
        priceMonthlyUsdMinor: 1000,
        priceYearlyUsdMinor: 10_000,
      }),
    ).toEqual({
      code: 'basic',
      name: 'الأساسية',
      priceMonthlyUsdMinor: 1000,
      priceYearlyUsdMinor: 10_000,
      limits: {},
      features: [],
      graceDays: 7,
      sortOrder: 0,
      isActive: false,
    });
  });

  it('takes «بعرض سعر» as null prices', () => {
    const enterprise = createPlanInput.parse({
      code: 'enterprise',
      name: 'المؤسسات',
      priceMonthlyUsdMinor: null,
      priceYearlyUsdMinor: null,
      limits: { branches: null },
      features: ['api', 'transfers'],
    });
    expect(enterprise).toMatchObject({ priceMonthlyUsdMinor: null, limits: { branches: null } });
  });

  it.each([
    [{ code: 'Basic Plan' }, 'code'],
    [{ code: 'b' }, 'code'],
    [{ priceMonthlyUsdMinor: 0 }, 'priceMonthlyUsdMinor'],
    [{ priceMonthlyUsdMinor: -100 }, 'priceMonthlyUsdMinor'],
    [{ priceYearlyUsdMinor: 9.99 }, 'priceYearlyUsdMinor'],
    [{ features: ['api', 'api'] }, 'features'],
    [{ features: ['teleport'] }, 'features'],
    [{ name: '' }, 'name'],
  ])('refuses %j', (patch, field) => {
    const result = createPlanInput.safeParse({
      code: 'pro',
      name: 'الاحترافية',
      priceMonthlyUsdMinor: 2500,
      priceYearlyUsdMinor: 25_000,
      ...patch,
    });
    expect(pathOf(result)?.[0]).toBe(field);
  });

  it('updates with the version, only what is sent', () => {
    expect(updatePlanInput.parse({ version: 4, priceMonthlyUsdMinor: 2700 })).toEqual({
      version: 4,
      priceMonthlyUsdMinor: 2700,
    });
    expect(updatePlanInput.parse({ version: 1, trialDays: 30, isActive: true })).toEqual({
      version: 1,
      trialDays: 30,
      isActive: true,
    });
    expect(updatePlanInput.safeParse({ priceMonthlyUsdMinor: 2700 }).success).toBe(false);
    expect(updatePlanInput.safeParse({ version: 1, trialDays: 0 }).success).toBe(false);
  });

  it('sets the weekly rate in pounds per dollar', () => {
    expect(setBillingRateInput.parse({ sypPerUsd: '١٣٠' })).toEqual({ sypPerUsd: '130' });
    expect(setBillingRateInput.safeParse({ sypPerUsd: '0.0077' }).success).toBe(false);
  });
});

describe('payment accounts and approvals', () => {
  const sham = {
    method: 'sham_cash',
    label: 'شام كاش',
    accountNumber: '8820 1147 3306',
    holderName: 'شركة سيرفا للبرمجيات',
    qrPayload: 'shamcash://pay?to=882011473306',
    totp: '123456',
  };

  it('adds an account only with a fresh code', () => {
    expect(createPaymentAccountInput.parse(sham)).toEqual({
      ...sham,
      bankName: null,
      bankBranch: null,
      instructions: null,
      sortOrder: 0,
    });
    const { totp: _totp, ...withoutCode } = sham;
    expect(pathOf(createPaymentAccountInput.safeParse(withoutCode))).toEqual(['totp']);
  });

  it('needs the bank of a bank transfer, and a clean account number and QR text', () => {
    const bank = { ...sham, method: 'bank_transfer', accountNumber: '0101-221873-001', qrPayload: null };
    expect(pathOf(createPaymentAccountInput.safeParse(bank))).toEqual(['bankName']);
    expect(
      createPaymentAccountInput.parse({ ...bank, bankName: 'المصرف التجاري السوري' }).qrPayload,
    ).toBeNull();
    expect(pathOf(createPaymentAccountInput.safeParse({ ...sham, accountNumber: '88<20>' }))).toEqual([
      'accountNumber',
    ]);
    expect(pathOf(createPaymentAccountInput.safeParse({ ...sham, accountNumber: '882' }))).toEqual([
      'accountNumber',
    ]);
    expect(pathOf(createPaymentAccountInput.safeParse({ ...sham, qrPayload: 'line\nbreak' }))).toEqual([
      'qrPayload',
    ]);
    expect(pathOf(createPaymentAccountInput.safeParse({ ...sham, method: 'paypal' }))).toEqual(['method']);
  });

  it('switches an account off or reorders it at once, without a code', () => {
    expect(paymentAccountChangeIsSensitive({ version: 2, isActive: false, sortOrder: 3 })).toBe(false);
    expect(updatePaymentAccountInput.parse({ version: 2, isActive: false })).toEqual({
      version: 2,
      isActive: false,
    });
  });

  it('sends any change of where money goes, or switching on, through a second person', () => {
    for (const patch of [
      { accountNumber: '0933 552 044' },
      { qrPayload: 'new' },
      { holderName: 'x' },
      { instructions: null },
      { label: 'x' },
      { bankName: 'x' },
      { bankBranch: 'x' },
      { isActive: true },
    ]) {
      expect(paymentAccountChangeIsSensitive({ version: 1, ...patch })).toBe(true);
      expect(pathOf(updatePaymentAccountInput.safeParse({ version: 1, ...patch }))).toEqual(['totp']);
      expect(updatePaymentAccountInput.safeParse({ version: 1, ...patch, totp: '654321' }).success).toBe(
        true,
      );
    }
  });

  it('approves with a code and cancels with a reason, after at most a day', () => {
    expect(APPROVAL_DELAY_HOURS).toBe(24);
    expect(approveInput.parse({ totp: '123456' })).toEqual({ totp: '123456' });
    expect(approveInput.safeParse({}).success).toBe(false);
    expect(cancelApprovalInput.parse({ reason: 'ليس طلبي' })).toEqual({ reason: 'ليس طلبي' });
    expect(cancelApprovalInput.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('agents (23 › 7)', () => {
  it('creates an agent with an upper-case code and a normalized phone', () => {
    expect(
      createAgentInput.parse({ code: 'furat-07', fullName: 'مكتب الفرات للأنظمة', phone: '0944552107' }),
    ).toEqual({
      code: 'FURAT-07',
      fullName: 'مكتب الفرات للأنظمة',
      phone: '+963944552107',
      region: null,
    });
    expect(
      createAgentInput.parse({ code: 'AG-42', fullName: 'عمر', phone: '0944552107', region: 'raqqa' }).region,
    ).toBe('raqqa');
  });

  it.each([
    [{ code: 'F' }, 'code'],
    [{ code: 'FURAT 07' }, 'code'],
    [{ phone: '123' }, 'phone'],
    [{ fullName: '' }, 'fullName'],
    [{ region: 'beirut' }, 'region'],
  ])('refuses %j', (patch, field) => {
    const result = createAgentInput.safeParse({
      code: 'FURAT-07',
      fullName: 'مكتب',
      phone: '0944552107',
      ...patch,
    });
    expect(pathOf(result)).toEqual([field]);
  });

  it('never changes the code, and suspends with the status', () => {
    expect(updateAgentInput.parse({ version: 2, status: 'suspended', code: 'NEW' })).toEqual({
      version: 2,
      status: 'suspended',
    });
    expect(updateAgentInput.safeParse({ status: 'suspended' }).success).toBe(false);
  });

  it('builds the referral path the sign-up page reads', () => {
    expect(agentReferralPath('FURAT-07')).toBe('/register?agent=FURAT-07');
    expect(agentReferralPath('A&B')).toBe('/register?agent=A%26B');
    expect(agentListQuery.parse({ q: 'فرات', status: 'active' })).toEqual({
      q: 'فرات',
      status: 'active',
      limit: 50,
    });
  });
});

describe('the audit log', () => {
  it('files every action under one of the areas', () => {
    for (const action of PLATFORM_AUDIT_ACTIONS) {
      expect(PLATFORM_AUDIT_AREAS).toContain(action.slice(0, action.indexOf('.')));
    }
  });

  it('filters by area, action, person, store and time', () => {
    expect(
      auditLogQuery.parse({
        area: 'payment',
        action: 'payment.confirm',
        from: '2026-10-01T00:00:00Z',
        limit: '20',
      }),
    ).toEqual({ area: 'payment', action: 'payment.confirm', from: '2026-10-01T00:00:00Z', limit: 20 });
    expect(auditLogQuery.safeParse({ area: 'content' }).success).toBe(false);
    expect(auditLogQuery.safeParse({ action: 'store.delete' }).success).toBe(false);
  });
});
