import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';
import { authResponse, makeMe, signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

async function fillRequiredFields(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText('اسم المتجر'), 'سوبرماركت الياسمين');
  await user.type(screen.getByLabelText('اسمك'), 'أحمد الخطيب');
  await user.type(screen.getByLabelText('رقم الجوال'), '0912 345 678');
  await user.type(screen.getByLabelText('كلمة المرور'), 'secret-pass');
}

describe('RegisterPage', () => {
  it('posts the normalized phone and selected sectors, then opens the home page', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': { status: 201, body: authResponse },
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    const { user } = renderApp('/register?ref=AG-42');

    await fillRequiredFields(user);
    await user.click(screen.getByRole('checkbox', { name: 'مقهى وكافتيريا' }));
    await user.click(screen.getByRole('checkbox', { name: 'سوبرماركت ومولات' }));
    await user.click(screen.getByRole('radio', { name: /دولار أمريكي/ }));
    expect(screen.getByLabelText('كود الوكيل (اختياري)')).toHaveValue('AG-42');
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    expect(await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
    const [request] = requestsTo('POST', '/v1/auth/register');
    expect(request?.credentials).toBe('include');
    expect(request?.body).toEqual({
      storeName: 'سوبرماركت الياسمين',
      ownerName: 'أحمد الخطيب',
      phone: '+963912345678',
      password: 'secret-pass',
      sectors: ['supermarket', 'cafe'],
      baseCurrency: 'USD',
      agentCode: 'AG-42',
    });
  });

  it('shows per-field Arabic errors without calling the API', async () => {
    const { fetchMock } = mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    const { user } = renderApp('/register');
    await screen.findByRole('heading', { name: 'افتح متجرك خلال دقيقة' });
    fetchMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    expect(screen.getByText('اسم المتجر حرفان على الأقل')).toBeInTheDocument();
    expect(screen.getByText('اختر نشاطاً واحداً على الأقل')).toBeInTheDocument();
    expect(screen.getByLabelText('اسم المتجر')).toHaveFocus();
    expect(screen.getByRole('radio', { name: /ليرة سورية/ })).toBeChecked();
    expect(screen.queryByLabelText('كود الوكيل (اختياري)')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows server field errors next to the right field', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedOutRefresh,
      'POST /v1/auth/register': apiError(409, 'phone_taken', 'هذا الرقم مسجّل مسبقاً', {
        phone: 'هذا الرقم مسجّل مسبقاً',
      }),
    });
    const { user } = renderApp('/register');

    await fillRequiredFields(user);
    await user.click(screen.getByRole('checkbox', { name: 'مطعم' }));
    await user.click(screen.getByRole('button', { name: 'افتح متجري' }));

    const phone = screen.getByLabelText('رقم الجوال');
    await expect.poll(() => phone.getAttribute('aria-invalid')).toBe('true');
    const errorId = phone.getAttribute('aria-describedby')?.split(' ')[0] ?? '';
    expect(document.getElementById(errorId)).toHaveTextContent('هذا الرقم مسجّل مسبقاً');
    expect(phone).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'نشاط المتجر' })).getByRole('checkbox', { name: 'مطعم' }),
    ).toBeChecked();
  });
});
