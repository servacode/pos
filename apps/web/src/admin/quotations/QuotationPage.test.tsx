import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quotation, QuotationListItem } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { ids, catalogMe, lookupRoutes, product, taxRates, variant } from '../../test/catalog';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { resetDeviceStore } from '../../offline/database';
import { productsPath } from '../catalog/api';
import { QUOTATION_TONES } from './QuotationsPage';

const me = () => catalogMe(['customers.manage', 'catalog.manage']);

const item = (over: Partial<QuotationListItem> = {}): QuotationListItem => ({
  id: 'q-1',
  number: 'QUO-2026-000001',
  status: 'sent',
  customerName: 'مشفى الأمل',
  issueDate: '2026-11-01',
  validUntil: '2026-11-16',
  currency: 'SYP',
  totalMinor: 2_000_000,
  version: 1,
  ...over,
});

const quotation = (over: Partial<Quotation> = {}): Quotation => ({
  ...item(),
  customerId: null,
  customerPhone: '0944111222',
  customerTaxNumber: '777888',
  customerAddress: 'دمشق، المزة',
  taxInclusive: true,
  notes: 'التوصيل مجاني',
  terms: 'الدفع خلال 30 يوماً',
  lines: [
    {
      lineNo: 1,
      productId: null,
      variantId: null,
      name: 'قفازات طبية',
      unitName: null,
      packName: null,
      packQty: 1000,
      qty: 2000,
      unitPriceMinor: 1_000_000,
      discount: null,
      taxRateId: null,
      taxRateBp: 0,
      priced: {
        grossMinor: 2_000_000,
        lineDiscountMinor: 0,
        netMinor: 2_000_000,
        taxMinor: 0,
        netExTaxMinor: 2_000_000,
        totalMinor: 2_000_000,
      },
    },
  ],
  invoiceDiscount: null,
  totals: {
    grossMinor: 2_000_000,
    lineDiscountMinor: 0,
    invoiceDiscountMinor: 0,
    discountMinor: 0,
    netExTaxMinor: 2_000_000,
    taxMinor: 0,
    totalMinor: 2_000_000,
  },
  convertedAt: null,
  createdByName: 'أحمد الخطيب',
  branchName: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

const store = {
  name: 'المركز الطبي',
  taxNumber: '123456',
  address: 'دمشق',
  phone: '+963112345678',
  receiptFooter: null,
};

const base = {
  'POST /v1/auth/refresh': signedInRefresh,
  'GET /v1/me': () => ({ status: 200, body: me() }),
  ...lookupRoutes,
  'GET /v1/store': { status: 200, body: store },
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDeviceStore();
});

describe('«عروض الأسعار»', () => {
  it('lists the offers with their number, customer, status and total, and filters by status', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations?status=all': {
        status: 200,
        body: { items: [item(), item({ id: 'q-2', number: 'QUO-2026-000002', status: 'expired' })] },
      },
      'GET /v1/quotations?status=open': { status: 200, body: { items: [item()] } },
    });
    const { user } = renderApp('/quotations');
    const table = await screen.findByRole('table', { name: 'عروض الأسعار' });
    expect(await within(table).findByText('QUO-2026-000001')).toBeInTheDocument();
    expect(within(table).getByText('QUO-2026-000002')).toBeInTheDocument();
    expect(within(table).getAllByText('منتهي').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('مشفى الأمل').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('radio', { name: 'بانتظار الرد' }));
    await waitFor(() => expect(screen.queryByText('QUO-2026-000002')).not.toBeInTheDocument());
    expect(requestsTo('GET', '/v1/quotations?status=open')).toHaveLength(1);
    expect(QUOTATION_TONES.converted).toBe('brand');
  });

  it('is hidden from a user without customers.manage', async () => {
    mockFetch({
      ...base,
      'GET /v1/me': () => ({ status: 200, body: catalogMe(['sale.create']) }),
    });
    renderApp('/quotations');
    expect(
      await screen.findByText(
        (text) => text === 'هذه الشاشة ليست ضمن صلاحياتك.' || text === 'ليس لديك صلاحية لهذه الصفحة',
      ),
    ).toBeInTheDocument();
  });

  it('writes a new offer: finds an item at its price and tax, saves it, and the server numbers it', async () => {
    const milk = product({ taxRateId: ids.tax });
    const saved = quotation({ id: 'q-9', number: 'QUO-2026-000009', status: 'draft' });
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-9': { status: 200, body: saved },
      [`GET ${productsPath({ q: 'حليب' })}`]: {
        status: 200,
        body: {
          items: [
            {
              id: ids.milk,
              nameAr: milk.nameAr,
              nameEn: null,
              categoryId: null,
              categoryName: null,
              season: null,
              type: 'stock',
              status: 'active',
              archivedAt: null,
              variantCount: 1,
              singleVariantId: ids.milkVariant,
              price: null,
              barcode: null,
              stockQty: 0,
              version: 1,
            },
          ],
          nextCursor: null,
        },
      },
      [`GET /v1/products/${ids.milk}`]: { status: 200, body: milk },
      'POST /v1/quotations': (r: MockRequest) => {
        void r;
        return { status: 201, body: saved };
      },
    });
    const { user } = renderApp('/quotations/new');
    await user.click(await screen.findByRole('button', { name: /زبون غير مسجّل/ }));
    await user.type(await screen.findByLabelText('اسم الزبون أو الجهة'), 'مشفى الأمل');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: milk.nameAr }));

    const lines = await screen.findByRole('list', { name: 'أصناف العرض' });
    expect(within(lines).getByText(milk.nameAr)).toBeInTheDocument();
    expect(within(lines).getByText(`ضريبة ${taxRates[0]!.rateBp / 100}%`)).toBeInTheDocument();
    // The shelf price (15000 minor) is the line's price, in pounds
    expect(within(lines).getByLabelText(`سعر ${milk.nameAr}`)).toHaveValue('150');
    await user.clear(within(lines).getByLabelText(`كمية ${milk.nameAr}`));
    await user.type(within(lines).getByLabelText(`كمية ${milk.nameAr}`), '4');
    await user.type(within(lines).getByLabelText(`خصم ${milk.nameAr} بالمئة`), '10');

    await user.click(screen.getByRole('button', { name: 'احفظ العرض' }));
    const body = requestsTo('POST', '/v1/quotations')[0]!.body as {
      customerName: string;
      lines: Record<string, unknown>[];
    };
    expect(body.customerName).toBe('مشفى الأمل');
    expect(body.lines[0]).toMatchObject({
      variantId: ids.milkVariant,
      qty: 4000,
      unitPriceMinor: 15_000,
      discount: { type: 'percent', bp: 1000 },
      taxRateId: ids.tax,
      taxRateBp: 500,
    });
    // After saving it opens under its number
    expect(await screen.findByText('عرض السعر QUO-2026-000009')).toBeInTheDocument();
  });

  it('asks for a line before saving, and names a wrong quantity', async () => {
    mockFetch(base);
    const { user } = renderApp('/quotations/new');
    await user.click(await screen.findByRole('button', { name: 'احفظ العرض' }));
    expect(await screen.findByText('أضف صنفاً واحداً على الأقل.')).toBeInTheDocument();
  });

  it('moves an offer on, prints it on A4 with the store, customer, terms and signatures, and offers the till', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: quotation() },
      'POST /v1/quotations/q-1/status': (r: MockRequest) => ({
        status: 200,
        body: quotation({
          status: (r.body as { status: Quotation['status'] }).status,
          version: 2,
        }),
      }),
    });
    const { user } = renderApp('/quotations/q-1');
    expect(await screen.findByText('عرض السعر QUO-2026-000001')).toBeInTheDocument();
    expect(screen.getByLabelText('اسم الزبون أو الجهة')).toHaveValue('مشفى الأمل');
    expect(screen.getByLabelText('الرقم الضريبي للزبون')).toHaveValue('777888');

    await user.click(screen.getByRole('button', { name: 'وافق الزبون' }));
    await waitFor(() =>
      expect(requestsTo('POST', '/v1/quotations/q-1/status')[0]!.body).toEqual({
        status: 'accepted',
        version: 1,
      }),
    );
    expect(await screen.findByText('مقبول')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حوّل إلى فاتورة' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PDF / اطبع A4' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const sheet = document.querySelector('[data-print-sheet="A4"]')!;
    const text = sheet.textContent ?? '';
    for (const part of [
      'عرض سعر',
      'QUO-2026-000001',
      'المركز الطبي',
      'الرقم الضريبي',
      '123456',
      'مشفى الأمل',
      '777888',
      'دمشق، المزة',
      'قفازات طبية',
      'التوصيل مجاني',
      'الدفع خلال 30 يوماً',
      'موافقة الزبون',
      'مكان الختم',
    ]) {
      expect(text).toContain(part);
    }
    // Every word on the screen passes the glossary
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('a converted offer cannot be edited, and can be reopened', async () => {
    mockFetch({
      ...base,
      'GET /v1/quotations/q-1': {
        status: 200,
        body: quotation({ status: 'converted', convertedAt: '2026-11-02T08:00:00.000Z' }),
      },
    });
    renderApp('/quotations/q-1');
    expect(await screen.findByText(/حُوّل هذا العرض إلى فاتورة/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'احفظ التعديلات' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أعده مرسلاً' })).toBeInTheDocument();
  });

  it('keeps the unit of a saved line, and tells a browser with no till how to turn the offer into an invoice', async () => {
    const packed = quotation({
      status: 'accepted',
      lines: [
        {
          ...quotation().lines[0]!,
          name: 'كمامات',
          packName: 'علبة 100',
          packQty: 100_000,
          qty: 5000,
          unitPriceMinor: 2_400_000,
        },
      ],
    });
    mockFetch({ ...base, 'GET /v1/quotations/q-1': { status: 200, body: packed } });
    const { user } = renderApp('/quotations/q-1');
    const unit = await screen.findByLabelText('وحدة كمامات');
    expect(unit).toHaveValue('100000');
    expect(within(unit).getByRole('option', { name: 'علبة 100' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'حوّل إلى فاتورة' }));
    expect(await screen.findByText('هذا المتصفح غير مربوط بكاشير')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'اربط هذا المتصفح بالكاشير' })).toHaveAttribute(
      'href',
      '/pos?quotation=q-1',
    );
    expect(window.location.pathname).not.toBe('/pos');
  });
});

const listItem = (n: number, over: Partial<QuotationListItem> = {}) =>
  item({ id: `q-${n}`, number: `QUO-2026-${String(n).padStart(6, '0')}`, ...over });

const futureQuotation = (over: Partial<Quotation> = {}) => quotation({ validUntil: '2030-01-01', ...over });

describe('«عروض الأسعار»: the list in pages', () => {
  it('pages with the cursor the server gives, and the pager names the rows', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations?status=all': {
        status: 200,
        body: { items: [listItem(3), listItem(2)], nextCursor: 'cur-1' },
      },
      'GET /v1/quotations?status=all&cursor=cur-1': {
        status: 200,
        body: { items: [listItem(1)], nextCursor: null },
      },
    });
    const { user } = renderApp('/quotations');
    expect(await screen.findByText('QUO-2026-000003')).toBeInTheDocument();
    expect(screen.getByText('QUO-2026-000002')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'الصفحة التالية' });
    await user.click(next);
    expect(await screen.findByText('QUO-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText('QUO-2026-000003')).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/quotations?status=all&cursor=cur-1')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'الصفحة السابقة' }));
    expect(await screen.findByText('QUO-2026-000003')).toBeInTheDocument();
  });

  it('keeps the rows of the filter chosen last when an answer for an earlier one comes late', async () => {
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch({
      ...base,
      'GET /v1/quotations?status=all': { status: 200, body: { items: [listItem(1)], nextCursor: null } },
      'GET /v1/quotations?status=accepted': async () => {
        await late;
        return { status: 200, body: { items: [listItem(7, { status: 'accepted' })], nextCursor: null } };
      },
      'GET /v1/quotations?status=expired': {
        status: 200,
        body: { items: [listItem(8, { status: 'expired' })], nextCursor: null },
      },
    });
    const { user } = renderApp('/quotations');
    await screen.findByText('QUO-2026-000001');
    await user.click(screen.getByRole('radio', { name: 'مقبولة' }));
    await user.click(screen.getByRole('radio', { name: 'منتهية' }));
    expect(await screen.findByText('QUO-2026-000008')).toBeInTheDocument();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('QUO-2026-000008')).toBeInTheDocument();
    expect(screen.queryByText('QUO-2026-000007')).not.toBeInTheDocument();
  });

  it('says a filter matched nothing, apart from having no offers at all', async () => {
    mockFetch({
      ...base,
      'GET /v1/quotations?status=all': { status: 200, body: { items: [], nextCursor: null } },
      'GET /v1/quotations?status=accepted': { status: 200, body: { items: [], nextCursor: null } },
    });
    const { user } = renderApp('/quotations');
    expect(await screen.findByText('لا عروض أسعار هنا')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'مقبولة' }));
    expect(await screen.findByText('لا عروض تطابق هذه التصفية')).toBeInTheDocument();
  });
});

describe('«عروض الأسعار»: the editor keeps what it holds', () => {
  const discounted = (over: Partial<Quotation> = {}) =>
    futureQuotation({
      invoiceDiscount: { type: 'amount', minor: 100_000 },
      totals: {
        grossMinor: 2_000_000,
        lineDiscountMinor: 0,
        invoiceDiscountMinor: 100_000,
        discountMinor: 100_000,
        netExTaxMinor: 1_900_000,
        taxMinor: 0,
        totalMinor: 1_900_000,
      },
      totalMinor: 1_900_000,
      ...over,
    });

  it('sends the invoice discount the till saved when a note is changed, and shows it in the total', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: discounted() },
      'PUT /v1/quotations/q-1': (r: MockRequest) => ({
        status: 200,
        body: discounted({ version: 2, notes: (r.body as { notes: string }).notes }),
      }),
    });
    const { user } = renderApp('/quotations/q-1');
    expect(await screen.findByText('خصم الفاتورة')).toBeInTheDocument();
    const total = screen.getByText('الإجمالي').closest('div')!;
    expect(total.textContent).toContain('19,000');
    await user.type(screen.getByLabelText('ملاحظات'), ' جديد');
    await user.click(screen.getByRole('button', { name: 'احفظ التعديلات' }));
    await waitFor(() => expect(requestsTo('PUT', '/v1/quotations/q-1')).toHaveLength(1));
    expect(requestsTo('PUT', '/v1/quotations/q-1')[0]!.body).toMatchObject({
      invoiceDiscount: { type: 'amount', minor: 100_000 },
      version: 1,
    });
  });

  it('lets the discount be dropped on purpose, and then sends none', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: discounted() },
      'PUT /v1/quotations/q-1': { status: 200, body: futureQuotation({ version: 2 }) },
    });
    const { user } = renderApp('/quotations/q-1');
    await user.click(await screen.findByRole('button', { name: 'ألغِه' }));
    expect(screen.queryByText('خصم الفاتورة')).not.toBeInTheDocument();
    expect(screen.getByText('الإجمالي').closest('div')!.textContent).toContain('20,000');
    await user.click(screen.getByRole('button', { name: 'احفظ التعديلات' }));
    await waitFor(() => expect(requestsTo('PUT', '/v1/quotations/q-1')).toHaveLength(1));
    expect(requestsTo('PUT', '/v1/quotations/q-1')[0]!.body).toMatchObject({ invoiceDiscount: null });
  });

  it('saves what was typed before it moves the status, so the move wipes nothing', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: futureQuotation() },
      'PUT /v1/quotations/q-1': (r: MockRequest) => ({
        status: 200,
        body: futureQuotation({ version: 2, notes: (r.body as { notes: string }).notes }),
      }),
      'POST /v1/quotations/q-1/status': (r: MockRequest) => ({
        status: 200,
        body: futureQuotation({
          version: 3,
          notes: 'التوصيل مجاني جداً',
          status: (r.body as { status: Quotation['status'] }).status,
        }),
      }),
    });
    const { user } = renderApp('/quotations/q-1');
    await user.type(await screen.findByLabelText('ملاحظات'), ' جداً');
    expect(screen.getByText('فيه تعديلات غير محفوظة: تُحفظ عند تغيير الحالة.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'وافق الزبون' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/quotations/q-1/status')).toHaveLength(1));
    expect(requestsTo('PUT', '/v1/quotations/q-1')[0]!.body).toMatchObject({
      notes: 'التوصيل مجاني جداً',
      version: 1,
    });
    // The move is made on the version the save gave
    expect(requestsTo('POST', '/v1/quotations/q-1/status')[0]!.body).toEqual({
      status: 'accepted',
      version: 2,
    });
    expect(await screen.findByLabelText('ملاحظات')).toHaveValue('التوصيل مجاني جداً');
    expect(screen.queryByText('فيه تعديلات غير محفوظة: تُحفظ عند تغيير الحالة.')).not.toBeInTheDocument();
  });

  it('does not move the status when the save it needs is refused, and keeps what was typed', async () => {
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: quotation() },
    });
    const { user } = renderApp('/quotations/q-1');
    await user.type(await screen.findByLabelText('ملاحظات'), ' جداً');
    await user.click(screen.getByRole('button', { name: 'وافق الزبون' }));
    // Its date (16/11/2026) is already behind: shown on the field, and nothing is sent
    expect(await screen.findByText(/آخر يوم للعرض قبل اليوم/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/quotations/q-1')).toHaveLength(0);
    expect(requestsTo('POST', '/v1/quotations/q-1/status')).toHaveLength(0);
    expect(screen.getByLabelText('ملاحظات')).toHaveValue('التوصيل مجاني جداً');
  });

  it('puts the server’s message about the date on the date field', async () => {
    mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: futureQuotation() },
      'PUT /v1/quotations/q-1': () =>
        apiError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          validUntil: 'آخر يوم للعرض قبل اليوم',
        }),
    });
    const { user } = renderApp('/quotations/q-1');
    await user.type(await screen.findByLabelText('ملاحظات'), ' x');
    await user.click(screen.getByRole('button', { name: 'احفظ التعديلات' }));
    const field = await screen.findByLabelText('صالح حتى');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('آخر يوم للعرض قبل اليوم')).toBeInTheDocument();
  });
});

describe('«عروض الأسعار»: the words of an ended offer', () => {
  it('says it was ended by hand, with no date claim, while its day has not come', async () => {
    mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: futureQuotation({ status: 'expired' }) },
    });
    renderApp('/quotations/q-1');
    const note = await screen.findByText(/أُنهي هذا العرض قبل موعده/);
    expect(note.textContent).toContain('1 كانون الثاني 2030');
    expect(note.textContent).not.toContain('2030-01-01');
    expect(screen.queryByText(/انتهت صلاحية هذا العرض/)).not.toBeInTheDocument();
  });

  it('says it lapsed, in the app’s date format, once its day has passed', async () => {
    mockFetch({ ...base, 'GET /v1/quotations/q-1': { status: 200, body: quotation({ status: 'expired' }) } });
    renderApp('/quotations/q-1');
    const note = await screen.findByText(/انتهت صلاحية هذا العرض/);
    expect(note.textContent).toContain('16 تشرين الثاني 2026');
    expect(note.textContent).not.toContain('2026-11-16');
  });
});

describe('«عروض الأسعار»: sending it to the customer', () => {
  it('opens WhatsApp on the customer’s number with the offer written out', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    mockFetch({ ...base, 'GET /v1/quotations/q-1': { status: 200, body: futureQuotation() } });
    const { user } = renderApp('/quotations/q-1');
    await user.click(await screen.findByRole('button', { name: 'أرسل واتساب' }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith('https://wa.me/963944111222?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    for (const part of [
      'QUO-2026-000001',
      'المركز الطبي',
      'مشفى الأمل',
      'قفازات طبية',
      'الإجمالي: 20,000 ل.س',
    ]) {
      expect(text).toContain(part);
    }
    expect(screen.queryByText(/لا رقم للزبون/)).not.toBeInTheDocument();
  });

  it('opens WhatsApp with no chat chosen when the customer has no phone, and says so', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    mockFetch({
      ...base,
      'GET /v1/quotations/q-1': { status: 200, body: futureQuotation({ customerPhone: null }) },
    });
    const { user } = renderApp('/quotations/q-1');
    await user.click(await screen.findByRole('button', { name: 'أرسل واتساب' }));
    expect(String(open.mock.calls[0]![0]).startsWith('https://wa.me/?text=')).toBe(true);
    expect(screen.getByText(/لا رقم للزبون/)).toBeInTheDocument();
  });

  it('names the print button for PDF too, and the subtitle says the invoice is made at the till', async () => {
    mockFetch({ ...base, 'GET /v1/quotations/q-1': { status: 200, body: futureQuotation() } });
    renderApp('/quotations/q-1');
    expect(await screen.findByRole('button', { name: 'PDF / اطبع A4' })).toBeInTheDocument();
    expect(screen.getByText(/يفتحه في شاشة الكاشير ليُباع من هناك/)).toBeInTheDocument();
  });
});

describe('«عروض الأسعار»: the new offer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stands 15 days from the store’s day, not the browser’s', async () => {
    // 03:00 UTC on 21/11 is still the 20th in Los Angeles; the browser of this test is in Damascus
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-21T03:00:00Z') });
    const owner = catalogMe(['customers.manage']);
    mockFetch({
      ...base,
      'GET /v1/me': () => ({
        status: 200,
        body: { ...owner, tenant: { ...owner.tenant, timezone: 'America/Los_Angeles' } },
      }),
    });
    renderApp('/quotations/new');
    expect(await screen.findByLabelText('صالح حتى')).toHaveValue('05/12/2026');
  });

  it('shows a past date on its field before anything is sent', async () => {
    const { requestsTo } = mockFetch(base);
    const { user } = renderApp('/quotations/new');
    const date = await screen.findByLabelText('صالح حتى');
    await user.clear(date);
    await user.type(date, '01/11/2026');
    await user.click(screen.getByRole('button', { name: 'احفظ العرض' }));
    expect(await screen.findByText(/آخر يوم للعرض قبل اليوم/)).toBeInTheDocument();
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(requestsTo('POST', '/v1/quotations')).toHaveLength(0);
  });
});

describe('«عروض الأسعار»: the item picker', () => {
  it('groups the variants of a product by size with their colours and prices with thousands separators', async () => {
    const jeans = product({
      id: ids.milk,
      nameAr: 'بنطال جينز رجالي',
      variants: [
        variant({
          id: 'v-1',
          label: '30 · أزرق',
          price: { currency: 'SYP', priceMinor: 350_000 },
          barcodes: [],
        }),
        variant({
          id: 'v-2',
          label: '30 · أسود',
          price: { currency: 'SYP', priceMinor: 350_000 },
          barcodes: [],
        }),
        variant({
          id: 'v-3',
          label: '32 · أزرق',
          price: { currency: 'SYP', priceMinor: 350_000 },
          barcodes: [],
        }),
      ],
    });
    mockFetch({
      ...base,
      [`GET ${productsPath({ q: 'جينز' })}`]: {
        status: 200,
        body: {
          items: [
            {
              id: ids.milk,
              nameAr: jeans.nameAr,
              nameEn: null,
              categoryId: null,
              categoryName: null,
              season: null,
              type: 'stock',
              status: 'active',
              archivedAt: null,
              variantCount: 3,
              singleVariantId: null,
              price: { currency: 'SYP', minMinor: 350_000, maxMinor: 350_000 },
              barcode: null,
              stockQty: 0,
              version: 1,
            },
          ],
          nextCursor: null,
        },
      },
      [`GET /v1/products/${ids.milk}`]: { status: 200, body: jeans },
    });
    const { user } = renderApp('/quotations/new');
    await user.type(await screen.findByLabelText('أضف صنفاً بالاسم أو الباركود'), 'جينز');
    const row = await screen.findByRole('button', { name: /بنطال جينز رجالي/ });
    expect(row.textContent).toContain('3,500');
    await user.click(row);
    const group = await screen.findByRole('group', { name: 'اختر النوع' });
    expect(within(group).getByText('30')).toBeInTheDocument();
    expect(within(group).getByText('32')).toBeInTheDocument();
    expect(within(group).getAllByText('أزرق')).toHaveLength(2);
    expect(within(group).getAllByText(/3,500/)).toHaveLength(3);
    await user.click(within(group).getByRole('button', { name: 'بنطال جينز رجالي 30 · أسود' }));
    const lines = await screen.findByRole('list', { name: 'أصناف العرض' });
    expect(within(lines).getByText('بنطال جينز رجالي 30 · أسود')).toBeInTheDocument();
  });
});
