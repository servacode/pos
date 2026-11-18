import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, PurchaseCorrection, PurchaseDetail, SupplierListResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

/**
 * Round 36 (decisions 11 and 12) on the purchases page: an invoice and a payment in dollars with the rate of
 * the day, the supplier's dollar balance, and «صحّح الفاتورة» with its refusal.
 */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage', 'cost.view'] },
  };
}

const supplier = (extra: Record<string, unknown> = {}) => ({
  id: 's-1',
  name: 'مؤسسة الفرات',
  phone: null,
  notes: null,
  balanceMinor: 0,
  archived: false,
  ...extra,
});

const DETAIL: PurchaseDetail = {
  id: 'pu-1',
  number: 'PUR-2026-000001',
  date: '2026-10-30',
  supplierId: 's-1',
  supplierName: 'مؤسسة الفرات',
  payment: 'credit',
  reference: 'F-77',
  totalMinor: 1_200_000,
  currency: 'USD',
  foreignTotalMinor: 10_000,
  rate: '120',
  correctedBy: null,
  branchId: 'b-1',
  notes: null,
  purchaseOrderId: null,
  baseCurrency: 'SYP',
  lines: [
    {
      lineNo: 1,
      variantId: 'v-1',
      productId: 'p-1',
      name: 'حليب طازج',
      qty: 10_000,
      costMinor: 1_200_000,
      foreignCostMinor: 10_000,
      batchNo: null,
      expiryDate: null,
      serials: [],
    },
  ],
};

const CORRECTION: PurchaseCorrection = {
  reversal: { id: 'rv-1', number: 'PRV-2026-000001', date: '2026-11-01', valueOutMinor: 1_200_000 },
  draft: {
    supplierId: 's-1',
    branchId: 'b-1',
    date: '2026-10-30',
    payment: 'credit',
    reference: 'F-77',
    notes: null,
    currency: 'USD',
    rate: '120',
    purchaseOrderId: null,
    lines: [
      {
        variantId: 'v-1',
        productId: 'p-1',
        name: 'حليب طازج',
        qty: 10_000,
        costMinor: 10_000,
        batchNo: null,
        expiryDate: null,
        serials: [],
      },
    ],
  },
};

function open(
  options: {
    suppliers?: SupplierListResponse;
    correct?: () => ReturnType<typeof apiError> | { status: number; body: unknown };
  } = {},
) {
  const suppliers: SupplierListResponse = options.suppliers ?? {
    items: [supplier()],
    totalOwedMinor: 0,
    baseCurrency: 'SYP',
  };
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/store': () => ({
      status: 200,
      body: { name: 'متجري', usdRate: '120', enabledCurrencies: ['SYP', 'USD'] },
    }),
    'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
    'GET /v1/purchases': () => ({
      status: 200,
      body: {
        items: [
          {
            id: 'pu-1',
            number: 'PUR-2026-000001',
            date: '2026-10-30',
            supplierId: 's-1',
            supplierName: 'مؤسسة الفرات',
            payment: 'credit',
            reference: 'F-77',
            totalMinor: 1_200_000,
            currency: 'USD',
            foreignTotalMinor: 10_000,
            rate: '120',
            correctedBy: null,
          },
        ],
        baseCurrency: 'SYP',
      },
    }),
    'GET /v1/purchases/pu-1': () => ({ status: 200, body: DETAIL }),
    'POST /v1/purchases/pu-1/correct': options.correct ?? (() => ({ status: 201, body: CORRECTION })),
    [`GET ${productsPath({ q: 'حليب' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-1', nameAr: 'حليب طازج', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-1': () => ({
      status: 200,
      body: {
        id: 'p-1',
        nameAr: 'حليب طازج',
        variants: [
          {
            id: 'v-1',
            label: null,
            archivedAt: null,
            barcodes: [],
            price: { currency: 'SYP', priceMinor: 0 },
          },
        ],
      },
    }),
    'POST /v1/purchases': () => ({ status: 201, body: { id: 'pu-2', number: 'PUR-2026-000002' } }),
    'POST /v1/supplier-payments': (r: MockRequest) => ({
      status: 201,
      body: { id: 'pay-1', number: 'PAY-2026-000001', ...(r.body as object) },
    }),
  });
  return { ...mock, ...renderApp('/purchases') };
}

describe('purchasing in dollars (decision 11)', () => {
  it('an invoice in dollars: the rate starts at the store rate, costs are dollars, and what goes in the stock is shown in pounds', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    // the choice is offered because the store has the dollar
    await user.click(await screen.findByRole('radio', { name: 'دولار' }));
    expect(await screen.findByLabelText('سعر الدولار بالليرة')).toHaveValue('120');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '10');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '100');
    // 100 dollars at 120: 12,000 pounds into the stock
    expect(await screen.findByText(/تدخل المخزون بـ/)).toHaveTextContent('12');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    expect(
      await screen.findByText('سُجّلت الفاتورة PUR-2026-000002 ودخلت البضاعة المخزون.'),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      supplierId: 's-1',
      currency: 'USD',
      rate: '120',
      lines: [{ variantId: 'v-1', qty: 10_000, costMinor: 10_000 }],
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('an invoice in pounds sends no currency, as before', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '10');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '24000');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText('سُجّلت الفاتورة PUR-2026-000002 ودخلت البضاعة المخزون.');
    const sent = requestsTo('POST', '/v1/purchases')[0]?.body as Record<string, unknown>;
    expect(sent.currency).toBeUndefined();
    expect(sent.rate).toBeUndefined();
  });

  it('shows the dollar balance of a supplier and pays it in dollars, saying the exchange difference first', async () => {
    const { user, requestsTo } = open({
      suppliers: {
        items: [supplier({ balanceMinor: 1_200_000, usdBalanceMinor: 10_000, usdBookMinor: 1_200_000 })],
        totalOwedMinor: 1_200_000,
        baseCurrency: 'SYP',
      },
    });
    expect(await screen.findByText('منه بالدولار')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'دفعة لمورد' }));
    const dialog = await screen.findByRole('dialog', { name: 'دفعة لمورد' });
    // a supplier owed in dollars only starts the payment in dollars
    expect(within(dialog).getByRole('radio', { name: 'دولار' })).toBeChecked();
    await user.clear(within(dialog).getByLabelText('سعر الدولار بالليرة'));
    await user.type(within(dialog).getByLabelText('سعر الدولار بالليرة'), '130');
    await user.type(within(dialog).getByLabelText('المبلغ بالدولار'), '40');
    // 40 dollars at 130 = 5,200 against a debt booked at 4,800: a loss of 400
    expect(await within(dialog).findByText(/خسارة صرف/)).toBeInTheDocument();
    // a cheque is in pounds only
    expect(within(dialog).queryByRole('radio', { name: 'بشيك' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'سجّل الدفعة' }));
    expect(await screen.findByText('سُجّل سند الدفع PAY-2026-000001.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/supplier-payments')[0]?.body).toMatchObject({
      supplierId: 's-1',
      amountMinor: 4_000,
      currency: 'USD',
      rate: '130',
      method: 'cash',
    });
  });
});

describe('«صحّح الفاتورة» (decision 12)', () => {
  it('turns the invoice back and opens a pre-filled copy to fix and save', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'تفاصيل PUR-2026-000001' }));
    const dialog = await screen.findByRole('dialog', { name: /PUR-2026-000001/ });
    expect(await within(dialog).findByText(/بالدولار على سعر/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'صحّح الفاتورة' }));
    // asked first, in plain words
    expect(await within(dialog).findByText(/لا يُمحى شيء من الدفاتر/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases/pu-1/correct')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'نعم، صحّح' }));
    expect(await screen.findByText('صُحّحت الفاتورة PUR-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('PRV-2026-000001')).toBeInTheDocument();
    // the copy keeps the old values: the supplier, the reference, the dollars and the rate
    expect(screen.getByLabelText('رقم فاتورة المورد')).toHaveValue('F-77');
    expect(screen.getByLabelText('سعر الدولار بالليرة')).toHaveValue('120');
    expect(screen.getByLabelText('كمية حليب طازج')).toHaveValue('10');
    expect(screen.getByLabelText('كلفة حليب طازج')).toHaveValue('100');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText('سُجّلت الفاتورة PUR-2026-000002 ودخلت البضاعة المخزون.');
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      supplierId: 's-1',
      currency: 'USD',
      rate: '120',
      reference: 'F-77',
      lines: [{ variantId: 'v-1', qty: 10_000, costMinor: 10_000 }],
    });
  });

  it('when part of the goods was sold it says so and points to a return to the supplier', async () => {
    const { user } = open({
      correct: () =>
        apiError(
          409,
          'conflict',
          'لا يمكن تصحيح هذه الفاتورة: بِيع جزء من بضاعتها فلم يبقَ ما يكفي لإرجاعها (حليب طازج). سجّل مرتجعاً إلى المورد بدل التصحيح.',
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'تفاصيل PUR-2026-000001' }));
    const dialog = await screen.findByRole('dialog', { name: /PUR-2026-000001/ });
    await user.click(await within(dialog).findByRole('button', { name: 'صحّح الفاتورة' }));
    await user.click(within(dialog).getByRole('button', { name: 'نعم، صحّح' }));
    expect(await within(dialog).findByText(/بِيع جزء من بضاعتها/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'افتح مرتجعات الموردين' })).toHaveAttribute(
      'href',
      '/supplier-returns',
    );
    // nothing was turned back: the way to correct is still offered
    expect(within(dialog).getByRole('button', { name: 'صحّح الفاتورة' })).toBeInTheDocument();
  });
});
