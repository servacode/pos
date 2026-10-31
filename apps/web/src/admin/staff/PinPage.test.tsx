import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@serva/core';
import { apiError, mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

type Route = MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>);

function cashier(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      roles: [{ key: 'cashier', name: 'كاشير', branchId: 'branch-1' }],
      permissions: ['sale.create', 'sale.discount', 'shift.close_own'],
    },
  };
}

function openPin(pinRoute: Route = { status: 204 }, me: MeResponse = makeMe(), path = '/me/pin') {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: me },
    'PUT /v1/me/pin': pinRoute,
  });
  return { ...mock, ...renderApp(path) };
}

async function fill(
  user: ReturnType<typeof openPin>['user'],
  pin: string,
  confirm: string,
  password: string,
) {
  if (pin) await user.type(screen.getByLabelText('رمز الدخول الجديد'), pin);
  if (confirm) await user.type(screen.getByLabelText('أعد كتابة الرمز'), confirm);
  if (password) await user.type(screen.getByLabelText('كلمة السر'), password);
  await user.click(screen.getByRole('button', { name: 'احفظ الرمز' }));
}

describe('«رمز الدخول للكاشير»', () => {
  it('is reached from the top bar, explains 4 versus 6 digits, and tells an owner 6', async () => {
    const { user } = openPin(undefined, makeMe(), '/');
    await user.click(await screen.findByRole('link', { name: 'رمز الدخول للكاشير' }));

    expect(await screen.findByRole('heading', { name: 'رمز الدخول للكاشير', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/الكاشير يكفيه 4 أرقام. المالك والمدير ومن يوافق/)).toBeInTheDocument();
    expect(screen.getByText('رمزك 6 أرقام.')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز الدخول الجديد')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('رمز الدخول الجديد')).toHaveAttribute('inputmode', 'numeric');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('saves the code with the password (Arabic digits sent as Latin), and clears the form', async () => {
    const { user, requestsTo } = openPin();
    await screen.findByLabelText('رمز الدخول الجديد');

    await fill(user, '٢٥٨٠١٣', '258013', 'sesame-1');

    expect(
      await screen.findByText(
        'حُفظ رمز الدخول. استعمله على أجهزة الكاشير من الآن، والرمز القديم لم يعد يعمل.',
      ),
    ).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/me/pin')[0]!.body).toEqual({ pin: '258013', password: 'sesame-1' });
    expect(screen.getByLabelText('رمز الدخول الجديد')).toHaveValue('');
    expect(screen.getByLabelText('كلمة السر')).toHaveValue('');
  });

  it('lets a cashier use 4 digits', async () => {
    const { user, requestsTo } = openPin(undefined, cashier());
    expect(await screen.findByText('رمزك 4 أرقام أو 6.')).toBeInTheDocument();

    await fill(user, '2580', '2580', 'sesame-1');

    await vi.waitFor(() => expect(requestsTo('PUT', '/v1/me/pin')).toHaveLength(1));
    expect(requestsTo('PUT', '/v1/me/pin')[0]!.body).toEqual({ pin: '2580', password: 'sesame-1' });
  });

  it('asks an owner for 6 digits', async () => {
    const { user, requestsTo } = openPin();
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '2580', '2580', 'sesame-1');
    expect(screen.getByText('رمزك 6 أرقام لأنك توافق على عمليات غيرك')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز الدخول الجديد')).toHaveFocus();
    expect(requestsTo('PUT', '/v1/me/pin')).toHaveLength(0);
  });

  it('refuses an easy code', async () => {
    const { user, requestsTo } = openPin(undefined, cashier());
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '1234', '1234', 'sesame-1');
    expect(screen.getByText('هذا الرمز سهل التخمين. اختر أرقاماً غير متتالية ولا مكررة')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/me/pin')).toHaveLength(0);
  });

  it('asks for the same code twice and for the password', async () => {
    const { user, requestsTo } = openPin();
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '258013', '258014', '');
    expect(screen.getByText('الرمزان غير متطابقين. أعد كتابته')).toBeInTheDocument();
    expect(screen.getByText('اكتب كلمة السر')).toBeInTheDocument();
    expect(screen.getByLabelText('أعد كتابة الرمز')).toHaveFocus();
    expect(requestsTo('PUT', '/v1/me/pin')).toHaveLength(0);
  });

  it('puts a wrong password under the password field', async () => {
    const { user } = openPin(apiError(403, 'invalid_credentials', 'كلمة السر غير صحيحة.'));
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '258013', '258013', 'wrong');

    expect(await screen.findByText('كلمة السر غير صحيحة.')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة السر')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('كلمة السر')).toHaveFocus();
  });

  it('shows the server’s rule on the code field', async () => {
    const { user } = openPin(
      apiError(400, 'validation_failed', 'تحقّق من البيانات.', { pin: 'هذا الرمز سهل التخمين.' }),
    );
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '258013', '258013', 'sesame-1');
    expect(await screen.findByText('هذا الرمز سهل التخمين.')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز الدخول الجديد')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a network failure', async () => {
    const { user } = openPin(() => Promise.reject(new TypeError('Failed to fetch')));
    await screen.findByLabelText('رمز الدخول الجديد');
    await fill(user, '258013', '258013', 'sesame-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('لا يوجد إنترنت الآن.');
  });
});
