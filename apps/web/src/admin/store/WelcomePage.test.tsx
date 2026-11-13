import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, StoreResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function owner(step = 0, done = false): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage', 'catalog.manage'] },
    onboarding: { step, done },
  };
}

function store(overrides: Partial<StoreResponse> = {}): StoreResponse {
  return {
    name: 'أحمد الخطيب',
    legalName: null,
    taxNumber: null,
    sectors: [],
    address: null,
    phone: null,
    receiptFooter: null,
    baseCurrency: 'SYP',
    enabledCurrencies: ['SYP'],
    taxInclusive: true,
    usdRate: null,
    onboarding: { step: 0, done: false },
    scaleBarcode: null,
    service: null,
    loyalty: null,
    ...overrides,
  };
}

/** A fake server keeping the store between requests, as the real one would. */
function openWizard(me: MeResponse, initial: StoreResponse, path = '/') {
  let current = initial;
  let meNow = me;
  const routes = {
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: meNow }),
    'GET /v1/store': () => ({ status: 200, body: current }),
    'PUT /v1/store/onboarding': (r: MockRequest) => {
      const body = r.body as { step: number; done?: boolean };
      current = { ...current, onboarding: { step: body.step, done: !!body.done } };
      if (body.done) meNow = { ...meNow, onboarding: { step: body.step, done: true } };
      return { status: 200, body: current };
    },
    'PUT /v1/store/profile': (r: MockRequest) => {
      const body = r.body as Partial<StoreResponse>;
      if (body.name === 'x') return apiError(400, 'validation_failed', 'تحقّق من الحقول', { name: 'قصير' });
      current = { ...current, ...body, phone: body.phone ? '+963933123456' : null };
      return { status: 200, body: current };
    },
    'PUT /v1/store/currency': (r: MockRequest) => {
      const body = r.body as { usdEnabled: boolean; usdRate?: string };
      current = {
        ...current,
        enabledCurrencies: body.usdEnabled ? ['SYP', 'USD'] : ['SYP'],
        usdRate: body.usdEnabled ? (body.usdRate ?? null) : null,
      };
      return { status: 200, body: current };
    },
  };
  const mock = mockFetch(routes);
  return { ...mock, ...renderApp(path), store: () => current };
}

describe('the start wizard', () => {
  it('opens for a new store instead of the home page, at step 1', async () => {
    openWizard(owner(), store());
    expect(await screen.findByRole('heading', { name: 'ما نشاط محلّك؟', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('الخطوة', { exact: false })).toHaveTextContent('الخطوة 1 من 4');
    // Each activity card carries its icon from the design system's table (tab 14)
    const cards = await screen.findAllByRole('checkbox');
    expect(cards).toHaveLength(13);
    for (const card of cards) expect(card.closest('label')?.querySelector('svg')).not.toBeNull();
    expect(
      screen.getByRole('checkbox', { name: 'صيدلية' }).closest('label')?.querySelector('svg'),
    ).toHaveClass('lucide-pill');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('goes through the four steps, saving each, and ends on the home page', async () => {
    const { user, requestsTo, store: saved } = openWizard(owner(), store());
    await user.click(await screen.findByRole('checkbox', { name: 'سوبرماركت ومولات' }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    expect(await screen.findByRole('heading', { name: 'معلومات محلّك', level: 1 })).toBeInTheDocument();
    const name = screen.getByLabelText('اسم المحل');
    await user.clear(name);
    await user.type(name, 'سوبرماركت الفرات');
    await user.type(screen.getByLabelText('سطر أسفل الفاتورة'), 'أهلاً بكم');
    // The receipt preview follows the typing
    expect(screen.getByLabelText('معاينة رأس الإيصال')).toHaveTextContent('سوبرماركت الفرات');
    expect(screen.getByLabelText('معاينة رأس الإيصال')).toHaveTextContent('أهلاً بكم');
    await user.click(screen.getByRole('button', { name: 'احفظ وتابع' }));

    expect(await screen.findByRole('heading', { name: 'العملة والأسعار', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /أبيع بعض الأصناف بالدولار/ }));
    await user.type(screen.getByLabelText('سعر الدولار اليوم بالليرة'), '130');
    await user.click(screen.getByRole('button', { name: 'احفظ وتابع' }));

    expect(await screen.findByRole('heading', { name: 'جاهز تبدأ', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /أضف أصنافك/ })).toHaveAttribute('href', '/products');
    expect(screen.getByRole('link', { name: /اربط جهاز الكاشير/ })).toHaveAttribute('href', '/devices');
    await user.click(screen.getByRole('button', { name: 'ابدأ العمل' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'جاهز تبدأ' })).not.toBeInTheDocument());
    expect(saved()).toMatchObject({
      name: 'سوبرماركت الفرات',
      sectors: ['supermarket'],
      receiptFooter: 'أهلاً بكم',
      enabledCurrencies: ['SYP', 'USD'],
      usdRate: '130',
      onboarding: { done: true },
    });
    expect(requestsTo('PUT', '/v1/store/onboarding').map((r) => r.body)).toEqual([
      { step: 1 },
      { step: 2 },
      { step: 3 },
      { step: 4, done: true },
    ]);
  });

  it('resumes at the step the owner left', async () => {
    openWizard(owner(2), store({ onboarding: { step: 2, done: false } }));
    expect(await screen.findByRole('heading', { name: 'العملة والأسعار', level: 1 })).toBeInTheDocument();
  });

  it('asks for the dollar rate when the dollar is turned on', async () => {
    const { user } = openWizard(owner(2), store({ onboarding: { step: 2, done: false } }));
    await user.click(await screen.findByRole('switch', { name: /أبيع بعض الأصناف بالدولار/ }));
    await user.click(screen.getByRole('button', { name: 'احفظ وتابع' }));
    expect(await screen.findByText('اكتب سعر الدولار اليوم')).toBeInTheDocument();
  });

  it('lets every step be skipped, and «لاحقاً» ends it', async () => {
    const { user, requestsTo } = openWizard(owner(), store());
    await user.click(await screen.findByRole('button', { name: 'تخط' }));
    expect(await screen.findByRole('heading', { name: 'معلومات محلّك', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'لاحقاً، خذني إلى الرئيسية' }));
    await waitFor(() =>
      expect(requestsTo('PUT', '/v1/store/onboarding').at(-1)?.body).toEqual({ step: 4, done: true }),
    );
  });

  it('does not open for a store that finished it, nor for staff who cannot change the store', async () => {
    openWizard(owner(4, true), store());
    expect(await screen.findByRole('heading', { name: /^أهلاً، /, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ما نشاط محلّك؟' })).not.toBeInTheDocument();
  });
});

describe('«إعدادات المتجر»', () => {
  it('is in the menu for the owner, and changes the dollar rate', async () => {
    const { user, store: saved } = openWizard(
      owner(4, true),
      store({ enabledCurrencies: ['SYP', 'USD'], usdRate: '130', sectors: ['cafe'] }),
      '/settings',
    );
    expect(await screen.findByRole('heading', { name: 'إعدادات المتجر', level: 1 })).toBeInTheDocument();
    const rate = await screen.findByLabelText('سعر الدولار اليوم بالليرة');
    await user.clear(rate);
    await user.type(rate, '132');
    await user.click(screen.getAllByRole('button', { name: 'احفظ' })[1]!);
    expect(await screen.findByText('حُفظت العملة وسعر الصرف.')).toBeInTheDocument();
    expect(saved().usdRate).toBe('132');
  });

  it('shows the owner-only notice to others', async () => {
    const base = makeMe();
    openWizard({ ...base, onboarding: { step: 4, done: true } }, store({ name: 'محلي' }), '/settings');
    expect(await screen.findByText('هذه الإعدادات يغيّرها المالك فقط.')).toBeInTheDocument();
    expect(await screen.findByText('محلي')).toBeInTheDocument();
  });
});
