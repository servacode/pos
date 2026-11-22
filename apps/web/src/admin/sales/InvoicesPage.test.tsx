import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { stripBidiControls, type SaleDetail, type SaleListItem } from '@serva/core';
import { buildSalePayload } from '@serva/core/sale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { meWith, NOW, OWNER_KEYS } from '../../test/reports';
import type { AccessKey } from '../reports/access';
import '../customers/CustomerPage';
import './InvoicesPage';
import { salesCsv } from './csv';
import { toMinor } from './InvoicesPage';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

const LIST = '/v1/sales?from=2026-10-01&to=2026-10-31&limit=50';

function item(overrides: Partial<SaleListItem> = {}): SaleListItem {
  return {
    id: 'sale-1',
    number: 'INV-001-002-0000419',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    deviceId: 'dev-1',
    deviceCode: '002',
    businessDate: '2026-10-30',
    deviceTime: '2026-10-30T09:15:00.000Z',
    cashier: { id: 'u-1', fullName: 'سامر' },
    customer: { id: 'c-1', name: 'ريم' },
    currency: 'SYP',
    totalMinor: 120_000,
    discountMinor: 0,
    taxMinor: 0,
    methods: ['cash'],
    returnedMinor: 0,
    status: 'paid',
    ...overrides,
  };
}

const payload = buildSalePayload({
  currency: 'SYP',
  taxInclusive: true,
  exchangeRates: [],
  shiftId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03',
  cashierId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04',
  cashSteps: {},
  lines: [
    {
      lineNo: 1,
      productId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
      variantId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02',
      name: 'قميص أبيض',
      qty: 1000,
      priceCurrency: 'SYP',
      priceMinor: 120_000,
      taxRateBp: 0,
    },
  ],
  payments: [{ method: 'cash', currency: 'SYP', amountMinor: 120_000 }],
});

function detail(overrides: Partial<SaleDetail> = {}): SaleDetail {
  return {
    ...item(),
    payload,
    salesperson: null,
    device: { id: 'dev-1', name: 'كاشير 2', code: '002' },
    flags: [],
    returns: [],
    receipt: {
      storeName: 'متجر الأمل',
      taxNumber: '123456',
      receiptFooter: 'البضاعة المباعة لا تُسترد',
      branchName: 'الفرع الرئيسي',
      branchAddress: 'دمشق',
      branchPhone: '0111234567',
      deviceName: 'كاشير 2',
      cashierName: 'سامر',
    },
    ...overrides,
  };
}

function signIn(
  keys: readonly AccessKey[],
  routes: Record<string, MockReply | (() => MockReply | Promise<MockReply>)>,
  path = '/sales/invoices',
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys) },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

const page = (items: SaleListItem[], nextCursor: string | null = null): MockReply => ({
  status: 200,
  body: { items, nextCursor },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('«الفواتير»', () => {
  it('lists the store’s invoices with their day, customer, payment, status and total', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([
        item(),
        item({
          id: 'sale-2',
          number: 'INV-001-002-0000420',
          customer: null,
          status: 'partly_returned',
          methods: ['card', 'cash'],
          totalMinor: 50_000,
        }),
      ]),
    });
    // The first test of the file also loads the page's chunk: give it time on a busy machine
    const table = await screen.findByRole('table', { name: 'فواتير المتجر' }, { timeout: 15_000 });
    await within(table).findByText('INV-001-002-0000419');
    const rows = within(table).getAllByRole('row').map(text);
    expect(rows[0]).toBe('الفاتورةالوقتالزبونالدفعالحالةالإجمالي');
    // The list is read by its days: one header per day, with the weekday and how many invoices
    expect(rows[1]).toContain('30/10/2026');
    expect(rows[1]).toContain('فاتورتان');
    expect(rows[2]).toContain('INV-001-002-0000419');
    expect(rows[2]).toContain('ريم');
    expect(rows[2]).toContain('مكتملة');
    expect(rows[2]).toContain('1,200 ل.س');
    expect(rows[3]).toContain('بطاقة + نقداً');
    expect(rows[3]).toContain('مرتجع جزئي');
  });

  it('sends the filters it was given and shows an empty state when nothing matches', async () => {
    const { fetchMock } = signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      'GET /v1/sales?from=2026-10-01&to=2026-10-31&method=card&limit=50': page([]),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.change(screen.getByLabelText('طريقة الدفع'), { target: { value: 'card' } });
    expect(await screen.findByText('لا فواتير بهذه الشروط.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('method=card'), expect.anything());
  });

  it('searches by number after the typing pauses', async () => {
    const q = encodeURIComponent('0419');
    const { requests } = signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item(), item({ id: 'sale-2', number: 'INV-001-002-0000420' })]),
      [`GET /v1/sales?from=2026-10-01&to=2026-10-31&q=${q}&limit=50`]: page([item()]),
    });
    await screen.findByText('INV-001-002-0000420');
    fireEvent.change(screen.getByRole('searchbox', { name: /ابحث/ }), { target: { value: '0419' } });
    // The list may clear while it reloads: wait until the search itself was asked and answered
    await waitFor(() => {
      expect(requests.some((r) => r.path.includes(`q=${q}`))).toBe(true);
      expect(screen.getByText('INV-001-002-0000419')).toBeInTheDocument();
      expect(screen.queryByText('INV-001-002-0000420')).not.toBeInTheDocument();
    });
  });

  const NEXT = LIST.replace('limit=50', 'cursor=next-1&limit=50');
  const label = () => screen.getByRole('navigation', { name: 'الصفحات' }).querySelector('[aria-current]');

  it('pages with the cursor: next and back show one page at a time, with the label and range', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item(), item({ id: 'sale-3', number: 'INV-001-002-0000417' })], 'next-1'),
      [`GET ${NEXT}`]: page([item({ id: 'sale-2', number: 'INV-001-002-0000418' })]),
    });
    await screen.findByText('INV-001-002-0000419');
    expect(label()).toHaveTextContent('صفحة 1 · الفواتير من 1 إلى 2');
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(await screen.findByText('INV-001-002-0000418')).toBeInTheDocument();
    expect(screen.queryByText('INV-001-002-0000419')).not.toBeInTheDocument();
    expect(label()).toHaveTextContent('صفحة 2 · الفواتير من 3 إلى 3');
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'الصفحة السابقة' }));
    expect(await screen.findByText('INV-001-002-0000419')).toBeInTheDocument();
    expect(screen.queryByText('INV-001-002-0000418')).not.toBeInTheDocument();
    expect(label()).toHaveTextContent('صفحة 1 · الفواتير من 1 إلى 2');
  });

  it('shows no page controls when everything fits one page', async () => {
    signIn(OWNER_KEYS, { [`GET ${LIST}`]: page([item()]) });
    await screen.findByText('INV-001-002-0000419');
    expect(screen.queryByRole('navigation', { name: 'الصفحات' })).not.toBeInTheDocument();
  });

  it('a failed next page shows the error with a retry and stays on the current page', async () => {
    let calls = 0;
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()], 'next-1'),
      [`GET ${NEXT}`]: () => {
        calls += 1;
        return calls === 1
          ? apiError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.')
          : page([item({ id: 'sale-2', number: 'INV-001-002-0000418' })]);
      },
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(await screen.findByText('الخادم مشغول حالياً. حاول بعد قليل.')).toBeInTheDocument();
    expect(screen.getByText('INV-001-002-0000419')).toBeInTheDocument();
    expect(label()).toHaveTextContent('صفحة 1');

    fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('INV-001-002-0000418')).toBeInTheDocument();
    expect(label()).toHaveTextContent('صفحة 2');
    expect(screen.queryByText('الخادم مشغول حالياً. حاول بعد قليل.')).not.toBeInTheDocument();
  });

  it('a changed filter goes back to page 1', async () => {
    const q = encodeURIComponent('0419');
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()], 'next-1'),
      [`GET ${NEXT}`]: page([item({ id: 'sale-2', number: 'INV-001-002-0000418' })], 'next-2'),
      [`GET /v1/sales?from=2026-10-01&to=2026-10-31&q=${q}&limit=50`]: page([item()], 'next-1'),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    await screen.findByText('INV-001-002-0000418');
    expect(label()).toHaveTextContent('صفحة 2');

    fireEvent.change(screen.getByRole('searchbox', { name: /ابحث/ }), { target: { value: '0419' } });
    await waitFor(() => {
      expect(screen.getByText('INV-001-002-0000419')).toBeInTheDocument();
      expect(label()).toHaveTextContent('صفحة 1 · الفواتير من 1 إلى 1');
    });
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeDisabled();
  });

  it('shows an error with a retry', async () => {
    let calls = 0;
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: () => {
        calls += 1;
        return calls === 1 ? apiError(500, 'internal', 'تعذّر التحميل. حاول مرة أخرى.') : page([item()]);
      },
    });
    expect(await screen.findByText('تعذّر التحميل. حاول مرة أخرى.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(await screen.findByText('INV-001-002-0000419')).toBeInTheDocument();
  });

  it('opens an invoice as it was printed, marked «نسخة», and prints it on 80 mm and A4', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      'GET /v1/sales/sale-1': {
        status: 200,
        body: detail({
          status: 'partly_returned',
          returns: [
            {
              id: 'ret-1',
              number: 'SRT-001-002-0000003',
              businessDate: '2026-10-31',
              deviceTime: '2026-10-31T08:00:00.000Z',
              totalMinor: 30_000,
              reason: 'مقاس خاطئ',
              refundMethod: 'cash',
            },
          ],
        }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /INV-001-002-0000419/ }));
    const sheet = await screen.findByRole('dialog');
    const slip = await within(sheet).findByLabelText('إيصال 80 مم');
    expect(text(slip)).toContain('نسخة');
    expect(text(slip)).toContain('متجر الأمل');
    expect(text(slip)).toContain('قميص أبيض');
    expect(text(slip)).toContain('البضاعة المباعة لا تُسترد');
    expect(text(sheet)).toContain('SRT-001-002-0000003');
    expect(text(sheet)).toContain('مقاس خاطئ');

    fireEvent.click(within(sheet).getByRole('button', { name: 'اطبع الفاتورة' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const small = document.querySelector('[data-print-sheet="80mm"]');
    expect(small).not.toBeNull();
    expect(text(small!)).toContain('نسخة');
    expect(text(small!)).toContain('INV-001-002-0000419');

    fireEvent.click(within(sheet).getByRole('button', { name: 'اطبعها على A4' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    const a4 = document.querySelector('[data-print-sheet="A4"]');
    expect(a4).not.toBeNull();
    expect(document.querySelector('[data-print-sheet="80mm"]')).toBeNull();
    // The store has a tax number: a tax invoice, with the customer's block, payment terms and signature lines
    expect(text(a4!)).toContain('فاتورة ضريبية');
    expect(text(a4!)).toContain('نسخة');
    expect(text(a4!)).toContain('قميص أبيض');
    expect(text(a4!)).toContain('الرقم الضريبي');
    expect(text(a4!)).toContain('شروط الدفع');
    expect(text(a4!)).toContain('سلّمها');
    expect(text(a4!)).toContain('استلمها');
    expect(text(a4!)).toContain('مكان الختم');

    // The delivery note: the same lines without prices, then with them
    fireEvent.click(within(sheet).getByRole('button', { name: 'إشعار تسليم' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(3));
    const note = document.querySelector('[data-print-sheet="A4"]');
    expect(text(note!)).toContain('إشعار تسليم');
    expect(text(note!)).toContain('قميص أبيض');
    expect(text(note!)).toContain('الأرقام التسلسلية');
    expect(text(note!)).not.toContain('المجموع');
    fireEvent.click(within(sheet).getByRole('button', { name: 'إشعار تسليم بالأسعار' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(4));
    expect(text(document.querySelector('[data-print-sheet="A4"]')!)).toContain('المجموع');
  });

  it('filters one customer’s invoices when opened from the customer page', async () => {
    signIn(
      OWNER_KEYS,
      {
        '*': { status: 200 },
        'GET /v1/sales?from=2020-01-01&to=2026-10-31&customerId=c-1&limit=50': page([item()]),
      } as never,
      '/sales/invoices?customerId=c-1',
    );
    expect(await screen.findByText('INV-001-002-0000419')).toBeInTheDocument();
    expect(screen.getByText(/فواتير زبون واحد/)).toBeInTheDocument();
  });

  it('is closed to someone without report.view and hidden from their menu', async () => {
    signIn(['sale.create'], {}, '/sales/invoices');
    expect(
      await screen.findByText(
        (text) => text === 'هذه الشاشة ليست ضمن صلاحياتك.' || text === 'ليس لديك صلاحية لهذه الصفحة',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'الفواتير' })).not.toBeInTheDocument();
  });
});

describe('the invoice CSV', () => {
  it('keeps the BOM, quotes text, writes plain decimals and guards formulas', () => {
    const csv = salesCsv([
      item({
        customer: { id: null, name: '=1+1' },
        methods: ['card', 'cash'],
        totalMinor: 125_050,
        returnedMinor: 25_000,
        status: 'partly_returned',
      }),
    ]);
    expect(csv.startsWith('﻿"رقم الفاتورة"')).toBe(true);
    const [, row] = csv.trimEnd().split('\r\n');
    expect(row).toContain('"INV-001-002-0000419"');
    expect(row).toContain('"\'=1+1"');
    expect(row).toContain('"بطاقة + نقداً"');
    expect(row).toContain('"1250.50"');
    expect(row).toContain('"250.00"');
    expect(row).toContain('"مرتجع جزئي"');
  });

  it('turns typed amounts into minor units of the currency', () => {
    expect(toMinor('1250', 'SYP')).toBe('125000');
    expect(toMinor('12.5', 'USD')).toBe('1250');
    expect(toMinor('abc', 'SYP')).toBeNull();
    expect(toMinor('1.234', 'USD')).toBeNull();
  });
});

const NEXT_PAGE = LIST.replace('limit=50', 'cursor=next-1&limit=50');

describe('round 42: the invoice list', () => {
  const SUMMARY = '/v1/sales/summary?from=2026-10-01&to=2026-10-31';

  it('writes the CSV time in the store time zone, not UTC', () => {
    // 18:30 UTC is 21:30 in Damascus (UTC+3), and 00:10 UTC is 03:10 the same day
    const csv = salesCsv(
      [
        item({ deviceTime: '2026-10-30T18:30:00.000Z' }),
        item({ id: 'sale-2', deviceTime: '2026-10-30T00:10:00.000Z' }),
      ],
      'Asia/Damascus',
    );
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[1]).toContain('"21:30"');
    expect(rows[2]).toContain('"03:10"');
    expect(salesCsv([item({ deviceTime: '2026-10-30T18:30:00.000Z' })], 'UTC')).toContain('"18:30"');
  });

  it('shows count, total, returns and net of the current filter above the list', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      [`GET ${SUMMARY}`]: {
        status: 200,
        body: {
          totals: [
            {
              currency: 'SYP',
              count: 573,
              grossMinor: 235_854_100,
              returnsMinor: 15_509_000,
              netMinor: 220_345_100,
            },
          ],
        },
      },
    });
    const strip = await screen.findByRole('region', { name: 'مجاميع الفواتير' });
    expect(text(strip)).toContain('573');
    expect(text(strip)).toContain('2,358,541');
    expect(text(strip)).toContain('155,090');
    expect(text(strip)).toContain('2,203,451');
  });

  it('says on the field that the highest amount is below the lowest, and sends nothing', async () => {
    const { requests } = signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      [`GET ${SUMMARY}`]: { status: 200, body: { totals: [] } },
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.change(screen.getByLabelText('أقل مبلغ'), { target: { value: '9000' } });
    fireEvent.change(screen.getByLabelText('أكثر مبلغ'), { target: { value: '100' } });
    expect(await screen.findByText('أكثر مبلغ أقل من أقل مبلغ')).toBeInTheDocument();
    expect(await screen.findByText('صحّح الخانات المعلَّمة أولاً.')).toBeInTheDocument();
    expect(requests.some((r) => r.path.includes('maxTotal'))).toBe(false);
    expect(screen.getByRole('button', { name: 'صدّر إلى إكسل' })).toBeDisabled();
  });

  it('says on the search that it is too long, and sends nothing', async () => {
    const { requests } = signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      [`GET ${SUMMARY}`]: { status: 200, body: { totals: [] } },
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.change(screen.getByRole('searchbox', { name: /ابحث/ }), { target: { value: 'ب'.repeat(61) } });
    expect(await screen.findByText('البحث أطول من 60 حرفاً. اختصره.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(requests.some((r) => r.path.includes('q='))).toBe(false);
  });

  it('shows the server refusal on the field it names', async () => {
    const q = encodeURIComponent('abc');
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      [`GET ${SUMMARY}`]: { status: 200, body: { totals: [] } },
      [`GET /v1/sales?from=2026-10-01&to=2026-10-31&q=${q}&limit=50`]: apiError(
        400,
        'validation_failed',
        'تحقّق من الحقول المظلّلة.',
        { q: 'too long' },
      ),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.change(screen.getByRole('searchbox', { name: /ابحث/ }), { target: { value: 'abc' } });
    expect(await screen.findByText('البحث غير مقبول. اختصره وجرّب مرة ثانية.')).toBeInTheDocument();
    expect(screen.queryByText('تحقّق من الحقول المظلّلة.')).not.toBeInTheDocument();
  });

  it('opens on the filters and the page in the address', async () => {
    const NEXT_CARD = '/v1/sales?from=2026-10-01&to=2026-10-31&method=card&cursor=c1&limit=50';
    const { requests } = signIn(
      OWNER_KEYS,
      {
        [`GET ${NEXT_CARD}`]: page([item({ id: 'sale-9', number: 'INV-001-002-0000300' })], 'c2'),
        'GET /v1/sales/summary?from=2026-10-01&to=2026-10-31&method=card': {
          status: 200,
          body: { totals: [] },
        },
      },
      '/sales/invoices?method=card&pg=c1',
    );
    expect(await screen.findByText('INV-001-002-0000300')).toBeInTheDocument();
    expect(screen.getByLabelText('طريقة الدفع')).toHaveValue('card');
    expect(
      screen.getByRole('navigation', { name: 'الصفحات' }).querySelector('[aria-current]'),
    ).toHaveTextContent('صفحة 2 · الفواتير من 51 إلى 51');
    expect(requests.some((r) => r.path === NEXT_CARD)).toBe(true);
  });

  it('falls back to page 1 when the page in the address no longer exists', async () => {
    signIn(
      OWNER_KEYS,
      {
        [`GET ${LIST.replace('limit=50', 'cursor=old&limit=50')}`]: apiError(
          400,
          'validation_failed',
          'تحقّق من الحقول المظلّلة.',
          { cursor: 'مؤشر غير صالح' },
        ),
        [`GET ${LIST}`]: page([item()]),
      },
      '/sales/invoices?pg=old',
    );
    expect(await screen.findByText('INV-001-002-0000419')).toBeInTheDocument();
  });

  it('disables the page controls while new filters load instead of showing the old numbers', async () => {
    let release: (reply: MockReply) => void = () => undefined;
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()], 'next-1'),
      [`GET ${NEXT_PAGE}`]: page([item({ id: 'sale-2', number: 'INV-001-002-0000418' })], 'next-2'),
      'GET /v1/sales?from=2026-10-01&to=2026-10-31&method=card&limit=50': () =>
        new Promise<MockReply>((resolve) => {
          release = resolve;
        }),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    await screen.findByText('INV-001-002-0000418');
    fireEvent.change(screen.getByLabelText('طريقة الدفع'), { target: { value: 'card' } });
    const nav = await screen.findByRole('navigation', { name: 'الصفحات' });
    await waitFor(() => expect(nav).toHaveTextContent('نحمّل الفواتير…'));
    expect(nav).not.toHaveTextContent('من 51 إلى 50');
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeDisabled();
    release(page([item()]));
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'الصفحات' })).not.toBeInTheDocument(),
    );
  });

  it('opens the invoice from a click anywhere on its row', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      'GET /v1/sales/sale-1': { status: 200, body: detail() },
    });
    const table = await screen.findByRole('table', { name: 'فواتير المتجر' });
    const cell = (await within(table).findByText('ريم')).closest('td')!;
    fireEvent.click(cell);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('exports every page and says how many invoices went into the file', async () => {
    const created = vi.fn(() => 'blob:csv');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      [`GET ${SUMMARY}`]: { status: 200, body: { totals: [] } },
      'GET /v1/sales?from=2026-10-01&to=2026-10-31&limit=200': page([item()], 'c1'),
      'GET /v1/sales?from=2026-10-01&to=2026-10-31&cursor=c1&limit=200': page([
        item({ id: 'sale-2', number: 'INV-001-002-0000420' }),
      ]),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.click(screen.getByRole('button', { name: 'صدّر إلى إكسل' }));
    expect(await screen.findByText('صُدّرت 2 فاتورة كلها.')).toBeInTheDocument();
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('sends the return to the till: no paired till here says how to do it there', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()]),
      'GET /v1/sales/sale-1': { status: 200, body: detail() },
    });
    fireEvent.click(await screen.findByRole('button', { name: /INV-001-002-0000419/ }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(await within(sheet).findByRole('button', { name: 'استبدال / مرتجع' }));
    expect(await within(sheet).findByText('هذا المتصفح غير مربوط بكاشير')).toBeInTheDocument();
    expect(text(sheet)).toContain('INV-001-002-0000419');
  });

  it('has no return button on an invoice that is fully returned', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item({ status: 'returned' })]),
      'GET /v1/sales/sale-1': { status: 200, body: detail({ status: 'returned' }) },
    });
    fireEvent.click(await screen.findByRole('button', { name: /INV-001-002-0000419/ }));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByRole('button', { name: 'اطبع الفاتورة' });
    expect(within(sheet).queryByRole('button', { name: 'استبدال / مرتجع' })).not.toBeInTheDocument();
  });
});
