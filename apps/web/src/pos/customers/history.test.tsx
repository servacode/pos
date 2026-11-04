import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerPurchases } from '@serva/core/contracts/customers';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

afterEach(() => {
  vi.restoreAllMocks();
});

const HISTORY: CustomerPurchases = {
  customerId: ids.abuKhaled,
  sizes: [
    {
      name: 'المقاس',
      values: [
        { value: 'M', qty: 3000 },
        { value: 'L', qty: 1000 },
      ],
    },
  ],
  invoices: [
    {
      id: 'i-1',
      number: 'SAL-001-001-0000042',
      date: '2026-10-20',
      totalMinor: 300_000,
      currency: 'SYP',
      lines: [{ name: 'قميص M · أبيض', qty: 2000, totalMinor: 200_000, returnedQty: 1000 }],
    },
  ],
  pieces: 4000,
  spentMinor: 400_000,
};

describe('«مشترياته» at payment (03 › الألبسة: سجل الزبون ومقاسه)', () => {
  it('shows the picked customer’s sizes and latest invoices from the server', async () => {
    const local = memoryLocal();
    await openShift(local);
    const staff = staffServer();
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url) === `/v1/device/customers/${ids.abuKhaled}/purchases`
        ? new Response(JSON.stringify(HISTORY), { status: 200 })
        : staff(url, init),
    ) as unknown as typeof globalThis.fetch;
    const { user } = renderPos({ local, fetch });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    await user.click(within(pay).getByRole('button', { name: 'مشترياته' }));
    const history = await within(pay).findByRole('region', { name: 'مشتريات الزبون' });
    expect(within(history).getByRole('list', { name: 'مقاساته' })).toHaveTextContent('المقاس: M ×3، L ×1');
    expect(history).toHaveTextContent('SAL-001-001-0000042');
    expect(history).toHaveTextContent('رجع 1');
  });

  it('says so when the till is offline', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, setOnline } = renderPos({ local });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    setOnline(false);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    await user.click(within(pay).getByRole('button', { name: 'مشترياته' }));
    expect(await within(pay).findByText('سجل الزبون يحتاج اتصالاً بالخادم.')).toBeInTheDocument();
  });
});
