import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '@serva/core';
import { apiError, mockFetch } from '../test/fetchMock';
import { authResponse, makeMe, signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

const REGISTRATION_ID = '0193e5b4-0000-7000-8000-000000000001';
const codeSent = { status: 202, body: { registrationId: REGISTRATION_ID, expiresIn: 600 } };

async function fillDetails(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText('رقم الجوال'), '0912 345 678');
  await user.type(screen.getByLabelText('اسمك'), 'أحمد الخطيب');
  await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
}

describe('RegisterPage', () => {
  it('sends three fields with the agent code and terms version, then opens the store with the code', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': codeSent,
      'POST /v1/auth/register/verify': { status: 201, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/register?ref=AG-42');

    await fillDetails(user);
    expect(screen.getByLabelText('كود الوكيل (اختياري)')).toHaveValue('AG-42');
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    const [start] = requestsTo('POST', '/v1/auth/register');
    expect(start?.body).toEqual({
      phone: '+963912345678',
      fullName: 'أحمد الخطيب',
      password: 'secret-pass',
      agentCode: 'AG-42',
      termsVersion: TERMS_VERSION,
    });
    expect(requestsTo('GET', '/v1/me')).toHaveLength(0);

    await user.type(await screen.findByLabelText('رمز التحقق'), '١٢٣٤٥٦');
    await user.click(screen.getByRole('button', { name: 'تأكيد وفتح المتجر' }));

    await waitFor(() => expect(requestsTo('GET', '/v1/me').length).toBeGreaterThan(0));
    const [verify] = requestsTo('POST', '/v1/auth/register/verify');
    expect(verify?.credentials).toBe('include');
    expect(verify?.body).toEqual({
      registrationId: REGISTRATION_ID,
      code: '123456',
      password: 'secret-pass',
    });
    await waitFor(() => expect(screen.queryByLabelText('رمز التحقق')).not.toBeInTheDocument());
  });

  it('shows no test box on a normal server', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh, 'POST /v1/auth/register': codeSent });
    const { user } = renderApp('/register');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));
    expect(await screen.findByLabelText('رمز التحقق')).toHaveValue('');
    expect(screen.queryByRole('note', { name: 'وضع التجربة' })).not.toBeInTheDocument();
    expect(screen.queryByText(/وضع التجربة/)).not.toBeInTheDocument();
  });

  it('on the local test server, shows the code in a test box and fills it in', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': { status: 202, body: { ...codeSent.body, testCode: '123456' } },
      'POST /v1/auth/register/verify': { status: 201, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/register');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    const box = await screen.findByRole('note', { name: 'وضع التجربة' });
    expect(box).toHaveTextContent('وضع التجربة — الرمز: \u2066123 456\u2069');
    expect(box).toHaveClass('bg-warning-soft');
    expect(screen.getByLabelText('رمز التحقق')).toHaveValue('');

    await user.click(within(box).getByRole('button', { name: 'املأ الرمز' }));
    expect(screen.getByLabelText('رمز التحقق')).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد وفتح المتجر' }));

    await waitFor(() => expect(requestsTo('POST', '/v1/auth/register/verify')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/auth/register/verify')[0]?.body).toMatchObject({ code: '123456' });
  });

  it('shows per-field Arabic errors without calling the API', async () => {
    const { fetchMock } = mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    const { user } = renderApp('/register');
    await screen.findByRole('heading', { name: 'افتح متجرك خلال دقيقة' });
    fetchMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    expect(screen.getByText('رقم الجوال مطلوب')).toBeInTheDocument();
    expect(screen.getByText('الاسم حرفان على الأقل')).toBeInTheDocument();
    expect(screen.getByText('كلمة السر 8 أحرف على الأقل')).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الجوال')).toHaveFocus();
    expect(screen.queryByLabelText('كود الوكيل (اختياري)')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a server field error next to the right field', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': apiError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        agentCode: 'كود الوكيل غير صحيح. تأكد منه أو اتركه فارغاً.',
      }),
    });
    const { user } = renderApp('/register?ref=AG-404');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    const agentCode = screen.getByLabelText('كود الوكيل (اختياري)');
    await expect.poll(() => agentCode.getAttribute('aria-invalid')).toBe('true');
    expect(agentCode).toHaveFocus();
    expect(screen.getByText('كود الوكيل غير صحيح. تأكد منه أو اتركه فارغاً.')).toBeInTheDocument();
  });

  it('shows a wrong code under the code field and lets the number be changed', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': codeSent,
      'POST /v1/auth/register/verify': apiError(
        400,
        'otp_invalid',
        'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
        {
          code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
        },
      ),
    });
    const { user } = renderApp('/register');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));
    await user.type(await screen.findByLabelText('رمز التحقق'), '000000');
    await user.click(screen.getByRole('button', { name: 'تأكيد وفتح المتجر' }));

    const code = screen.getByLabelText('رمز التحقق');
    await expect.poll(() => code.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('الرمز غير صحيح. تأكد منه وأعد المحاولة.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'تعديل الرقم' }));
    expect(await screen.findByLabelText('رقم الجوال')).toBeInTheDocument();
  });
});
