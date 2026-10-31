import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '@serva/core';
import { catalogMe, ids, lookupRoutes, product, shownText, variant } from '../../test/catalog';
import { apiError, mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

type Routes = Record<string, MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>)>;

const productPath = `/v1/products/${ids.milk}`;

function openCard(path: string, routes: Routes = {}, permissions?: Permission[]) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe(permissions) },
    ...lookupRoutes,
    [`GET ${productPath}`]: { status: 200, body: product() },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

const notFound = apiError(404, 'not_found', 'لا يوجد.');

describe('a new product', () => {
  it('saves the name, category, price and barcodes in one request, then opens the saved card', async () => {
    const saved = product({ nameAr: 'سكر أبيض 1 كغ', version: 1 });
    const { user, requestsTo } = openCard('/products/new', {
      'GET /v1/barcodes/6290360100125': notFound,
      'POST /v1/products': { status: 201, body: saved },
      [`GET ${productPath}`]: { status: 200, body: saved },
    });

    expect(await screen.findByRole('heading', { name: 'منتج جديد', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسم المنتج'), 'سكر أبيض 1 كغ');
    await user.selectOptions(screen.getByLabelText('التصنيف'), ids.dairy);
    await user.selectOptions(screen.getByLabelText('الضريبة'), ids.tax);
    await user.type(screen.getByLabelText('سعر البيع'), '120');
    // The scanner types into the barcode field and ends with Enter.
    await user.type(screen.getByRole('textbox', { name: 'باركود جديد' }), '6290360100125{Enter}');
    expect(await screen.findByText('6290360100125')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ولّد باركوداً داخلياً' }));
    expect(screen.getByText('يُولَّد عند الحفظ، ويبدأ بـ29')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByText('حُفظ المنتج، ويصل إلى أجهزة الكاشير مع أول اتصال.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'سكر أبيض 1 كغ', level: 1 })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/products')[0]!.body).toEqual({
      nameAr: 'سكر أبيض 1 كغ',
      nameEn: null,
      brand: null,
      categoryId: ids.dairy,
      type: 'stock',
      unitId: ids.piece,
      taxRateId: ids.tax,
      sellOnPos: true,
      variants: [
        {
          sku: null,
          attributes: [],
          price: { currency: 'SYP', priceMinor: 12000 },
          minPriceMinor: null,
          minStockQty: null,
          barcodes: [
            { kind: 'standard', code: '6290360100125', packQty: 1000, packName: null, packPriceMinor: null },
            { kind: 'internal', packQty: 1000, packName: null, packPriceMinor: null },
          ],
        },
      ],
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('starts with the barcode scanned on the list', async () => {
    openCard('/products/new?barcode=6290360100125');
    expect(await screen.findByText('6290360100125')).toBeInTheDocument();
  });

  it('marks the missing name and price, and focuses the name', async () => {
    const { user, requestsTo } = openCard('/products/new');
    await screen.findByLabelText('اسم المنتج');

    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(screen.getByText('اسم المنتج مطلوب')).toBeInTheDocument();
    expect(screen.getByText('اكتب سعر البيع')).toBeInTheDocument();
    expect(screen.getByLabelText('اسم المنتج')).toHaveFocus();
    expect(screen.getByLabelText('اسم المنتج')).toHaveAttribute('aria-invalid', 'true');
    expect(requestsTo('POST', '/v1/products')).toHaveLength(0);
  });

  it('puts the server’s error on the barcode it names', async () => {
    const { user } = openCard('/products/new?barcode=6281003016418', {
      'POST /v1/products': apiError(400, 'validation_failed', 'تحقّق من البيانات.', {
        'variants.0.barcodes.0.code': 'الباركود 6281003016418 مستعمل في «شاي ربيع 400 غ»',
      }),
    });
    await user.type(await screen.findByLabelText('اسم المنتج'), 'شاي');
    await user.type(screen.getByLabelText('سعر البيع'), '350');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    const row = (await screen.findByText('الباركود 6281003016418 مستعمل في «شاي ربيع 400 غ»')).closest('li')!;
    expect(row).toHaveTextContent('6281003016418');
    expect(screen.getByText('راجع الخانات المعلَّمة بالأحمر.')).toBeInTheDocument();
  });

  it('refuses a barcode another product holds, with a link to it', async () => {
    const { user } = openCard('/products/new', {
      'GET /v1/barcodes/6281007035105': {
        status: 200,
        body: { productId: ids.milk, variantId: ids.milkVariant, barcode: variant().barcodes[0] },
      },
    });

    await user.type(await screen.findByRole('textbox', { name: 'باركود جديد' }), '6281007035105{Enter}');

    expect(await screen.findByText('هذا الباركود على منتج آخر.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'افتح المنتج الذي عليه هذا الباركود' })).toHaveAttribute(
      'href',
      `/products/${ids.milk}`,
    );
    expect(screen.queryByRole('button', { name: /أزل الباركود/ })).not.toBeInTheDocument();
  });

  it('refuses a malformed or repeated barcode without asking the server', async () => {
    const { user, requestsTo } = openCard('/products/new?barcode=6290360100125');
    const field = await screen.findByRole('textbox', { name: 'باركود جديد' });

    await user.type(field, '12{Enter}');
    expect(screen.getByText('الباركود 3 خانات على الأقل')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '٦٢٩٠٣٦٠١٠٠١٢٥{Enter}');
    expect(screen.getByText('الباركود مكرر في هذا المنتج')).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/barcodes/6290360100125')).toHaveLength(0);
  });

  it('prices in dollars and says the cashier converts at the day’s rate', async () => {
    const { user, requestsTo } = openCard('/products/new', {
      'POST /v1/products': { status: 201, body: product() },
    });
    await user.type(await screen.findByLabelText('اسم المنتج'), 'نسكافيه غولد');
    await user.selectOptions(screen.getByLabelText('العملة'), 'USD');
    expect(
      screen.getByText(/يبقى السعر بالدولار، ويحوّله الكاشير إلى الليرة بسعر الصرف الحالي/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('سعر البيع'), '12.5');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(requestsTo('POST', '/v1/products')).toHaveLength(1));
    expect(
      (requestsTo('POST', '/v1/products')[0]!.body as { variants: { price: unknown }[] }).variants[0]!.price,
    ).toEqual({ currency: 'USD', priceMinor: 1250 });
  });

  it('switches to a weighed unit, with a minimum in kilos', async () => {
    const { user, requestsTo } = openCard('/products/new', {
      'POST /v1/products': { status: 201, body: product() },
    });
    await user.type(await screen.findByLabelText('اسم المنتج'), 'جبنة عكاوي');
    await user.click(screen.getByRole('switch', { name: 'يُباع بالوزن' }));
    expect(screen.getByLabelText('الوحدة')).toHaveValue(ids.kilo);
    await user.type(screen.getByLabelText('سعر البيع'), '900');
    await user.type(screen.getByLabelText('الحد الأدنى في الفرع'), '2.5');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(requestsTo('POST', '/v1/products')).toHaveLength(1));
    const body = requestsTo('POST', '/v1/products')[0]!.body as {
      unitId: string;
      variants: { minStockQty: number }[];
    };
    expect(body.unitId).toBe(ids.kilo);
    expect(body.variants[0]!.minStockQty).toBe(2500);
  });

  it('builds the size × colour matrix and sends every combination', async () => {
    const { user, requestsTo } = openCard('/products/new', {
      'POST /v1/products': { status: 201, body: product() },
    });
    await user.type(await screen.findByLabelText('اسم المنتج'), 'قميص قطن');
    await user.type(screen.getByLabelText('سعر البيع'), '500');
    await user.click(screen.getByRole('switch', { name: 'له مقاسات أو ألوان' }));
    await user.type(screen.getByRole('textbox', { name: 'قيمة جديدة لـالمقاس' }), 'S، M{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'قيمة جديدة لـاللون' }), 'أحمر{Enter}');

    expect(screen.getByText('2 متغيّرات')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('group', { name: 'S · أحمر' })).toBeInTheDocument();
    const second = screen.getByRole('group', { name: 'M · أحمر' });
    // A new combination starts at the first variant's price.
    expect(within(second).getByLabelText('سعر البيع لـ«M · أحمر»')).toHaveValue('500');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(requestsTo('POST', '/v1/products')).toHaveLength(1));
    const body = requestsTo('POST', '/v1/products')[0]!.body as { variants: { attributes: unknown }[] };
    expect(body.variants.map((v) => v.attributes)).toEqual([
      [
        { name: 'المقاس', value: 'S' },
        { name: 'اللون', value: 'أحمر' },
      ],
      [
        { name: 'المقاس', value: 'M' },
        { name: 'اللون', value: 'أحمر' },
      ],
    ]);
  });
});

describe('an existing product', () => {
  it('shows its data, its stock per branch, and sends only what changed', async () => {
    const { user, requestsTo } = openCard(`/products/${ids.milk}`, {
      [`PATCH ${productPath}`]: (request) => ({
        status: 200,
        body: product({ nameAr: (request.body as { nameAr: string }).nameAr, version: 4 }),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'حليب المراعي 1 لتر', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('الماركة (اختياري)')).toHaveValue('المراعي');
    expect(screen.getByLabelText('سعر البيع')).toHaveValue('150');
    const stock = screen.getByRole('region', { name: 'في كل الفروع' });
    expect(stock).toHaveTextContent('الفرع الرئيسي');
    expect(stock).toHaveTextContent('94');

    await user.clear(screen.getByLabelText('اسم المنتج'));
    await user.type(screen.getByLabelText('اسم المنتج'), 'حليب كامل الدسم');
    await user.clear(screen.getByLabelText('سعر البيع'));
    await user.type(screen.getByLabelText('سعر البيع'), '160');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByText('حُفظ المنتج، ويصل إلى أجهزة الكاشير مع أول اتصال.')).toBeInTheDocument();
    expect(requestsTo('PATCH', productPath)[0]!.body).toEqual({
      version: 3,
      nameAr: 'حليب كامل الدسم',
      variants: [{ id: ids.milkVariant, price: { currency: 'SYP', priceMinor: 16000 } }],
    });
  });

  it('says when there is nothing to save', async () => {
    const { user, requestsTo } = openCard(`/products/${ids.milk}`);
    await screen.findByLabelText('اسم المنتج');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(screen.getByText('لا تغييرات لحفظها.')).toBeInTheDocument();
    expect(requestsTo('PATCH', productPath)).toHaveLength(0);
  });

  it('removes a barcode by sending the variant’s list without it', async () => {
    const { user, requestsTo } = openCard(`/products/${ids.milk}`, {
      [`PATCH ${productPath}`]: {
        status: 200,
        body: product({ variants: [variant({ barcodes: [] })], version: 4 }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'أزل الباركود 6281007035105' }));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(requestsTo('PATCH', productPath)).toHaveLength(1));
    expect(requestsTo('PATCH', productPath)[0]!.body).toEqual({
      version: 3,
      variants: [{ id: ids.milkVariant, barcodes: [] }],
    });
  });

  it('reloads after someone else saved first, and says what they changed', async () => {
    let reads = 0;
    const { user } = openCard(`/products/${ids.milk}`, {
      [`GET ${productPath}`]: () => ({
        status: 200,
        body:
          ++reads === 1
            ? product()
            : product({ version: 4, variants: [variant({ price: { currency: 'SYP', priceMinor: 17000 } })] }),
      }),
      [`PATCH ${productPath}`]: apiError(409, 'stale_version', 'تغيّر السجل.'),
    });
    await user.type(await screen.findByLabelText('الماركة (اختياري)'), ' الذهبي');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(
      await screen.findByText(
        'غيّر أحدٌ هذا المنتج قبل قليل (السعر). حمّلنا آخر نسخة: أعد تعديلك عليها ثم احفظ.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('سعر البيع')).toHaveValue('170');
    expect(screen.getByLabelText('الماركة (اختياري)')).toHaveValue('المراعي');
  });

  it('archives after asking, and restores', async () => {
    const archivedAt = '2026-10-31T08:00:00.000Z';
    const { user, requestsTo } = openCard(`/products/${ids.milk}`, {
      [`POST ${productPath}/archive`]: { status: 200, body: product({ archivedAt, version: 4 }) },
      [`POST ${productPath}/restore`]: { status: 200, body: product({ version: 5 }) },
    });

    await user.click(await screen.findByRole('button', { name: 'أرشف' }));
    const dialog = await screen.findByRole('dialog', { name: 'أرشف «حليب المراعي 1 لتر»؟' });
    expect(dialog).toHaveTextContent('يختفي من البيع على الكاشير، وتبقى فواتيره ومخزونه.');
    await user.click(within(dialog).getByRole('button', { name: 'أرشف المنتج' }));

    expect(await screen.findByText('أُرشف المنتج، ولم يعد يظهر على الكاشير.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('مؤرشف')).toBeInTheDocument();
    expect(requestsTo('POST', `${productPath}/archive`)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'أعد المنتج إلى البيع' }));
    expect(await screen.findByText('عاد المنتج إلى البيع.')).toBeInTheDocument();
    expect(screen.queryByText('مؤرشف')).not.toBeInTheDocument();
  });

  it('shows a product with sizes as one block per variant', async () => {
    openCard(`/products/${ids.milk}`, {
      [`GET ${productPath}`]: {
        status: 200,
        body: product({
          variants: [
            variant({ id: ids.white, attributes: [{ name: 'اللون', value: 'أبيض' }] }),
            variant({ id: ids.black, attributes: [{ name: 'اللون', value: 'أسود' }], barcodes: [] }),
          ],
        }),
      },
    });

    expect(await screen.findByRole('group', { name: 'أبيض' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'أسود' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'له مقاسات أو ألوان' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('list', { name: 'قيم اللون' })).toHaveTextContent('أبيضأسود');
  });

  it('is read-only for whoever cannot change the catalog', async () => {
    openCard(`/products/${ids.milk}`, {}, ['sale.create']);

    expect(await screen.findByLabelText('اسم المنتج')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'أرشف' })).not.toBeInTheDocument();
  });

  it('shows a load error with a retry', async () => {
    let fail = true;
    const { user } = openCard(`/products/${ids.milk}`, {
      [`GET ${productPath}`]: () =>
        fail ? apiError(404, 'not_found', 'هذا المنتج غير موجود.') : { status: 200, body: product() },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('هذا المنتج غير موجود.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByRole('heading', { name: 'حليب المراعي 1 لتر', level: 1 })).toBeInTheDocument();
    expect(shownText(document.body)).not.toContain('غير موجود');
  });
});
