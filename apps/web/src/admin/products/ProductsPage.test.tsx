import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Permission, ProductListQuery } from '@serva/core';
import { catalogMe, categories, ids, listItem, product, shownText } from '../../test/catalog';
import { apiError, mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

type Routes = Record<string, MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>)>;

const list = (query: Partial<ProductListQuery> = {}) =>
  `GET ${productsPath({ status: 'active', limit: 50, ...query })}`;

const page = (items = [listItem()], nextCursor: string | null = null): MockReply => ({
  status: 200,
  body: { items, nextCursor },
});

const tea = listItem({
  id: ids.other,
  nameAr: 'شاي ربيع 400 غ',
  categoryId: null,
  categoryName: null,
  singleVariantId: null,
  variantCount: 3,
  price: { currency: 'SYP', minMinor: 30000, maxMinor: 35000 },
  barcode: null,
  stockQty: -2500,
});

function openProducts(routes: Routes = {}, permissions?: Permission[], path = '/products') {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe(permissions) },
    'GET /v1/categories': { status: 200, body: { items: categories } },
    [list()]: page([listItem(), tea]),
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

describe('/products list on a phone and the export', () => {
  it('shows cards instead of a table that does not fit, with price, stock and category on each', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      openProducts();
      const cards = await screen.findByRole('list', { name: 'المنتجات' });
      expect(screen.queryByRole('table', { name: 'المنتجات' })).not.toBeInTheDocument();
      const first = within(cards).getAllByRole('listitem')[0]!;
      expect(first).toHaveTextContent('حليب المراعي 1 لتر');
      expect(first).toHaveTextContent('ألبان وأجبان');
      expect(shownText(first)).toContain('150 ل.س');
      // one primary «+ منتج»; the export, the photos and the import sit behind «⋯»
      expect(screen.getAllByRole('link', { name: 'أضف منتجاً' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'صدّر الجدول' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'المزيد من الإجراءات' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('folds the numbers and the filters away on a phone: one search row, a «تصفية» sheet, a one-line banner', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      openProducts({
        [list()]: {
          status: 200,
          body: {
            items: [listItem(), tea],
            nextCursor: null,
            totals: { products: 12, variants: 30, pieces: 1_160_000, negative: 0, runOut: 2, lowest: null },
            attention: { zeroPrice: 0, noPhoto: 5, uncategorised: 3 },
          },
        },
      });
      await screen.findByRole('list', { name: 'المنتجات' });
      // the tiles wait behind one line
      expect(screen.queryByText('القطع في المخزون')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /الأرقام/ }));
      expect(await screen.findByText('القطع في المخزون')).toBeInTheDocument();
      // the selects are not on the page until «تصفية» opens
      expect(screen.queryByRole('combobox', { name: 'التصنيف' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'تصفية' }));
      expect(await screen.findByRole('combobox', { name: 'التصنيف' })).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveTextContent('تصفية المنتجات');
    } finally {
      window.matchMedia = original;
    }
  });

  it('offers «صدّر الجدول» for the whole search', async () => {
    openProducts();
    expect(await screen.findByRole('button', { name: 'صدّر الجدول' })).toBeInTheDocument();
  });
});

describe('/products list: attention and sellable stock', () => {
  it('shows the available number, with the shelf total under it, when expired or blocked batches hold some back', async () => {
    openProducts({
      [list()]: page([listItem({ stockQty: 319_000, sellableQty: 219_000 })]),
    });
    const table = await screen.findByRole('table', { name: 'المنتجات' });
    expect(await within(table).findByText(/في المخزن/)).toHaveTextContent('في المخزن 319');
    expect(within(table).getByText('219')).toBeInTheDocument();
  });

  it('keeps the uncategorised banner to one line with the services left out, and lets «بلا صورة» be dismissed', async () => {
    localStorage.removeItem('serva.products.attention');
    openProducts({
      [list()]: {
        status: 200,
        body: {
          items: [listItem({ hasImage: false })],
          nextCursor: null,
          attention: { zeroPrice: 0, noPhoto: 12, expiringSoon: 0, uncategorised: 0 },
        },
      },
    });
    const line = await screen.findByLabelText('تحتاج انتباهك');
    expect(line).toHaveTextContent('12 بلا صورة');
    expect(line).not.toHaveTextContent('بلا تصنيف');
    fireEvent.click(screen.getByRole('button', { name: 'أخفِ هذا التنبيه' }));
    expect(screen.queryByLabelText('تحتاج انتباهك')).not.toBeInTheDocument();
  });
});

describe('/products list', () => {
  it('shows each product with its category, price, stock and barcode, and the menu item active', async () => {
    openProducts();

    expect(await screen.findByRole('heading', { name: 'المنتجات', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'المنتجات' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('حليب المراعي 1 لتر');
    expect(rows[1]).toHaveTextContent('6281007035105');
    expect(rows[1]).toHaveTextContent('ألبان وأجبان');
    expect(shownText(rows[1])).toContain('150 ل.س');
    expect(rows[1]).toHaveTextContent('94');
    expect(within(rows[1]!).getByRole('link', { name: 'حليب المراعي 1 لتر' })).toHaveAttribute(
      'href',
      `/products/${ids.milk}`,
    );
    // Several variants: a price range, no in-place edit; stock below zero in red.
    expect(rows[2]).toHaveTextContent('3 متغيّرات');
    expect(shownText(rows[2])).toContain('300 ل.س – 350 ل.س');
    expect(rows[2]).toHaveTextContent('بلا تصنيف');
    expect(within(rows[2]!).queryByRole('button', { name: /عدّل سعر/ })).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText(/2\.500/)).toHaveClass('text-danger-ink');

    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'المنتجات' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('says in one line how many products of the whole store sell at 0 and have no photo', async () => {
    openProducts({
      [list()]: {
        status: 200,
        body: {
          items: [listItem({ hasImage: true })],
          nextCursor: null,
          attention: { zeroPrice: 7, noPhoto: 40, uncategorised: 3 },
        },
      },
    });
    const line = await screen.findByLabelText('تحتاج انتباهك');
    expect(line).toHaveTextContent('3 بلا تصنيف · 7 بسعر صفر · 40 بلا صورة');
    // the explanations wait behind the «i»
    expect(screen.queryByText(/تُباع مجاناً/)).not.toBeInTheDocument();
    fireEvent.click(within(line).getByRole('button', { name: 'اشرح' }));
    expect(await screen.findByText(/تُباع مجاناً/)).toBeInTheDocument();
  });

  it('keeps the tiles whole-store while a search narrows the list', async () => {
    const totals = { products: 12, variants: 30, pieces: 1_160_000, negative: 0, runOut: 2, lowest: null };
    openProducts({
      [list()]: { status: 200, body: { items: [listItem(), tea], nextCursor: null, totals } },
      [list({ q: 'شاي' })]: page([tea]),
    });
    expect(await screen.findByText('12')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'ابحث بالاسم أو الباركود' }), {
      target: { value: 'شاي' },
    });
    await screen.findByText('شاي ربيع 400 غ');
    await vi.waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('نفد')).toBeInTheDocument();
  });

  it('proposes a category from each name, lets the owner review, then sets them on the ticked rows', async () => {
    const patches: unknown[] = [];
    const glove = listItem({ id: ids.other, nameAr: 'قفازات طبية', categoryId: null, categoryName: null });
    const medical = catalogMe();
    openProducts({
      'GET /v1/me': {
        status: 200,
        body: { ...medical, tenant: { ...medical.tenant, sectors: ['medical_supplies'] } },
      },
      [list()]: page([glove]),
      [`PATCH /v1/products/${ids.other}`]: (request) => {
        patches.push(request.body);
        return { status: 200, body: product({ id: ids.other, version: 2 }) };
      },
      'POST /v1/categories': {
        status: 201,
        body: {
          id: ids.milk,
          name: 'مستهلكات',
          parentId: null,
          sortOrder: 0,
          productCount: 0,
          archivedAt: null,
          version: 1,
        },
      },
    });
    await screen.findByText('قفازات طبية');
    fireEvent.click(screen.getByRole('checkbox', { name: 'حدّد «قفازات طبية»' }));
    fireEvent.click(await screen.findByRole('button', { name: 'صنّف المحددة' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'تصنيف «قفازات طبية»' })).toHaveDisplayValue(
      'مستهلكات (جديد)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: /طبّق على 1/ }));
    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ categoryId: ids.milk });
  });

  it('shows the loading rows first', async () => {
    // The answer exists before anything renders. Capturing `resolve` inside the handler raced the
    // page: when the busy table showed before the list was requested, `answer` was still the no-op,
    // the request never resolved and the row never came, however long the test waited.
    let answer!: (reply: MockReply) => void;
    const reply = new Promise<MockReply>((resolve) => (answer = resolve));
    openProducts({ [list()]: () => reply });

    const table = await screen.findByRole('table', { name: 'المنتجات' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    answer(page());
    expect(await screen.findByText('حليب المراعي 1 لتر')).toBeInTheDocument();
    expect(table).not.toHaveAttribute('aria-busy');
  });

  it('searches in the normalized form', async () => {
    const { user, requestsTo } = openProducts({
      [list({ q: 'شوكولاته' })]: page([listItem({ nameAr: 'شوكولاتة جالكسي' })]),
    });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.type(screen.getByRole('searchbox', { name: 'ابحث بالاسم أو الباركود' }), 'شُوكولاتة');

    expect(await screen.findByText('شوكولاتة جالكسي')).toBeInTheDocument();
    expect(requestsTo('GET', productsPath({ q: 'شوكولاته', status: 'active', limit: 50 }))).toHaveLength(1);
  });

  it('filters by category and status', async () => {
    const { user } = openProducts({
      [list({ categoryId: ids.cheese })]: page([listItem({ nameAr: 'جبنة بيضاء' })]),
      [list({ categoryId: ids.cheese, status: 'archived' })]: page([
        listItem({ nameAr: 'جبنة قديمة', archivedAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    });
    await screen.findByText('حليب المراعي 1 لتر');

    const select = screen.getByRole('combobox', { name: 'التصنيف' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['كل التصنيفات', 'ألبان وأجبان', '— أجبان', 'منظفات']);
    await user.selectOptions(select, ids.cheese);
    expect(await screen.findByText('جبنة بيضاء')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'المؤرشفة' }));
    const row = (await screen.findByText('جبنة قديمة')).closest('tr')!;
    expect(row).toHaveTextContent('مؤرشف');
  });

  it('opens with the category the categories page linked to', async () => {
    openProducts(
      { [list({ categoryId: ids.dairy })]: page([listItem({ nameAr: 'لبنة' })]) },
      undefined,
      `/products?category=${ids.dairy}`,
    );
    expect(await screen.findByText('لبنة')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'التصنيف' })).toHaveValue(ids.dairy);
  });

  it('marks the products a cashier made, waiting for review', async () => {
    const { user } = openProducts({
      [list({ status: 'temporary' })]: page([listItem({ nameAr: 'حلاوة الدرويش', status: 'temporary' })]),
    });
    await screen.findByText('حليب المراعي 1 لتر');
    await user.click(screen.getByRole('radio', { name: 'من الكاشير' }));
    const row = (await screen.findByText('حلاوة الدرويش')).closest('tr')!;
    expect(row).toHaveTextContent('بانتظار المراجعة');
  });

  it('pages with the cursor', async () => {
    const { user } = openProducts({
      [list()]: page([listItem()], 'cursor-2'),
      [list({ cursor: 'cursor-2' })]: page([tea]),
    });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.click(screen.getByRole('button', { name: 'اعرض المزيد' }));

    expect(await screen.findByText('شاي ربيع 400 غ')).toBeInTheDocument();
    expect(screen.getByText('حليب المراعي 1 لتر')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'اعرض المزيد' })).not.toBeInTheDocument();
  });

  it('says there is no product yet and offers the first one', async () => {
    openProducts({ [list()]: page([]) });

    expect(await screen.findByText('لا منتجات بعد.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'أضف منتجاً' })).toHaveLength(2);
  });

  it('says when a search finds nothing, and clears it', async () => {
    const { user } = openProducts({ [list({ q: 'xyz' })]: page([]) });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.type(screen.getByRole('searchbox'), 'xyz');
    expect(await screen.findByText('لا منتجات تطابق بحثك.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'امسح البحث والتصفية' }));
    expect(await screen.findByText('حليب المراعي 1 لتر')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('shows a load error with a retry', async () => {
    let fail = true;
    const { user } = openProducts({
      [list()]: () => (fail ? apiError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.') : page()),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('الخادم مشغول حالياً.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(await screen.findByText('حليب المراعي 1 لتر')).toBeInTheDocument();
  });

  it('hides adding and price editing from whoever cannot change the catalog', async () => {
    openProducts({}, ['sale.create']);

    await screen.findByText('حليب المراعي 1 لتر');
    expect(screen.queryByRole('link', { name: 'أضف منتجاً' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /عدّل سعر/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'القائمة الرئيسية' })).not.toHaveTextContent('المنتجات');
  });
});

describe('scanning on the list', () => {
  it('opens the product of a code scanned into the search box (Arabic digits too)', async () => {
    const { user, requestsTo } = openProducts({
      'GET /v1/barcodes/6281007035105': {
        status: 200,
        body: {
          productId: ids.milk,
          variantId: ids.milkVariant,
          barcode: product().variants[0]!.barcodes[0],
        },
      },
      [`GET /v1/products/${ids.milk}`]: { status: 200, body: product() },
      'GET /v1/units': { status: 200, body: { items: [] } },
      'GET /v1/tax-rates': { status: 200, body: { items: [] } },
    });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.type(screen.getByRole('searchbox'), '٦٢٨١٠٠٧٠٣٥١٠٥{Enter}');

    expect(await screen.findByRole('heading', { name: 'حليب المراعي 1 لتر', level: 1 })).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/barcodes/6281007035105')).toHaveLength(1);
  });

  it('catches a scan with no field focused', async () => {
    const { requestsTo } = openProducts({
      'GET /v1/barcodes/6290360100125': apiError(404, 'not_found', 'لا يوجد.'),
    });
    await screen.findByText('حليب المراعي 1 لتر');

    // A scanner types the whole code in a few milliseconds, then Enter.
    for (const key of '6290360100125') fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(await screen.findByText(/لا منتج بهذا الباركود/)).toHaveTextContent('6290360100125');
    expect(requestsTo('GET', '/v1/barcodes/6290360100125')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'أضف منتجاً بهذا الباركود' })).toHaveAttribute(
      'href',
      '/products/new?barcode=6290360100125',
    );
  });

  it('ignores slow typing on the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock } = openProducts();
    await screen.findByText('حليب المراعي 1 لتر');
    const before = fetchMock.mock.calls.length;

    for (const key of '1234') {
      fireEvent.keyDown(document.body, { key });
      await vi.advanceTimersByTimeAsync(200);
    }
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(fetchMock.mock.calls.length).toBe(before);
    vi.useRealTimers();
  });
});

describe('editing a price in place', () => {
  it('saves one variant’s price with the version the list read', async () => {
    const { user, requestsTo } = openProducts({
      [`PATCH /v1/products/${ids.milk}`]: {
        status: 200,
        body: product({ version: 4, variants: [] }),
      },
    });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.click(screen.getByRole('button', { name: 'عدّل سعر «حليب المراعي 1 لتر»' }));
    const field = screen.getByLabelText('السعر الجديد لـ«حليب المراعي 1 لتر»');
    await user.clear(field);
    await user.type(field, '175');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByText(/حُفظ سعر «حليب المراعي 1 لتر»/)).toBeInTheDocument();
    expect(requestsTo('PATCH', `/v1/products/${ids.milk}`)[0]!.body).toEqual({
      version: 3,
      variants: [{ id: ids.milkVariant, price: { currency: 'SYP', priceMinor: 17500 } }],
    });
    expect(shownText(screen.getByRole('table'))).toContain('175 ل.س');
  });

  it('reloads the list when someone changed the product first', async () => {
    const { user, requestsTo } = openProducts({
      [`PATCH /v1/products/${ids.milk}`]: apiError(409, 'stale_version', 'تغيّر السجل.'),
    });
    await screen.findByText('حليب المراعي 1 لتر');

    await user.click(screen.getByRole('button', { name: 'عدّل سعر «حليب المراعي 1 لتر»' }));
    await user.type(screen.getByLabelText('السعر الجديد لـ«حليب المراعي 1 لتر»'), '5');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'غيّر أحدٌ «حليب المراعي 1 لتر» للتو. حدّثنا القائمة، جرّب مرة أخرى.',
    );
    await vi.waitFor(() =>
      expect(requestsTo('GET', productsPath({ status: 'active', limit: 50 }))).toHaveLength(2),
    );
  });

  it('refuses an empty price', async () => {
    const { user, requestsTo } = openProducts();
    await screen.findByText('حليب المراعي 1 لتر');

    await user.click(screen.getByRole('button', { name: 'عدّل سعر «حليب المراعي 1 لتر»' }));
    await user.clear(screen.getByLabelText('السعر الجديد لـ«حليب المراعي 1 لتر»'));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(screen.getByText('اكتب السعر')).toBeInTheDocument();
    expect(requestsTo('PATCH', `/v1/products/${ids.milk}`)).toHaveLength(0);
  });
});

describe('/products list: photos, expiry and stock', () => {
  it('shows each product’s first picture, and an «أضف صورة» link on one without', async () => {
    openProducts({
      [list()]: page([
        listItem({ hasImage: true, thumbUrl: '/v1/images/t/u1?size=thumb' }),
        listItem({ id: ids.other, nameAr: 'شاي', hasImage: false, thumbUrl: null }),
      ]),
    });
    const table = await screen.findByRole('table', { name: 'المنتجات' });
    await within(table).findByRole('link', { name: 'أضف صورة لـ«شاي»' });
    expect(table.querySelector('img[src^="/v1/images"]')).toHaveAttribute(
      'src',
      '/v1/images/t/u1?size=thumb',
    );
    expect(within(table).getByRole('link', { name: 'أضف صورة لـ«شاي»' })).toHaveAttribute(
      'href',
      `/products/${ids.other}#images`,
    );
  });

  it('shows one number (the available), with the minus told once under it, and a kind icon where there is no photo', async () => {
    openProducts({
      [list()]: page([listItem({ stockQty: 14_000, sellableQty: 16_000, hasImage: false, thumbUrl: null })]),
    });
    const table = await screen.findByRole('table', { name: 'المنتجات' });
    expect(await within(table).findByText(/سالب قطعتان/)).toBeInTheDocument();
    expect(within(table).getByText('16')).toBeInTheDocument();
    expect(within(table).queryByText('14')).not.toBeInTheDocument();
    // no letter box: the picture's place holds an icon
    expect(table.querySelector('a[href$="#images"] svg')).not.toBeNull();
  });

  it('adds up only positive stock and says how many are below zero', async () => {
    openProducts();
    await screen.findByText('القطع في المخزون');
    // 94 on the shelf; the −2.5 of the other product is not netted off, it is counted apart
    // …and it is told once, inside the «نفد» tile, not as a second count beside the pieces
    expect(await screen.findByText(/منها سالب 1/)).toBeInTheDocument();
    expect(screen.queryByText('صنف واحد ناقص')).not.toBeInTheDocument();
  });

  it('tells a negative stock apart with «سالب» and offers the count and the receiving', async () => {
    openProducts();
    expect((await screen.findAllByText('سالب')).length).toBeGreaterThan(0);
    // «سالب N» once on the «نفد» tile, with one action
    expect(await screen.findByText(/منها سالب 1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'اجرد المخزون' })).toHaveAttribute('href', '/inventory');
    expect(screen.queryByRole('link', { name: 'سجّل استلاماً' })).not.toBeInTheDocument();
  });

  it('says a service has no shelf price, instead of 0', async () => {
    openProducts({
      [list()]: page([
        listItem({
          id: ids.other,
          nameAr: 'تقصير',
          type: 'service',
          price: { currency: 'SYP', minMinor: 0, maxMinor: 0 },
          stockQty: 0,
        }),
      ]),
    });
    expect(await screen.findByText('خدمة · السعر عند البيع')).toBeInTheDocument();
  });

  it('shows the nearest expiry, a «ينتهي خلال 30 يوماً» tile and the filter', async () => {
    const { requestsTo, user } = openProducts({
      [list()]: {
        status: 200,
        body: {
          items: [
            listItem({ nearestExpiry: '2020-01-05' }),
            listItem({ id: ids.other, nearestExpiry: null }),
          ],
          nextCursor: null,
          attention: { zeroPrice: 0, noPhoto: 0, expiringSoon: 4 },
        },
      },
      [list({ expiry: 'soon' })]: page([listItem()]),
    });
    const table = await screen.findByRole('table', { name: 'المنتجات' });
    expect(await within(table).findByRole('columnheader', { name: 'ينتهي' })).toBeInTheDocument();
    expect(within(table).getAllByText('منتهية').length).toBeGreaterThan(0);
    expect(screen.getByText('ينتهي خلال 30 يوماً')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('الصلاحية'), 'soon');
    await vi.waitFor(() =>
      expect(requestsTo('GET', productsPath({ status: 'active', limit: 50, expiry: 'soon' }))).toHaveLength(
        1,
      ),
    );
  });
});

describe('/products list: photos in bulk', () => {
  it('opens the bulk-photo window, which says how files are matched', async () => {
    const { user } = openProducts();
    await user.click(await screen.findByRole('button', { name: /^أضف صوراً دفعة واحدة/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/سمِّ كل ملف باسم المنتج أو باركوده/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('ملفات الصور')).toHaveAttribute('multiple');
    expect(within(dialog).getByRole('button', { name: 'ارفع الصور' })).toBeDisabled();
  });
});
