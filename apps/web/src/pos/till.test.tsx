import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlterationTicket } from '@serva/core/contracts/alterations';
import type { InvoiceLookup } from '@serva/core/contracts/till';
import type {
  ReturnPayload,
  SalePayload,
  ShiftClosePayload,
  GiftVoucherPayload,
} from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../offline/local';
import { ids, PINS, posSets, PRODUCTS, product, staffServer } from '../test/pos';
import { openShift, renderPos, scan } from '../test/renderPos';
import { counted, INVOICES } from './format';
import { receiptLines } from './print/lines';
import type { ReceiptData } from './receipt/Receipt';
import { returnReasons, returnWindowOf, saleFromServer, searchInvoice } from './return/returns';
import { shiftActivity } from './shift/shift';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Pos = ReturnType<typeof renderPos>;

async function signIn(user: Pos['user'], name: 'سامر' | 'مريم' = 'سامر') {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: new RegExp(name) }));
  await user.keyboard(PINS[name === 'سامر' ? ids.samer : ids.maryam]!);
}

/** The store's settings with a few fields changed (the till rules, the business types) */
function setsWith(settings: Record<string, unknown>) {
  const base = posSets();
  return { ...base, settings: [{ ...base.settings[0]!, ...settings }] } as ReturnType<typeof posSets>;
}

async function sellTwoOils(user: Pos['user']) {
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(user, PRODUCTS.oil.barcode!.code);
  await scan(user, PRODUCTS.oil.barcode!.code);
  await user.keyboard('{F12}');
  await screen.findByRole('region', { name: 'الدفع' });
  await user.keyboard('500{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('Arabic counted nouns', () => {
  it('1 فاتورة، 2 فاتورتان، 3-10 فواتير، 11 فأكثر فاتورة', () => {
    expect(counted(1, INVOICES)).toBe('فاتورة واحدة');
    expect(counted(2, INVOICES)).toBe('فاتورتان');
    expect(counted(3, INVOICES)).toBe('3 فواتير');
    expect(counted(6, INVOICES)).toBe('6 فواتير');
    expect(counted(10, INVOICES)).toBe('10 فواتير');
    expect(counted(11, INVOICES)).toBe('11 فاتورة');
    expect(counted(103, INVOICES)).toBe('103 فاتورة');
    expect(counted(0, INVOICES)).toBe('0 فاتورة');
    expect(counted(2.5, INVOICES)).toBe('2.5 فاتورة');
    expect(counted(6, INVOICES, 'arab')).toBe('٦ فواتير');
  });
});

describe('return rules by store', () => {
  it('words the reasons by business type and keeps expiry as the default only where it applies', () => {
    expect(returnReasons(undefined)[0]).toBe('تالف أو منتهي الصلاحية');
    expect(returnReasons(['pharmacy'])[0]).toBe('تالف أو منتهي الصلاحية');
    expect(returnReasons(['clothing'])).toEqual([
      'المقاس غير مناسب',
      'عيب في القطعة',
      'لم يعجب الزبون',
      'تبديل',
      'خطأ في الفاتورة',
    ]);
    // A mixed store leads with the clothes reasons but still offers the expiry one
    expect(returnReasons(['clothing', 'supermarket'])).toContain('تالف أو منتهي الصلاحية');
    expect(returnReasons(['clothing', 'supermarket'])[0]).toBe('المقاس غير مناسب');
  });

  it('gives clothing 30 days, others 7, or the store’s own number', () => {
    expect(returnWindowOf({ till: null, sectors: ['clothing'] })).toBe(30);
    expect(returnWindowOf({ till: null, sectors: ['supermarket'] })).toBe(7);
    expect(returnWindowOf({ till: null, sectors: undefined })).toBe(7);
    expect(returnWindowOf({ till: { returnWindowDays: 14, cardApprovalRequired: false }, sectors: [] })).toBe(
      14,
    );
  });

  it('takes an invoice the server found only inside the window, with the larger count of returns', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const found: InvoiceLookup = {
      id: 'x',
      number: 'INV-001-009-0000042',
      deviceTime: '2026-11-01T10:00:00Z',
      payload: { totals: {} },
      returned: [
        { saleLineNo: 1, qty: 1000, grossExTaxMinor: 1, discountExTaxMinor: 0, taxMinor: 0, totalMinor: 1 },
      ],
    };
    expect(saleFromServer(found, [], now, 7)).toBeNull();
    const kept = saleFromServer(found, [], now, 30)!;
    expect(kept.number).toBe('INV-001-009-0000042');
    expect(kept.returned).toHaveLength(1);
    // This till returned two pieces the server has not seen yet: its own count is the larger
    const own = {
      seq: 1,
      type: 'return',
      doc: {
        id: 'r',
        type: 'return',
        number: 'SRT-1',
        deviceTime: '2026-11-09T10:00:00Z',
        payload: {
          saleId: 'x',
          lines: [{ saleLineNo: 1, qty: 2000, refund: { totalMinor: 2 } }],
        },
      },
    };
    const sale = {
      seq: 0,
      type: 'sale',
      doc: {
        id: 'x',
        type: 'sale',
        number: 'INV-001-009-0000042',
        deviceTime: found.deviceTime,
        payload: {},
      },
    };
    const merged = saleFromServer(found, [sale, own] as never, now, 30)!;
    expect(merged.returned).toEqual([{ saleLineNo: 1, qty: 2000, totalMinor: 2 }]);
  });

  it('asks the server for an invoice by number and tells missing from offline', async () => {
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const lookup = {
      id: 'a',
      number: 'INV-1',
      deviceTime: '2026-11-01T00:00:00Z',
      payload: {},
      returned: [],
    };
    expect(await searchInvoice('INV-1', 't', answer(200, lookup))).toEqual({ found: lookup });
    expect(await searchInvoice('INV-9', 't', answer(404, {}))).toEqual({ found: null, reason: 'missing' });
    expect(await searchInvoice('INV-9', 't', answer(503, {}))).toEqual({ found: null, reason: 'offline' });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await searchInvoice('INV-9', 't', down)).toEqual({ found: null, reason: 'offline' });
  });
});

describe('«مرتجع»: an invoice of another till, and the exchange', () => {
  it('finds an invoice sold on another till by its number, from the server', async () => {
    const local = memoryLocal();
    await openShift(local);
    // The other till's invoice is only known to the server
    let remote: InvoiceLookup | null = null;
    const staff = staffServer();
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith('/v1/device/invoices/lookup')) {
        const q = new URL(String(url), 'http://x').searchParams.get('q');
        return remote && q === remote.number
          ? new Response(JSON.stringify(remote), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 'not_found', message: 'لا' } }), { status: 404 });
      }
      return staff(url, init);
    }) as unknown as typeof fetch;
    const { user, outbox } = renderPos({ local, fetch: fetchFn });
    await signIn(user);
    await sellTwoOils(user);
    const mine = outbox.find((e) => e.type === 'sale')!;
    remote = {
      id: '0192a000-0000-7000-8000-0000000000aa',
      number: 'INV-001-009-0000042',
      deviceTime: new Date().toISOString(),
      payload: mine.doc.payload,
      returned: [],
    };

    await user.keyboard('{Alt>}r{/Alt}');
    await screen.findByRole('heading', { name: 'مرتجع' });
    expect(screen.getByText(/من أي جهاز في المحل/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('رقم الفاتورة'), 'INV-001-009-0000042{Enter}');
    // The full number shows on the picked invoice
    expect(await screen.findByRole('heading', { name: /INV-001-009-0000042/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    const ret = outbox.find((e) => e.type === 'return')!;
    expect(ret.doc.deps).toEqual([remote.id]);
    expect(ret.doc.payload).toMatchObject({ saleId: remote.id, saleNumber: 'INV-001-009-0000042' });
  });

  it('says so when the invoice is not in the store, and when the till is offline', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, setOnline } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.keyboard('{Alt>}r{/Alt}');
    await screen.findByRole('heading', { name: 'مرتجع' });
    await user.type(screen.getByLabelText('رقم الفاتورة'), 'INV-999{Enter}');
    expect(await screen.findByText(/تعذّر الوصول إلى المحل الآن/)).toBeInTheDocument();
    setOnline(false);
    await user.click(screen.getByRole('button', { name: 'ابحث في المحل كله' }));
    expect(await screen.findByText(/لا إنترنت الآن: تظهر فواتير هذا الجهاز فقط/)).toBeInTheDocument();
  });

  it('a clothing store: the return window shows its 30 days and the reasons are about size', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local, sets: setsWith({ sectors: ['clothing'] }) });
    await signIn(user);
    await sellTwoOils(user);
    await user.keyboard('{Alt>}r{/Alt}');
    await screen.findByRole('heading', { name: 'مرتجع' });
    expect(screen.getByText(/آخر 30 يوماً/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    const reasons = screen.getByRole('group', { name: 'السبب' });
    expect(within(reasons).getByRole('button', { name: 'المقاس غير مناسب' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(reasons).queryByRole('button', { name: 'تالف أو منتهي الصلاحية' })).not.toBeInTheDocument();
  });

  it('an exchange returns the piece on a voucher and opens the sale of the other piece with it', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user);
    await sellTwoOils(user);
    await user.keyboard('{Alt>}r{/Alt}');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    await user.click(screen.getByRole('button', { name: 'استبدال بقطعة أخرى' }));
    expect(screen.queryByRole('group', { name: 'طريقة الرد' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    await user.click(screen.getByRole('button', { name: 'سجّل وبِع البديل' }));
    await user.keyboard(PINS[ids.maryam]!);

    // Back at the sale, with the voucher waiting at payment
    await screen.findByRole('list', { name: 'الأصناف' });
    const ret = outbox.find((e) => e.type === 'return')!;
    const payload = ret.doc.payload as unknown as ReturnPayload;
    expect(payload.reason).toBe('تبديل');
    expect(payload.refunds).toEqual([
      { method: 'voucher', currency: 'SYP', amountMinor: 25_000, reference: null },
    ]);
    await scan(user, PRODUCTS.milk.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    // The voucher covers 250; the customer pays only the difference, 250
    const parts = await within(pay).findByRole('list', { name: 'الأجزاء المدفوعة' });
    expect(parts).toHaveTextContent('قسيمة');
    await user.keyboard('250{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.filter((e) => e.type === 'sale').at(-1)!.doc.payload as unknown as SalePayload;
    expect(sale.payments.map((p) => [p.method, p.amountMinor, p.reference])).toEqual([
      ['voucher', 25_000, ret.doc.number],
      ['cash', 25_000, null],
    ]);
    // The receipt says what is left on the voucher: nothing
    expect((await screen.findAllByText('الباقي على القسيمة')).length).toBeGreaterThan(0);
  });
});

describe('the receipt', () => {
  async function receiptOf(sets = posSets()) {
    const local = memoryLocal();
    await openShift(local);
    const pos = renderPos({ local, sets });
    await signIn(pos.user);
    await sellTwoOils(pos.user);
    return pos;
  }

  it('carries the invoice barcode, and the thanks once when the footer thanks already', async () => {
    await receiptOf();
    const slip = screen.getAllByLabelText('إيصال 80 مم')[0]!;
    expect(within(slip).getByRole('img', { name: /باركود INV-001-002-0000001/ })).toBeInTheDocument();
    expect(within(slip).getAllByText('شكراً لزيارتكم')).toHaveLength(1);
    expect(slip).toHaveTextContent('الاستبدال خلال 7 أيام بالإيصال.');
  });

  it('does not repeat the thanks of the store’s own footer', async () => {
    await receiptOf(setsWith({ receiptFooter: 'شكراً لثقتكم بنا' }));
    const slip = screen.getAllByLabelText('إيصال 80 مم')[0]!;
    expect(slip).toHaveTextContent('شكراً لثقتكم بنا');
    expect(within(slip).queryByText('شكراً لزيارتكم')).not.toBeInTheDocument();
  });

  it('prints the customer, the seller when not the cashier, the discount lines, the voucher balance and a barcode', async () => {
    const { outbox } = await receiptOf();
    const mine = outbox.find((e) => e.type === 'sale')!;
    const sale = {
      ...(mine.doc.payload as unknown as SalePayload),
      customerName: 'أم سامر',
    } as SalePayload;
    sale.totals = { ...sale.totals, invoiceDiscountMinor: 5_000, discountMinor: 5_000 };
    sale.payments = [
      { ...sale.payments[0]!, method: 'voucher', reference: 'GFT-1', amountMinor: 20_000 },
    ] as SalePayload['payments'];
    const base = posSets().settings[0]!;
    const data = {
      doc: { number: mine.doc.number, deviceTime: mine.doc.deviceTime, payload: sale },
      settings: { ...base, receiptFooter: 'شكراً لزيارتكم' },
      branch: null,
      storeName: 'متجر',
      branchName: 'فرع',
      deviceName: 'جهاز',
      cashierName: 'سامر',
      sellerName: 'مريم',
      vouchersAfter: [{ code: 'GFT-1', balanceMinor: 30_000, currency: 'SYP' }],
    } as unknown as ReceiptData;
    const lines = receiptLines(data);
    const text = lines.map((l) => ('text' in l ? l.text : 'start' in l ? `${l.start}|${l.end}` : l.kind));
    expect(text).toContain('البائع: مريم');
    expect(text).toContain('الزبون: أم سامر');
    expect(text.some((t) => t.startsWith('خصم الفاتورة|'))).toBe(true);
    expect(text.some((t) => t.startsWith('الباقي على القسيمة|'))).toBe(true);
    expect(lines.filter((l) => l.kind === 'barcode')).toEqual([{ kind: 'barcode', code: mine.doc.number }]);
    // The footer thanks, so the fixed thanks does not follow
    expect(text.filter((t) => t.includes('شكراً'))).toHaveLength(1);
    // A seller who is the cashier is not named twice
    const same = receiptLines({ ...data, sellerName: 'سامر' }).map((l) => ('text' in l ? l.text : ''));
    expect(same.some((t) => t.startsWith('البائع'))).toBe(false);
  });
});

describe('closing the shift', () => {
  it('types the count from the physical keyboard, and a manager’s Z report carries the expected cash and the difference', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    await screen.findByText('عدّ أعمى: لا يظهر المبلغ المتوقع. عُدّ ما في يدك فقط.');
    // The first note is picked: the digits typed on the keyboard go into it
    await user.keyboard('3');
    expect(screen.getByLabelText('عدد أوراق 500 ل.س')).toHaveValue('3');
    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('عدد أوراق 500 ل.س')).toHaveValue('');
    await user.keyboard('٤');
    expect(screen.getByLabelText('عدد أوراق 500 ل.س')).toHaveValue('4');
    await user.click(screen.getByRole('button', { name: 'تابع للملخّص' }));
    await user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    await user.click(screen.getByRole('button', { name: 'لا، ارجع' }));
    expect(outbox.some((e) => e.type === 'shift_close')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'أغلق الوردية' }));
    await user.click(screen.getByRole('button', { name: 'نعم، أغلق الوردية' }));
    const z = await screen.findByLabelText('تقرير إغلاق الوردية');
    expect(z).toHaveTextContent('المتوقع');
    expect(z).toHaveTextContent('الفرق');
    const close = outbox.find((e) => e.type === 'shift_close')!.doc.payload as unknown as ShiftClosePayload;
    expect(close.cash[0]).toMatchObject({ countedMinor: 200_000 });
  });

  it('sums returns, gift vouchers and drawer movements of the shift for the report', () => {
    const entry = (type: string, payload: Record<string, unknown>) =>
      ({ seq: 1, type, doc: { id: type, type, number: null, deviceTime: '', payload } }) as never;
    const refund = { method: 'card', currency: 'SYP', amountMinor: 700, reference: 'r' };
    const activity = shiftActivity('S', [
      entry('return', { shiftId: 'S', refunds: [refund, { ...refund, amountMinor: 300 }] }),
      entry('return', { shiftId: 'S', refunds: [{ ...refund, method: 'cash', reference: null }] }),
      entry('return', { shiftId: 'OTHER', refunds: [refund] }),
      entry('gift_voucher', { shiftId: 'S', currency: 'SYP', amountMinor: 5_000, method: 'cash' }),
      entry('gift_voucher', { shiftId: 'S', currency: 'SYP', amountMinor: 1_000, method: 'card' }),
      entry('cash_movement', {
        shiftId: 'S',
        kind: 'pay_out',
        currency: 'SYP',
        amountMinor: 200,
        reason: 'مصروف',
      }),
    ]);
    expect(activity.returns).toEqual({
      count: 2,
      byMethod: [
        { method: 'card', currency: 'SYP', amountMinor: 1_000 },
        { method: 'cash', currency: 'SYP', amountMinor: 700 },
      ],
    });
    expect(activity.vouchers).toEqual({ count: 2, byCurrency: [{ currency: 'SYP', amountMinor: 6_000 }] });
    expect(activity.movements).toEqual([
      { kind: 'pay_out', currency: 'SYP', amountMinor: 200, reason: 'مصروف' },
    ]);
  });
});

describe('payment rules', () => {
  async function payByCard(options: Parameters<typeof renderPos>[0]) {
    const local = memoryLocal();
    await openShift(local);
    const pos = renderPos({ ...options, local });
    await signIn(pos.user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(pos.user, PRODUCTS.oil.barcode!.code);
    await pos.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await pos.user.click(within(pay).getByRole('button', { name: /بطاقة/ }));
    return { ...pos, pay };
  }

  it('a card payment needs no approval number by default', async () => {
    const { user, pay, outbox } = await payByCard({});
    expect(within(pay).getByLabelText(/رقم الموافقة من جهاز الدفع \(اختياري\)/)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.payments[0]).toMatchObject({ method: 'card', reference: null });
  });

  it('the store can require the approval number again', async () => {
    const { user, pay } = await payByCard({
      sets: setsWith({ till: { returnWindowDays: null, cardApprovalRequired: true } }),
    });
    expect(within(pay).getByLabelText('رقم الموافقة من جهاز الدفع')).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: /أتمّ الدفع/ })).toBeDisabled();
    await user.type(within(pay).getByLabelText('رقم الموافقة من جهاز الدفع'), '731205');
    expect(within(pay).getByRole('button', { name: /أتمّ الدفع/ })).toBeEnabled();
  });

  it('a cashier sells on account with a manager’s code, recorded on the sale', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'اختر الزبون' }));
    await user.click(within(pay).getByRole('button', { name: /أم سامر/ }));
    expect(within(pay).queryByRole('button', { name: 'آجل على الحساب' })).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: 'على الحساب (بموافقة المدير)' }));
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    expect(await screen.findByRole('region', { name: 'رمز المدير' })).toBeInTheDocument();
    expect(outbox.some((e) => e.type === 'sale')).toBe(false);
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload & {
      creditApproval: { userId: string };
    };
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.payments[0]).toMatchObject({ method: 'credit', amountMinor: 25_000 });
    expect(sale.creditApproval.userId).toBe(ids.maryam);
  });
});

describe('gift vouchers', () => {
  it('opens with the amount field focused', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'قسيمة هدية' }));
    await screen.findByRole('heading', { name: 'قسيمة هدية' });
    expect(screen.getByLabelText('المبلغ')).toHaveFocus();
    // The digits go straight into it
    await user.keyboard('500');
    expect(screen.getByLabelText('المبلغ')).toHaveValue('500');
  });
});

describe('«التعديلات»: the deposit, the delivery and the late ones', () => {
  const TICKET: AlterationTicket = {
    id: 't-1',
    number: 'ALT-000001',
    status: 'ready',
    customerName: 'سلمى',
    phone: '+963933111222',
    item: 'بنطال جينز أسود',
    work: 'تقصير 3 سم',
    currency: 'SYP',
    priceMinor: 150_000,
    dueDate: '2020-01-02',
    note: null,
    depositMinor: 50_000,
    depositVoucher: 'GFT-001-002-0000001',
    createdAt: '2026-11-04T10:00:00.000Z',
    readyAt: null,
    deliveredAt: null,
    version: 2,
  };

  function server(initial: AlterationTicket[]) {
    const list = [...initial];
    const staff = staffServer();
    const sent: { url: string; body: unknown }[] = [];
    const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (!path.startsWith('/v1/device/alterations')) return staff(url, init);
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      sent.push({ url: path, body });
      if (path === '/v1/device/alterations' && !body) {
        return new Response(JSON.stringify({ items: list }), { status: 200 });
      }
      if (path === '/v1/device/alterations') {
        const made = { ...TICKET, ...(body as object), id: 't-9', number: 'ALT-000009', status: 'received' };
        list.push(made as AlterationTicket);
        return new Response(JSON.stringify(made), { status: 201 });
      }
      return new Response(JSON.stringify({ ...TICKET, status: 'delivered' }), { status: 200 });
    });
    return { fetch: fn as unknown as typeof fetch, sent };
  }

  async function open(user: Pos['user']) {
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'التعديلات' }));
  }

  it('takes a deposit as a gift voucher in cash, and the ticket carries its code', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server([]);
    const { user, outbox } = renderPos({ local, fetch });
    await open(user);
    const form = await screen.findByRole('region', { name: 'تذكرة جديدة' });
    await user.type(within(form).getByLabelText('اسم الزبون'), 'سلمى');
    await user.type(within(form).getByLabelText('جوال الزبون'), '0933111222');
    await user.type(within(form).getByLabelText('القطعة'), 'بنطال');
    await user.type(within(form).getByLabelText('المطلوب'), 'تقصير');
    await user.type(within(form).getByLabelText('الأجرة'), '1500');
    await user.type(within(form).getByLabelText('العربون (اختياري)'), '2000');
    expect(within(form).getByText('العربون أكبر من الأجرة')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'سجّل واطبع التذكرة' })).toBeDisabled();
    await user.clear(within(form).getByLabelText('العربون (اختياري)'));
    await user.type(within(form).getByLabelText('العربون (اختياري)'), '500');
    await user.click(within(form).getByRole('button', { name: 'سجّل واطبع التذكرة' }));
    await screen.findByRole('listitem', { name: 'التذكرة ALT-000009' });

    const gift = outbox.find((e) => e.type === 'gift_voucher')!;
    expect(gift.doc.payload as unknown as GiftVoucherPayload).toMatchObject({
      amountMinor: 50_000,
      method: 'cash',
      forName: 'سلمى',
    });
    expect(sent.find((s) => s.body)?.body).toMatchObject({
      priceMinor: 150_000,
      depositMinor: 50_000,
      depositVoucher: gift.doc.number,
    });
    const slip = document.querySelector('[data-print-receipt]') as HTMLElement;
    expect(slip).toHaveTextContent('العربون');
    expect(slip).toHaveTextContent('المتبقي عند الاستلام');
    expect(slip).toHaveTextContent(gift.doc.number!);
  });

  it('highlights a late ticket, writes its date as the product does, and «سُلّمت» opens the sale of the fee with the deposit voucher', async () => {
    const local = memoryLocal();
    await openShift(local);
    const service = product('تقصير', 10_000, null);
    const base = posSets();
    const sets = {
      ...base,
      products: [...base.products, service.product],
      variants: [...base.variants, service.variant],
      prices: [...base.prices, service.price],
    };
    const { fetch, sent } = server([TICKET]);
    const { user, outbox } = renderPos({ local, fetch, sets });
    await open(user);
    const card = await screen.findByRole('listitem', { name: 'التذكرة ALT-000001' });
    expect(within(card).getByText('متأخرة')).toBeInTheDocument();
    expect(card).toHaveTextContent('2 كانون الثاني 2020');
    expect(card).toHaveTextContent('المتبقي');

    await user.click(within(card).getByRole('button', { name: 'سُلّمت' }));
    // The sale screen holds the fee as the «تقصير» line; the ticket is not delivered until it sells
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(sent.some((s) => s.url.endsWith('/status'))).toBe(false);
    expect(screen.getByText(/تقصير · ALT-000001/)).toBeInTheDocument();
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    // The deposit voucher is the payment method waiting, its code in place
    expect(within(pay).getByLabelText('رقم القسيمة')).toHaveValue('GFT-001-002-0000001');
    await user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
    await user.keyboard('1500{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.totals.totalMinor).toBe(150_000);
    await vi.waitFor(() =>
      expect(sent.at(-1)).toMatchObject({
        url: '/v1/device/alterations/t-1/status',
        body: { status: 'delivered', version: 2 },
      }),
    );
  });

  it('says what is missing when the store sells no «تقصير» service', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch } = server([TICKET]);
    const { user } = renderPos({ local, fetch });
    await open(user);
    const card = await screen.findByRole('listitem', { name: 'التذكرة ALT-000001' });
    await user.click(within(card).getByRole('button', { name: 'سُلّمت' }));
    expect(await screen.findByText(/لا يوجد صنف خدمة اسمه «تقصير»/)).toBeInTheDocument();
  });
});
