import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';
import { authResponse, makeMe, signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

const RESET_ID = '0193e5b4-0000-7000-8000-000000000002';
const codeSent = { status: 202, body: { resetId: RESET_ID, expiresIn: 600 } };

describe('the login page link', () => {
  it('offers «نسيت كلمة السر؟» and opens the recovery page', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('link', { name: 'نسيت كلمة السر؟' }));
    expect(await screen.findByRole('heading', { name: 'نسيت كلمة السر؟' })).toBeInTheDocument();
  });
});

describe('ForgotPasswordPage', () => {
  it('shows the phone error and calls nothing for an invalid number', async () => {
    const { fetchMock } = mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('رقم الجوال'), '123');
    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    expect(screen.getByText('رقم الجوال غير صحيح. مثال: 0912345678')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the phone, then the code with the new password, and signs in', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/forgot': codeSent,
      'POST /v1/auth/forgot/reset': { status: 200, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/forgot-password');

    await user.type(await screen.findByLabelText('رقم الجوال'), '٠٩١٢٣٤٥٦٧٨');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    expect(requestsTo('POST', '/v1/auth/forgot')[0]?.body).toEqual({ phone: '+963912345678' });

    // The page never says whether the number has an account
    expect(await screen.findByText(/إن كان للرقم/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('رمز التحقق'), '١٢٣٤٥٦');
    await user.type(screen.getByLabelText('كلمة السر الجديدة'), 'brand-new-pass-9');
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'brand-new-pass-9');
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة السر ودخول' }));

    await waitFor(() => expect(requestsTo('GET', '/v1/me').length).toBeGreaterThan(0));
    const [reset] = requestsTo('POST', '/v1/auth/forgot/reset');
    expect(reset?.credentials).toBe('include');
    expect(reset?.body).toEqual({ resetId: RESET_ID, code: '123456', password: 'brand-new-pass-9' });
  });

  it('does not send when the two passwords differ', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/forgot': codeSent,
    });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    await user.type(await screen.findByLabelText('رمز التحقق'), '123456');
    await user.type(screen.getByLabelText('كلمة السر الجديدة'), 'brand-new-pass-9');
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'something-else-1');
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة السر ودخول' }));
    expect(await screen.findByText('كلمتا السر غير متطابقتين.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/forgot/reset')).toHaveLength(0);
  });

  it('shows a wrong code under the code field and lets the number be changed', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/forgot': codeSent,
      'POST /v1/auth/forgot/reset': apiError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
        code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
      }),
    });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    await user.type(await screen.findByLabelText('رمز التحقق'), '000000');
    await user.type(screen.getByLabelText('كلمة السر الجديدة'), 'brand-new-pass-9');
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'brand-new-pass-9');
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة السر ودخول' }));

    const code = screen.getByLabelText('رمز التحقق');
    await expect.poll(() => code.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('الرمز غير صحيح. تأكد منه وأعد المحاولة.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'تعديل الرقم' }));
    expect(await screen.findByLabelText('رقم الجوال')).toBeInTheDocument();
  });

  it('shows the rate-limit message from the server', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/forgot': apiError(429, 'rate_limited', 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.'),
    });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('محاولات كثيرة');
  });

  it('on the local test server, shows the code in a test box', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/forgot': { status: 202, body: { ...codeSent.body, testCode: '654321' } },
    });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('رقم الجوال'), '0912345678');
    await user.click(screen.getByRole('button', { name: 'أرسل الرمز' }));
    const box = await screen.findByRole('note', { name: 'وضع التجربة' });
    await user.click(within(box).getByRole('button', { name: 'املأ الرمز' }));
    expect(screen.getByLabelText('رمز التحقق')).toHaveValue('654321');
  });
});
