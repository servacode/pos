import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';

afterEach(() => sessionStorage.clear());

const session = {
  token: 'pt',
  expiresAt: '2026-11-12T17:00:00.000Z',
  user: { id: 'a', fullName: 'مدير', role: 'super_admin' },
};
const panelRoutes = {
  'GET /v1/platform/payments?status=pending': { status: 200, body: { items: [] } },
};

async function typeCredentials(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'admin@serva.test');
  await user.type(screen.getByLabelText('كلمة السر'), 'platform-pass-1');
  await user.click(screen.getByRole('button', { name: 'ادخل' }));
}

describe('platform sign-in steps', () => {
  it('asks for the authenticator code after the password, and opens the panel with it', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/platform/login': { status: 200, body: { step: 'code', ticket: 'ticket-1-aaaaaaaa' } },
      'POST /v1/platform/login/code': (r) =>
        (r.body as { code: string }).code === '000000'
          ? apiError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.')
          : { status: 200, body: session },
      ...panelRoutes,
    });
    const { user } = renderApp('/platform');
    await typeCredentials(user);

    const code = await screen.findByLabelText('رمز التحقق');
    expect(screen.queryByText('الدفعات')).not.toBeInTheDocument();
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'تحقّق' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('الرمز غير صحيح');

    await user.clear(screen.getByLabelText('رمز التحقق'));
    await user.type(screen.getByLabelText('رمز التحقق'), '123456');
    await user.click(screen.getByRole('button', { name: 'تحقّق' }));
    expect(await screen.findByText('لا دفعات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/platform/login/code')[1]?.body).toEqual({
      ticket: 'ticket-1-aaaaaaaa',
      code: '123456',
    });
  });

  it('makes a bootstrap password be changed before anything else', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/platform/login': { status: 200, body: { step: 'password', ticket: 'ticket-2-aaaaaaaa' } },
      'POST /v1/platform/login/password': { status: 200, body: session },
      ...panelRoutes,
    });
    const { user } = renderApp('/platform');
    await typeCredentials(user);

    await user.type(await screen.findByLabelText('كلمة السر الجديدة'), 'a-much-better-password-9');
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'different-password-9');
    expect(await screen.findByRole('alert')).toHaveTextContent('غير متطابقتين');
    await user.clear(screen.getByLabelText('أعد كلمة السر الجديدة'));
    await user.type(screen.getByLabelText('أعد كلمة السر الجديدة'), 'a-much-better-password-9');
    await user.click(screen.getByRole('button', { name: 'حفظ ومتابعة' }));

    expect(await screen.findByText('لا دفعات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/platform/login/password')[0]?.body).toEqual({
      ticket: 'ticket-2-aaaaaaaa',
      password: 'a-much-better-password-9',
    });
  });

  it('forces enrolment: QR and key, a code, the recovery codes once, then the panel', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/platform/login': { status: 200, body: { step: 'enrol', ticket: 'ticket-3-aaaaaaaa' } },
      'POST /v1/platform/login/enrol': {
        status: 200,
        body: {
          secret: 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
          uri: 'otpauth://totp/Serva%20Platform:admin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Serva%20Platform',
        },
      },
      'POST /v1/platform/login/enrol/confirm': {
        status: 200,
        body: { recoveryCodes: ['abcde-fghjk', 'mnpqr-stuvw'], login: session },
      },
      ...panelRoutes,
    });
    const { user } = renderApp('/platform');
    await typeCredentials(user);

    expect(await screen.findByRole('img', { name: 'رمز QR لتطبيق المصادقة' })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('رمز التطبيق'), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد وتفعيل' }));

    const list = await screen.findByRole('list', { name: 'رموز الاسترداد' });
    expect(list).toHaveTextContent('abcde-fghjk');
    const enter = screen.getByRole('button', { name: 'ادخل إلى اللوحة' });
    expect(enter).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'حفظت الرموز' }));
    await user.click(enter);
    expect(await screen.findByText('لا دفعات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/platform/login/enrol/confirm')[0]?.body).toEqual({
      ticket: 'ticket-3-aaaaaaaa',
      code: '123456',
    });
  });
});
