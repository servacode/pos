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
  routes: Record<string, MockReply | (() => MockReply)>,
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
    const table = await screen.findByRole('table', { name: 'فواتير المتجر' });
    await within(table).findByText('INV-001-002-0000419');
    const rows = within(table).getAllByRole('row').map(text);
    expect(rows[0]).toBe('الفاتورةالتاريخالفرعالكاشيرالزبونالدفعالحالةالإجمالي');
    expect(rows[1]).toContain('INV-001-002-0000419');
    expect(rows[1]).toContain('30 تشرين الأول 2026');
    expect(rows[1]).toContain('ريم');
    expect(rows[1]).toContain('مكتملة');
    expect(rows[1]).toContain('1,200 ل.س');
    expect(rows[2]).toContain('بطاقة + نقداً');
    expect(rows[2]).toContain('مرتجع جزئي');
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

  it('loads the next page with «اعرض المزيد» using the cursor', async () => {
    signIn(OWNER_KEYS, {
      [`GET ${LIST}`]: page([item()], 'next-1'),
      [`GET ${LIST.replace('limit=50', 'cursor=next-1&limit=50')}`]: page([
        item({ id: 'sale-2', number: 'INV-001-002-0000418' }),
      ]),
    });
    await screen.findByText('INV-001-002-0000419');
    fireEvent.click(screen.getByRole('button', { name: 'اعرض المزيد' }));
    expect(await screen.findByText('INV-001-002-0000418')).toBeInTheDocument();
    expect(screen.getByText('INV-001-002-0000419')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'اعرض المزيد' })).not.toBeInTheDocument();
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
    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
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
