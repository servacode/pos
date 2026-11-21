import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Category, MeResponse, Promotion, StoreResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { dateBound, localDate } from './PromotionForm';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage', 'settings.manage'] },
  };
}

const dairy: Category = {
  id: 'cat-1',
  name: 'ألبان',
  parentId: null,
  sortOrder: 0,
  productCount: 3,
  archivedAt: null,
  version: 1,
};

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p-1',
  name: 'خصم الألبان',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'categories',
  categoryIds: ['cat-1'],
  productIds: [],
  startsAt: '2026-10-31T21:00:00.000Z',
  endsAt: '2026-11-30T21:00:00.000Z',
  daysOfWeek: [4, 5],
  fromTime: '18:00',
  toTime: '22:00',
  archived: false,
  version: 1,
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

function open(path: string, initial: Promotion[] = [promo()]) {
  let items = initial;
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/promotions': () => ({ status: 200, body: { items } }),
    'GET /v1/categories': () => ({ status: 200, body: { items: [dairy] } }),
    'GET /v1/products?limit=200': () => ({ status: 200, body: { items: [], nextCursor: null } }),
    'POST /v1/promotions': (r: MockRequest) => {
      const body = r.body as Partial<Promotion>;
      if (body.name === 'ع') return apiError(400, 'validation_failed', 'تحقّق', { name: 'اسم العرض مطلوب' });
      const made = promo({ ...body, id: 'p-2', version: 1 } as Partial<Promotion>);
      items = [...items, made];
      return { status: 201, body: made };
    },
    'PUT /v1/promotions/p-1': (r: MockRequest) => {
      const body = r.body as Partial<Promotion>;
      items = items.map((p) => (p.id === 'p-1' ? { ...p, ...body, version: p.version + 1 } : p));
      return { status: 200, body: items[0] };
    },
    'POST /v1/promotions/p-1/archive': (r: MockRequest) => {
      const body = r.body as { archived: boolean };
      items = items.map((p) =>
        p.id === 'p-1' ? { ...p, archived: body.archived, version: p.version + 1 } : p,
      );
      return { status: 200, body: items[0] };
    },
  });
  return { ...mock, ...renderApp(path) };
}

describe('dates on the store’s clock', () => {
  it('turns a local day into its first instant, and an end day into the first instant after it', () => {
    expect(dateBound('2026-11-01', false)).toBe('2026-10-31T21:00:00.000Z');
    expect(dateBound('2026-11-30', true)).toBe('2026-11-30T21:00:00.000Z');
    expect(dateBound('', true)).toBeNull();
    expect(localDate('2026-10-31T21:00:00.000Z')).toBe('2026-11-01');
  });
});

describe('«العروض»', () => {
  it('lists promotions with what they give and when, and stops one', async () => {
    const { user, requestsTo } = open('/promotions');
    expect(await screen.findByRole('heading', { name: 'العروض', level: 1 })).toBeInTheDocument();
    // One row per promotion, in a table named «العروض».
    const list = await screen.findByRole('table', { name: 'العروض' });
    expect(await within(list).findByText('خصم الألبان')).toBeInTheDocument();
    expect(list).toHaveTextContent('خصم 10% على 1 تصنيف');
    expect(list).toHaveTextContent(
      'من 1 تشرين الثاني 2026 · حتى 30 تشرين الثاني 2026 · الخميس، الجمعة · 18:00–22:00',
    );
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    await user.click(within(list).getByRole('button', { name: 'أوقف' }));
    // A stopped offer leaves the live list at once, with a sentence saying where it went
    expect(await screen.findByText(/أُوقف «خصم الألبان»/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /أظهر المتوقفة والمنتهية \(1\)/ }));
    expect(await within(list).findByText('متوقف')).toBeInTheDocument();
    // Only the stop is sent (not the whole offer), so an old row can always be stopped
    expect(requestsTo('POST', '/v1/promotions/p-1/archive').at(-1)?.body).toEqual({
      version: 1,
      archived: true,
    });
  });

  it('adds «buy two, the third free» on all products, showing the server’s message on the field', async () => {
    const { user, requestsTo } = open('/promotions', []);
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'ع');
    await user.click(within(form).getByRole('radio', { name: 'اشترِ واحصل مجاناً' }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اسم العرض مطلوب')).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'));
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'اشترِ 2 والثالث مجاناً');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اشترِ 2 والثالث مجاناً')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({
      kind: 'buy_get',
      buyQty: 2,
      getQty: 1,
      percentBp: null,
      scope: 'all',
      startsAt: null,
      endsAt: null,
    });
  });

  it('a percent promotion on a category needs its percent first', async () => {
    const { user, requestsTo } = open('/promotions', []);
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'خصم الحليب');
    await user.selectOptions(within(form).getByLabelText('على ماذا'), 'categories');
    await user.click(await within(form).findByRole('checkbox', { name: 'ألبان' }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اكتب نسبة بين 1 و100')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('نسبة الخصم %'), '15');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await screen.findByText('خصم الحليب');
    expect(requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({
      percentBp: 1500,
      scope: 'categories',
      categoryIds: ['cat-1'],
    });
  });
});

describe('trade promotions', () => {
  it('adds a «حسب الكمية» promotion with its steps, for wholesale customers and the reps', async () => {
    const { user, requestsTo } = open('/promotions', []);
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'خصم الكميات');
    await user.click(within(form).getByRole('radio', { name: /خصم حسب الكمية/ }));
    await user.type(within(form).getByLabelText('الخصم %'), '5');
    await user.click(within(form).getByRole('button', { name: 'أضف شريحة' }));
    await user.type(within(form).getByLabelText('من كم قطعة (شريحة 2)'), '50');
    const percents = within(form).getAllByLabelText('الخصم %');
    await user.type(percents[1]!, '8');
    await user.click(within(form).getByRole('checkbox', { name: 'زبائن الجملة' }));
    await user.click(within(form).getByRole('checkbox', { name: 'بقالية' }));
    await user.click(within(form).getByRole('checkbox', { name: 'على هاتف المندوب فقط' }));
    // A code is for the old kinds only
    expect(within(form).queryByLabelText('الكود (اختياري)')).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await screen.findByText('خصم الكميات');
    expect(requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({
      kind: 'tiered',
      percentBp: null,
      tiers: [
        { minQty: 10, percentBp: 500 },
        { minQty: 50, percentBp: 800 },
      ],
      priceTiers: ['wholesale'],
      customerKinds: ['grocery'],
      repOnly: true,
      couponCode: null,
    });
  });

  it('adds a free-item promotion: the gift is picked by name, one variant', async () => {
    let items: Promotion[] = [];
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/promotions': () => ({ status: 200, body: { items } }),
      'GET /v1/categories': () => ({ status: 200, body: { items: [dairy] } }),
      'GET /v1/products?limit=200': () => ({ status: 200, body: { items: [], nextCursor: null } }),
      'GET /v1/products?q=%D9%83%D9%88%D9%84%D8%A7&limit=8': () => ({
        status: 200,
        body: {
          items: [{ id: 'prod-cola', nameAr: 'كولا', singleVariantId: 'var-cola' }],
          nextCursor: null,
        },
      }),
      'POST /v1/promotions': (r: MockRequest) => {
        const made = promo({ ...(r.body as Partial<Promotion>), id: 'p-9' } as Partial<Promotion>);
        items = [made];
        return { status: 201, body: made };
      },
    });
    const { user } = renderApp('/promotions');
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'هدية كولا');
    await user.click(within(form).getByRole('radio', { name: /هدية من صنف آخر/ }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اختر الصنف المجاني')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('الصنف المجاني: ابحث بالاسم'), 'كولا');
    await user.click(await within(form).findByRole('button', { name: 'كولا' }));
    expect(within(form).getByText('الصنف المجاني: كولا')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await screen.findByText('هدية كولا');
    expect(mock.requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({
      kind: 'free_item',
      buyQty: 2,
      freeQty: 1,
      freeVariantId: 'var-cola',
      percentBp: null,
      tiers: [],
    });
  });

  it('describes the new kinds on their cards', async () => {
    open('/promotions', [
      promo({
        id: 'p-t',
        name: 'كميات',
        kind: 'tiered',
        percentBp: null,
        scope: 'all',
        tiers: [{ minQty: 10, percentBp: 500 }],
        repOnly: true,
      }),
    ]);
    const list = await screen.findByRole('table', { name: 'العروض' });
    expect(await within(list).findByText('كميات')).toBeInTheDocument();
    expect(list).toHaveTextContent('خصم حسب الكمية: من 10 5% على كل المنتجات · للمندوب فقط');
  });
});

describe('round 44: the offer form and the list', () => {
  it('refuses a code on an offer for some customers only, then saves the offer stopped', async () => {
    const { user, requestsTo } = open('/promotions', []);
    await user.click(await screen.findByRole('button', { name: 'عرض جديد' }));
    const form = screen.getByRole('form', { name: 'عرض جديد' });
    await user.type(within(form).getByLabelText('اسم العرض كما يُطبع على الإيصال'), 'عرض الجملة');
    await user.type(within(form).getByLabelText('نسبة الخصم %'), '10');
    await user.type(within(form).getByLabelText('الكود (اختياري)'), 'WHOLE');
    await user.click(within(form).getByRole('checkbox', { name: 'زبائن الجملة' }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/الكود لا يعمل مع عرض مخصص/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/promotions')).toHaveLength(0);
    // Without the audience, and kept stopped: nothing goes live
    await user.click(within(form).getByRole('checkbox', { name: 'زبائن الجملة' }));
    await user.click(within(form).getByRole('checkbox', { name: 'احفظه متوقفاً' }));
    expect(within(form).getByText(/يُحفظ متوقفاً/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await screen.findByText('عرض الجملة');
    expect(requestsTo('POST', '/v1/promotions').at(-1)?.body).toMatchObject({
      couponCode: 'WHOLE',
      archived: true,
      repOnly: false,
    });
  });

  it('says an offer ends soon, flags two that overlap, and sends one stop for a double click', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const open1 = promo({
      id: 'p-1',
      name: 'تنزيلات',
      scope: 'all',
      categoryIds: [],
      startsAt: null,
      endsAt: soon,
      daysOfWeek: [],
      fromTime: null,
      toTime: null,
    });
    const open2 = promo({
      id: 'p-2',
      name: 'عرض الشتاء',
      scope: 'all',
      categoryIds: [],
      startsAt: null,
      endsAt: null,
      daysOfWeek: [],
      fromTime: null,
      toTime: null,
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/promotions': () => ({ status: 200, body: { items: [open1, open2] } }),
      'POST /v1/promotions/p-1/archive': async () => {
        await gate;
        return { status: 200, body: { ...open1, archived: true, version: 2 } };
      },
    });
    const { user } = renderApp('/promotions');
    const table = await screen.findByRole('table', { name: 'العروض' });
    expect(await within(table).findByText(/ينتهي (اليوم|غداً|بعد \d أيام)/)).toBeInTheDocument();
    expect(table).toHaveTextContent('يتقاطع مع «عرض الشتاء»');
    await user.dblClick(within(table).getAllByRole('button', { name: 'أوقف' })[0]!);
    release();
    await screen.findByRole('table', { name: 'العروض' });
    expect(requestsTo('POST', '/v1/promotions/p-1/archive')).toHaveLength(1);
  });
});

describe('«باركود الميزان» in the settings', () => {
  it('turns scale labels on with the usual setting and saves it', async () => {
    const store: StoreResponse = {
      name: 'سوبرماركت الفرات',
      legalName: null,
      taxNumber: null,
      sectors: ['supermarket'],
      address: null,
      phone: null,
      receiptFooter: null,
      baseCurrency: 'SYP',
      enabledCurrencies: ['SYP'],
      taxInclusive: true,
      usdRate: null,
      onboarding: { step: 4, done: true },
      scaleBarcode: null,
      service: null,
      loyalty: null,
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/store': () => ({ status: 200, body: store }),
      'PUT /v1/store/scale': (r: MockRequest) => ({
        status: 200,
        body: { ...store, ...(r.body as Partial<StoreResponse>) },
      }),
    });
    const { user } = renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'باركود الميزان' });
    await user.click(within(form).getByRole('switch', { name: /ميزاني يطبع ملصقات/ }));
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText(/حُفظ باركود الميزان/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/store/scale').at(-1)?.body).toEqual({
      scaleBarcode: {
        prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28'],
        itemDigits: 5,
        valueKind: 'weight',
        valueDecimals: 3,
      },
    });
  });
});
