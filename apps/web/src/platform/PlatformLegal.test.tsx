import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LegalDetails } from '@serva/core';
import { apiError, mockFetch } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';

beforeEach(() => sessionStorage.setItem('servaPlatformToken', 'pt'));
afterEach(() => sessionStorage.clear());

const details: LegalDetails = {
  companyName: '',
  ownerName: '',
  commercialRegister: '',
  address: '',
  email: '',
  supportWhatsapp: '',
  phone: '',
  governingCity: 'دمشق',
  financialRetention: 'عشر سنوات',
  paymentTolerance: '1%',
  hostingProvider: '',
  hostingCountry: '',
  backupProvider: '',
  smsProvider: '',
  aiProvider: 'x',
  reviewedByLawyer: false,
  updatedAt: '2026-10-30',
};

const open = async (routes: Parameters<typeof mockFetch>[0]) => {
  const mock = mockFetch({
    'GET /v1/platform/payments?status=pending': { status: 200, body: { items: [] } },
    ...routes,
  });
  const view = renderApp('/platform');
  await view.user.click(await screen.findByRole('button', { name: 'بيانات الشركة' }));
  return { ...mock, ...view };
};

describe('the company details in the platform panel', () => {
  it('lists the blanks that remain, links the previews and saves what was typed', async () => {
    let saved: unknown;
    const { user, requestsTo } = await open({
      'GET /v1/platform/legal': { status: 200, body: details },
      'PUT /v1/platform/legal': (request) => {
        saved = request.body;
        return { status: 204 };
      },
    });

    expect(await screen.findByText('بقيت 9 خانات فارغة')).toBeInTheDocument();
    expect(screen.getByText(/الاسم القانوني للشركة، اسم صاحب المشروع/)).toBeInTheDocument();
    // Optional fields never count as blanks.
    expect(screen.getByLabelText('رقم السجل التجاري (اختياري)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'شروط الاستخدام' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'سياسة الخصوصية' })).toHaveAttribute('href', '/privacy');

    await user.type(screen.getByLabelText('الاسم القانوني للشركة *'), 'شركة المثال');
    await user.type(screen.getByLabelText('اسم صاحب المشروع *'), 'أحمد');
    await user.type(screen.getByLabelText('البريد الإلكتروني *'), 'a@example.com');
    expect(screen.getByText('بقيت 6 خانات فارغة')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'راجع المحامي النصين' }));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByText('حُفظت بيانات الشركة.')).toBeInTheDocument();
    expect(saved).toMatchObject({
      companyName: 'شركة المثال',
      ownerName: 'أحمد',
      email: 'a@example.com',
      reviewedByLawyer: true,
    });
    expect(requestsTo('PUT', '/v1/platform/legal')[0]?.headers.Authorization).toBe('Bearer pt');
  });

  it('says so when every required blank is filled, and shows the server’s refusal', async () => {
    const full = {
      ...Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v === '' ? 'x' : v])),
      email: 'a@example.com',
      supportWhatsapp: '+963912345678',
      phone: '',
      commercialRegister: '',
    };
    const { user } = await open({
      'GET /v1/platform/legal': { status: 200, body: full },
      'PUT /v1/platform/legal': apiError(400, 'validation_failed', 'بريد إلكتروني غير صالح'),
    });

    expect(await screen.findByText('كل الخانات الإلزامية معبّأة.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'اليوم' }));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('بريد إلكتروني غير صالح')).toBeInTheDocument();
  });

  it('names each wrong field when saving, marks the required ones, and sends nothing', async () => {
    const { user, requestsTo } = await open({
      'GET /v1/platform/legal': { status: 200, body: details },
      'PUT /v1/platform/legal': { status: 204 },
    });
    // The required fields carry a star and are announced as required; the optional ones say so
    const company = await screen.findByLabelText('الاسم القانوني للشركة *');
    expect(company).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('رقم الهاتف (اختياري)')).not.toHaveAttribute('aria-required');

    await user.type(screen.getByLabelText('البريد الإلكتروني *'), 'not-an-email');
    await user.type(screen.getByLabelText('رقم واتساب الدعم *'), '123');
    // Nothing is said while typing
    expect(screen.queryByText('بريد إلكتروني غير صالح')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('بريد إلكتروني غير صالح')).toBeInTheDocument();
    expect(screen.getByText('رقم هاتف غير صالح')).toBeInTheDocument();
    expect(screen.getByText('تحقّق من الحقول المظلّلة قبل الحفظ.')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/platform/legal')).toHaveLength(0);
  });

  it('shows the error when the details cannot be loaded', async () => {
    await open({
      'GET /v1/platform/legal': apiError(500, 'internal', 'تعذّر التحميل'),
    });
    expect(await screen.findByText('تعذّر التحميل')).toBeInTheDocument();
  });
});
