import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';
import { authResponse, makeMe, signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

describe('LoginPage', () => {
  it('shows the Arabic phone error and does not call the API for an invalid phone', async () => {
    const { fetchMock } = mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    const { user } = renderApp('/login');
    await screen.findByRole('heading', { name: 'أهلاً بعودتك' });
    fetchMock.mockClear();

    await user.type(screen.getByLabelText('رقم الجوال'), '12345');
    await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(screen.getByText('رقم الجوال غير صحيح. مثال: 0912345678')).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الجوال')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('رقم الجوال')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs in with a normalized phone and opens the home page', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/login': { status: 200, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('رقم الجوال'), '٠٩١٢٣٤٥٦٧٨');
    await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/login')[0]?.body).toEqual({
      phone: '+963912345678',
      password: 'secret-pass',
      remember: true,
    });
    expect(requestsTo('GET', '/v1/me')[0]?.headers.Authorization).toBe(`Bearer ${authResponse.accessToken}`);
  });

  it('shows the server message for wrong credentials', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/login': apiError(401, 'invalid_credentials', 'رقم الجوال أو كلمة المرور غير صحيحة'),
    });
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.type(screen.getByLabelText('كلمة السر'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('رقم الجوال أو كلمة المرور غير صحيحة');
    expect(screen.getByRole('button', { name: 'دخول' })).toBeEnabled();
  });

  it('sends remember: false when «تذكّرني» is unticked', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/login': { status: 200, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
    await user.click(screen.getByRole('checkbox', { name: 'تذكّرني على هذا الجهاز' }));
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' });
    expect(requestsTo('POST', '/v1/auth/login')[0]?.body).toMatchObject({ remember: false });
  });

  it('resets a forgotten password with the code and comes back to sign in', async () => {
    const resetId = '01a1a52b-2f2d-78fc-bfe7-b6741a395b09';
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/password/forgot': { status: 202, body: { resetId, expiresIn: 600 } },
      'POST /v1/auth/password/reset': { status: 204 },
    });
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.click(screen.getByRole('link', { name: 'نسيت كلمة السر؟' }));
    await screen.findByRole('heading', { name: 'نسيت كلمة السر؟' });
    expect(screen.getByLabelText('رقم الجوال')).toHaveValue('0912345678');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));

    await screen.findByRole('heading', { name: 'اختر كلمة سر جديدة' });
    await user.type(screen.getByLabelText('رمز التحقق'), '123456');
    await user.type(screen.getByLabelText('كلمة السر الجديدة'), 'new-secret-1');
    await user.click(screen.getByRole('button', { name: 'احفظ كلمة السر' }));

    expect(await screen.findByText('تغيّرت كلمة السر. ادخل بها الآن.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/password/forgot')[0]?.body).toEqual({ phone: '+963912345678' });
    expect(requestsTo('POST', '/v1/auth/password/reset')[0]?.body).toEqual({
      resetId,
      code: '123456',
      password: 'new-secret-1',
    });
  });
});
