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
    await user.type(screen.getByLabelText('كلمة المرور'), 'secret-pass');
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
    await user.type(screen.getByLabelText('كلمة المرور'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/login')[0]?.body).toEqual({
      phone: '+963912345678',
      password: 'secret-pass',
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
    await user.type(screen.getByLabelText('كلمة المرور'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('رقم الجوال أو كلمة المرور غير صحيحة');
    expect(screen.getByRole('button', { name: 'دخول' })).toBeEnabled();
  });
});
