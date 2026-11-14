import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quotation, QuotationListItem } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { ids, catalogMe, lookupRoutes, product, taxRates } from '../../test/catalog';
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
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'اطبع A4' }));
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
