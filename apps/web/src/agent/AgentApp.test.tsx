import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMe, AgentStore } from '@serva/core';
import { apiError, mockFetch } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const login = {
  token: 'at',
  expiresAt: '2026-10-30T17:00:00.000Z',
  agent: { id: 'ag-1', fullName: 'وكيل الرقة', code: 'AG-42', mustChangePassword: false },
};

// Round 37 (decision 21): the password is answered by a step, and the code opens the portal
const codeStep = { step: 'code', challengeId: 'c-1', expiresIn: 600, phoneHint: '222••••' };

const me = (over: Partial<AgentMe> = {}): AgentMe => ({
  id: 'ag-1',
  fullName: 'وكيل الرقة',
  code: 'AG-42',
  phone: '0944111222',
  balanceMinor: 5000,
  mustChangePassword: false,
  plans: [
    {
      code: 'basic',
      name: 'الأساسية',
      monthly: { listMinor: 1000, wholesaleMinor: 800 },
      yearly: { listMinor: 10000, wholesaleMinor: 8000 },
    },
  ],
  ...over,
});

const day = 86_400_000;
const store = (over: Partial<AgentStore>): AgentStore => ({
  tenantId: 't-1',
  name: 'سوبرماركت الفرات',
  storeCode: '123456',
  ownerPhone: '+963955000001',
  createdAt: '2026-09-01T00:00:00.000Z',
  tenantStatus: 'active',
  planCode: 'free',
  planName: 'تجربة',
  status: 'trialing',
  billingCycle: null,
  trialEndsAt: new Date(Date.now() + 10 * day).toISOString(),
  currentPeriodEnd: null,
  graceEndsAt: null,
  ...over,
});

async function signIn(user: ReturnType<typeof renderApp>['user'], withCode = true) {
  expect(await screen.findByRole('heading', { name: 'لوحة الوكيل', level: 1 })).toBeInTheDocument();
  await user.type(screen.getByLabelText('البريد الإلكتروني'), 'raqqa@agents.test');
  await user.type(screen.getByLabelText('كلمة السر'), 'agent-pass-1');
  await user.click(screen.getByRole('button', { name: 'ادخل' }));
  if (!withCode) return;
  await user.type(await screen.findByLabelText('الرمز'), '123456');
  await user.click(screen.getByRole('button', { name: 'أكّد الدخول' }));
}

describe('the agent portal', () => {
  it('shows the balance and the stores; a store still in its trial cannot be activated yet', async () => {
    mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': { status: 200, body: login },
      'GET /v1/agent/me': { status: 200, body: me() },
      'GET /v1/agent/stores': {
        status: 200,
        body: {
          items: [
            store({}),
            store({
              tenantId: 't-2',
              name: 'صيدلية النور',
              status: 'active',
              planCode: 'basic',
              planName: 'الأساسية',
              billingCycle: 'monthly',
              trialEndsAt: null,
              currentPeriodEnd: new Date(Date.now() + 20 * day).toISOString(),
            }),
          ],
        },
      },
    });
    const { user } = renderApp('/agent');
    await signIn(user);
    expect(await screen.findByText('سوبرماركت الفرات')).toBeInTheDocument();
    expect(screen.getByText('رصيدك المدفوع مسبقاً')).toBeInTheDocument();
    expect(screen.getByText('تجربة مجانية')).toBeInTheDocument();
    expect(screen.getByText('مشترك')).toBeInTheDocument();
    const trial = screen.getByText('سوبرماركت الفرات').closest('li')!;
    expect(within(trial).getByRole('button', { name: 'فعّل الاشتراك' })).toBeDisabled();
    expect(within(trial).getByText(/بعد انتهاء التجربة المجانية/)).toBeInTheDocument();
    const paying = screen.getByText('صيدلية النور').closest('li')!;
    expect(within(paying).getByRole('button', { name: 'جدّد الاشتراك' })).toBeEnabled();
  });

  it('activates a store at the wholesale price, with one key for the attempt', async () => {
    let paid = false;
    const { requestsTo } = mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': { status: 200, body: login },
      'GET /v1/agent/me': () => ({ status: 200, body: me({ balanceMinor: paid ? 4200 : 5000 }) }),
      'GET /v1/agent/stores': () => ({
        status: 200,
        body: {
          items: [
            paid
              ? store({
                  status: 'active',
                  planName: 'الأساسية',
                  billingCycle: 'monthly',
                  currentPeriodEnd: '2026-12-30T00:00:00.000Z',
                })
              : store({ trialEndsAt: new Date(Date.now() - day).toISOString() }),
          ],
        },
      }),
      'POST /v1/agent/stores/t-1/activate': () => {
        paid = true;
        return {
          status: 200,
          body: {
            chargedMinor: 800,
            balanceAfterMinor: 4200,
            periodEnd: '2026-12-30T00:00:00.000Z',
            replay: false,
          },
        };
      },
    });
    const { user } = renderApp('/agent');
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'فعّل الاشتراك' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('سعرك (جملة)')).toBeInTheDocument();
    expect(within(dialog).getByText(/8\.00/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'ادفع وفعّل' }));
    expect(await screen.findByText(/فُعّل سوبرماركت الفرات/)).toBeInTheDocument();
    const sent = requestsTo('POST', '/v1/agent/stores/t-1/activate');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.Authorization).toBe('Bearer at');
    expect(sent[0]!.body).toMatchObject({ planCode: 'basic', billingCycle: 'monthly' });
    expect((sent[0]!.body as { requestKey: string }).requestKey).toMatch(/^agt-/);
  });

  it('will not pay when the balance is short, and says why', async () => {
    mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': { status: 200, body: login },
      'GET /v1/agent/me': { status: 200, body: me({ balanceMinor: 300 }) },
      'GET /v1/agent/stores': {
        status: 200,
        body: { items: [store({ trialEndsAt: new Date(Date.now() - day).toISOString() })] },
      },
    });
    const { user } = renderApp('/agent');
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'فعّل الاشتراك' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/رصيدك لا يكفي/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'ادفع وفعّل' })).toBeDisabled();
  });

  it('a new agent must choose his own password before he sees anything', async () => {
    let changed = false;
    const { requestsTo } = mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': {
        status: 200,
        body: { ...login, agent: { ...login.agent, mustChangePassword: true } },
      },
      'GET /v1/agent/me': () => ({ status: 200, body: me({ mustChangePassword: !changed }) }),
      'PUT /v1/agent/password': () => {
        changed = true;
        return { status: 204 };
      },
      'GET /v1/agent/stores': { status: 200, body: { items: [] } },
    });
    const { user } = renderApp('/agent');
    await signIn(user);
    expect(await screen.findByRole('heading', { name: 'اختر كلمة سر لك' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('كلمة السر الحالية'), 'temp-pass-123');
    await user.type(screen.getByLabelText('كلمة السر الجديدة'), 'my-own-pass-1');
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'my-own-pass-1');
    await user.click(screen.getByRole('button', { name: 'حفظ ومتابعة' }));
    expect(await screen.findByText('لا متاجر بعد.')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/agent/password')[0]!.body).toEqual({
      current: 'temp-pass-123',
      password: 'my-own-pass-1',
    });
  });

  it('shows the server’s refusal on a wrong password', async () => {
    mockFetch({
      'POST /v1/agent/login': apiError(401, 'invalid_credentials', 'البريد أو كلمة السر غير صحيحة.'),
    });
    const { user } = renderApp('/agent');
    await signIn(user, false);
    expect(await screen.findByText('البريد أو كلمة السر غير صحيحة.')).toBeInTheDocument();
  });

  it('asks for the code after the password, says where it went, and shows a wrong code’s refusal', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': apiError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.'),
    });
    const { user } = renderApp('/agent');
    await signIn(user);
    expect(await screen.findByText('الرمز غير صحيح. تأكد منه وأعد المحاولة.')).toBeInTheDocument();
    expect(screen.getByText('222••••')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/agent/login/code')[0]!.body).toEqual({
      challengeId: 'c-1',
      code: '123456',
      remember: false,
    });
    expect(localStorage.getItem('servaAgentDevice')).toBeNull();
    // The password was never kept: going back starts again
    await user.click(screen.getByRole('button', { name: 'رجوع، أطلب رمزاً جديداً' }));
    expect(await screen.findByLabelText('كلمة السر')).toBeInTheDocument();
  });

  it('«تذكّر هالجهاز 30 يوم»: the box asks to be remembered and the device keeps the token the server gives', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/agent/login': { status: 200, body: codeStep },
      'POST /v1/agent/login/code': {
        status: 200,
        body: { ...login, deviceToken: 'dev-1', deviceExpiresAt: '2026-11-30T00:00:00.000Z' },
      },
      'GET /v1/agent/me': { status: 200, body: me() },
      'GET /v1/agent/stores': { status: 200, body: { items: [] } },
    });
    const { user } = renderApp('/agent');
    expect(await screen.findByRole('heading', { name: 'لوحة الوكيل', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'raqqa@agents.test');
    await user.type(screen.getByLabelText('كلمة السر'), 'agent-pass-1');
    await user.click(screen.getByRole('button', { name: 'ادخل' }));
    await user.type(await screen.findByLabelText('الرمز'), '123456');
    await user.click(screen.getByRole('checkbox', { name: /تذكّر هالجهاز 30 يوم/ }));
    await user.click(screen.getByRole('button', { name: 'أكّد الدخول' }));
    expect(await screen.findByText('رصيدك المدفوع مسبقاً')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/agent/login/code')[0]!.body).toMatchObject({ remember: true });
    expect(localStorage.getItem('servaAgentDevice')).toBe('dev-1');
  });

  it('a remembered device: the password alone opens the portal, and the token travels with it', async () => {
    localStorage.setItem('servaAgentDevice', 'dev-1');
    const { requestsTo } = mockFetch({
      'POST /v1/agent/login': { status: 200, body: login },
      'GET /v1/agent/me': { status: 200, body: me() },
      'GET /v1/agent/stores': { status: 200, body: { items: [] } },
    });
    const { user } = renderApp('/agent');
    await signIn(user, false);
    expect(await screen.findByText('رصيدك المدفوع مسبقاً')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/agent/login')[0]!.body).toMatchObject({ deviceToken: 'dev-1' });
    expect(screen.queryByLabelText('الرمز')).not.toBeInTheDocument();
  });

  it('a token the server no longer takes (expired, revoked) is forgotten and the code is asked', async () => {
    localStorage.setItem('servaAgentDevice', 'old-token');
    mockFetch({ 'POST /v1/agent/login': { status: 200, body: codeStep } });
    const { user } = renderApp('/agent');
    await signIn(user, false);
    expect(await screen.findByLabelText('الرمز')).toBeInTheDocument();
    expect(localStorage.getItem('servaAgentDevice')).toBeNull();
  });

  it('the button waits for six digits', async () => {
    mockFetch({ 'POST /v1/agent/login': { status: 200, body: codeStep } });
    const { user } = renderApp('/agent');
    await signIn(user, false);
    const confirm = await screen.findByRole('button', { name: 'أكّد الدخول' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('الرمز'), '12ab34');
    expect(screen.getByLabelText('الرمز')).toHaveValue('1234');
    expect(confirm).toBeDisabled();
  });
});
