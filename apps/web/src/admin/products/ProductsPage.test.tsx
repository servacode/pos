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
    expect(within(rows[2]!).getByText('-2.500')).toHaveClass('text-danger-ink');

    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'المنتجات' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('shows the loading rows first', async () => {
    let answer: (reply: MockReply) => void = () => undefined;
    openProducts({ [list()]: () => new Promise<MockReply>((resolve) => (answer = resolve)) });

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
