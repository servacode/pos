import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiftVoucherPayload, SalePayload } from '@serva/core/contracts/documents';
import type { ContractPriceForTill } from '@serva/core/contracts/contract-prices';
import type { MaintenanceContract } from '@serva/core/contracts/maintenance';
import type { RentableUnit, Rental } from '@serva/core/contracts/rentals';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, product, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

/** «التأجير» and «عقود الصيانة» on the till, and a customer's contract prices (03 › الأدوات الطبية). */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

const RENTAL: Rental = {
  id: 'r-1',
  number: 'RNT-000001',
  status: 'out',
  overdue: true,
  serial: 'WC001',
  item: 'كرسي متحرك',
  customerId: null,
  customerName: 'مشفى الأمل',
  customerPhone: '0944555666',
  startDate: '2026-11-01',
  expectedReturn: '2026-11-08',
  rateUnit: 'week',
  rateMinor: 30_000,
  currency: 'SYP',
  depositMinor: 20_000,
  depositVoucher: 'GFT-001-002-0000001',
  note: null,
  returnedOn: null,
  chargeMinor: 60_000,
  version: 3,
  createdAt: '2026-11-01T08:00:00.000Z',
};

const CONTRACT: MaintenanceContract = {
  id: 'm-1',
  number: 'MC-000001',
  customerId: null,
  customerName: 'عيادة النور',
  customerPhone: null,
  devices: [{ serial: 'OX-1', item: 'مكثف أكسجين' }],
  startDate: '2026-01-15',
  endDate: '2026-12-31',
  visitEveryMonths: 3,
  currency: 'SYP',
  priceMinor: 400_000,
  visits: [],
  nextVisit: '2026-11-15',
  visitOverdue: false,
  state: 'active',
  billedOn: null,
  note: null,
  version: 2,
  createdAt: '2026-01-10T08:00:00.000Z',
};

const UNITS: RentableUnit[] = [{ serial: 'WC002', variantId: 'v-1', item: 'كرسي متحرك' }];

/** The server of the rental calls over the staff one; every call is kept */
function server(prices: ContractPriceForTill[] = []) {
  const staff = staffServer();
  const sent: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (!path.startsWith('/v1/device/')) return staff(url, init);
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    sent.push({ url: path, body });
    const ok = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
    if (path === '/v1/device/rentals' && !body) return ok({ items: [RENTAL] });
    if (path === '/v1/device/rentals') return ok({ ...RENTAL, id: 'r-2', number: 'RNT-000002' }, 201);
    if (path.startsWith('/v1/device/rentals/units')) return ok({ items: UNITS });
    if (path.endsWith('/return')) return ok({ ...RENTAL, status: 'returned' });
    if (path === '/v1/device/maintenance') return ok({ items: [CONTRACT] });
    if (path.endsWith('/billed')) return ok({ ...CONTRACT, billedOn: '2026-11-13' });
    if (path.startsWith('/v1/device/contract-prices')) return ok({ items: prices });
    return staff(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, sent };
}

async function openRentals(user: ReturnType<typeof renderPos>['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  await user.click(screen.getByRole('button', { name: 'المزيد' }));
  await user.click(screen.getByRole('menuitem', { name: 'التأجير' }));
}

function withServices() {
  const rent = product('إيجار', 10_000, null);
  const maintenance = product('عقد صيانة', 10_000, null);
  const base = posSets();
  return {
    ...base,
    products: [...base.products, rent.product, maintenance.product],
    variants: [...base.variants, rent.variant, maintenance.variant],
    prices: [...base.prices, rent.price, maintenance.price],
  };
}

describe('«التأجير» on the till', () => {
  it('rents a piece out with a deposit taken as a gift voucher, and prints the contract', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server();
    const { user, outbox } = renderPos({ local, fetch });
    await openRentals(user);
    const form = await screen.findByRole('region', { name: 'تأجير جديد' });
    await user.click(await within(form).findByRole('button', { name: /WC002/ }));
    await user.type(within(form).getByLabelText('اسم المستأجر'), 'مشفى الأمل');
    await user.type(within(form).getByLabelText('جوال المستأجر'), '0944555666');
    await user.type(within(form).getByLabelText('المبلغ'), '300');
    await user.type(within(form).getByLabelText('العربون (اختياري)'), '200');
    await user.click(within(form).getByRole('button', { name: 'سجّل واطبع العقد' }));

    await vi.waitFor(() => expect(window.print).toHaveBeenCalled());
    const gift = outbox.find((e) => e.type === 'gift_voucher')!;
    expect(gift.doc.payload as unknown as GiftVoucherPayload).toMatchObject({
      amountMinor: 20_000,
      method: 'cash',
      forName: 'مشفى الأمل',
    });
    const made = sent.find((s) => s.url === '/v1/device/rentals' && s.body)!;
    expect(made.body).toMatchObject({
      serial: 'WC002',
      customerName: 'مشفى الأمل',
      rateUnit: 'day',
      rateMinor: 30_000,
      depositMinor: 20_000,
      depositVoucher: gift.doc.number,
    });
    const sheet = document.querySelector('[data-print-receipt]') as HTMLElement;
    expect(within(sheet).getByRole('region', { name: 'عقد تأجير' })).toHaveTextContent('RNT-000002');
  });

  it('takes the device back as a sale of the rent, the deposit voucher in place, and closes the rental once saved', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server();
    const { user, outbox } = renderPos({ local, fetch, sets: withServices() });
    await openRentals(user);
    const card = await screen.findByRole('listitem', { name: 'التأجير RNT-000001' });
    expect(within(card).getByText('متأخر')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'استلام الجهاز' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.getByText(/إيجار · RNT-000001/)).toBeInTheDocument();
    // The rental is not closed until its rent is sold
    expect(sent.some((s) => s.url.endsWith('/return'))).toBe(false);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).getByLabelText('رقم القسيمة')).toHaveValue('GFT-001-002-0000001');
    await user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
    await user.keyboard('600{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.totals.totalMinor).toBe(60_000);
    await vi.waitFor(() =>
      expect(sent.at(-1)).toMatchObject({ url: '/v1/device/rentals/r-1/return', body: { version: 3 } }),
    );
  });

  it('says what is missing when the store sells no «إيجار» service', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch } = server();
    const { user } = renderPos({ local, fetch });
    await openRentals(user);
    const card = await screen.findByRole('listitem', { name: 'التأجير RNT-000001' });
    await user.click(within(card).getByRole('button', { name: 'استلام الجهاز' }));
    expect(await screen.findByText(/لا يوجد صنف خدمة اسمه «إيجار»/)).toBeInTheDocument();
  });

  it('bills a maintenance contract as a sale of its price, and marks it billed once saved', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server();
    const { user } = renderPos({ local, fetch, sets: withServices() });
    await openRentals(user);
    await user.click(await screen.findByRole('radio', { name: 'عقود الصيانة' }));
    const card = await screen.findByRole('listitem', { name: 'العقد MC-000001' });
    await user.click(within(card).getByRole('button', { name: 'حصّل سعر العقد' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.getByText(/عقد صيانة · MC-000001/)).toBeInTheDocument();
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('4000{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    await vi.waitFor(() =>
      expect(sent.at(-1)).toMatchObject({ url: '/v1/device/maintenance/m-1/billed', body: { version: 2 } }),
    );
  });
});

describe('a customer’s contract prices at the till', () => {
  async function toPay(prices: ContractPriceForTill[]) {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server(prices);
    const pos = renderPos({ local, fetch });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
    await pos.user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(pos.user, PRODUCTS.sugar.barcode!.code);
    await pos.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await pos.user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await pos.user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await pos.user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    return { ...pos, pay, sent };
  }

  it('prices the lines with the customer’s contract price once they are picked', async () => {
    const { user, outbox, sent } = await toPay([
      { variantId: PRODUCTS.sugar.variant.id, currency: 'SYP', priceMinor: 60_000 },
    ]);
    await vi.waitFor(() =>
      expect(plain(screen.getByRole('status', { name: 'المطلوب' }))).toContain('600 ل.س'),
    );
    expect(sent.some((s) => s.url.startsWith(`/v1/device/contract-prices?customerId=${ids.abuKhaled}`))).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.lines[0]).toMatchObject({ priceMinor: 60_000, unitPriceMinor: 60_000 });
  });

  it('keeps the shelf price for a customer with none', async () => {
    await toPay([]);
    await vi.waitFor(() =>
      expect(plain(screen.getByRole('status', { name: 'المطلوب' }))).toContain('790 ل.س'),
    );
  });
});
