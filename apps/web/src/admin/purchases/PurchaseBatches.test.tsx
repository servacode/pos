import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierListResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

/** The purchase receipt with batches (03 › الصيدليات): the date is asked where it is needed, a past one warns. */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage', 'cost.view'] },
  };
}

const suppliers: SupplierListResponse = {
  items: [{ id: 's-1', name: 'مستودع الشفاء', phone: null, notes: null, balanceMinor: 0, archived: false }],
  totalOwedMinor: 0,
  baseCurrency: 'SYP',
};

function open() {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
    'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
    [`GET ${productsPath({ q: 'قفازات' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-1', nameAr: 'قفازات طبية', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-1': () => ({
      status: 200,
      body: {
        id: 'p-1',
        nameAr: 'قفازات طبية',
        requiresExpiry: true,
        variants: [{ id: 'v-1', label: null, archivedAt: null, barcodes: [] }],
      },
    }),
    'POST /v1/purchases': (_r: MockRequest) => ({
      status: 201,
      body: { id: 'pu-1', number: 'PUR-2026-000001' },
    }),
  });
  return { ...mock, ...renderApp('/purchases') };
}

async function addTwice(user: ReturnType<typeof open>['user']) {
  await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
  for (let n = 0; n < 2; n += 1) {
    await user.clear(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قفازات');
    await user.click(await screen.findByRole('button', { name: 'قفازات طبية' }));
  }
}

describe('a receipt with batches', () => {
  it('asks the expiry date of an item that requires it, takes the item twice with different batches, and saves both', async () => {
    const { user, requestsTo } = open();
    await addTwice(user);
    const dates = await screen.findAllByLabelText('تاريخ الانتهاء (مطلوب)');
    expect(dates).toHaveLength(2);
    const save = screen.getByRole('button', { name: 'سجّل الفاتورة' });
    await user.type(screen.getAllByLabelText('كمية قفازات طبية')[0]!, '10');
    await user.type(screen.getAllByLabelText('كلفة قفازات طبية')[0]!, '1000');
    await user.type(screen.getAllByLabelText('كمية قفازات طبية')[1]!, '5');
    await user.type(screen.getAllByLabelText('كلفة قفازات طبية')[1]!, '500');
    // Without the dates the receipt cannot be saved
    expect(save).toBeDisabled();
    await user.type(screen.getAllByLabelText('دفعة قفازات طبية')[0]!, 'G-1');
    await user.type(screen.getAllByLabelText('دفعة قفازات طبية')[1]!, 'G-2');
    await user.type(dates[0]!, '01/03/2099');
    await user.type(dates[1]!, '01/06/2099');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText(/سُجّلت الفاتورة PUR-2026-000001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      lines: [
        { variantId: 'v-1', batchNo: 'G-1', expiryDate: '2099-03-01' },
        { variantId: 'v-1', batchNo: 'G-2', expiryDate: '2099-06-01' },
      ],
    });
  });

  it('says why the receipt waits: the missing numbers, then the missing expiry date, by item name', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قفازات');
    await user.click(await screen.findByRole('button', { name: 'قفازات طبية' }));
    expect(await screen.findByText('اكتب الكمية والكلفة لكل صنف ليُسجَّل.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('كمية قفازات طبية'), '10');
    await user.type(screen.getByLabelText('كلفة قفازات طبية'), '16000');
    expect(await screen.findByText('اكتب تاريخ الانتهاء لـ قفازات طبية ليُسجَّل.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجّل الفاتورة' })).toHaveAccessibleDescription(
      'اكتب تاريخ الانتهاء لـ قفازات طبية ليُسجَّل.',
    );
    // The line cost is read back with its separator and currency
    expect(screen.getAllByText(/16,000/).length).toBeGreaterThanOrEqual(2);
    await user.type(screen.getByLabelText('تاريخ الانتهاء (مطلوب)'), '01/03/2099');
    expect(screen.queryByText(/ليُسجَّل/)).toBeNull();
  });

  it('warns about an expiry date that is already past, and still lets it be saved', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قفازات');
    await user.click(await screen.findByRole('button', { name: 'قفازات طبية' }));
    const date = await screen.findByLabelText('تاريخ الانتهاء (مطلوب)');
    await user.type(date, '01/01/2020');
    const warning = await screen.findByRole('status');
    expect(within(warning.parentElement!).getByText(/هذا التاريخ مضى/)).toBeInTheDocument();
    await user.clear(date);
    await user.type(date, '01/01/2099');
    expect(screen.queryByText(/هذا التاريخ مضى/)).toBeNull();
  });
});

describe('serial numbers on a receipt', () => {
  function serialMock(tracksSerial: boolean) {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
      'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
      [`GET ${productsPath({ q: 'جهاز' })}`]: () => ({
        status: 200,
        body: { items: [{ id: 'p-9', nameAr: 'جهاز ضغط', type: 'stock' }], nextCursor: null },
      }),
      'GET /v1/products/p-9': () => ({
        status: 200,
        body: {
          id: 'p-9',
          nameAr: 'جهاز ضغط',
          tracksSerial,
          variants: [{ id: 'v-9', label: null, archivedAt: null, barcodes: [] }],
        },
      }),
    });
    return renderApp('/purchases');
  }

  it.each([
    [true, 1],
    [false, 0],
  ])('shows the serial field only for a product that tracks them (%s)', async (tracks, count) => {
    const { user } = serialMock(tracks);
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'جهاز');
    await user.click(await screen.findByRole('button', { name: 'جهاز ضغط' }));
    await screen.findByLabelText('كمية جهاز ضغط');
    expect(screen.queryAllByLabelText(/أرقام جهاز ضغط/)).toHaveLength(count);
  });
});
