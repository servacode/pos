import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReturnPayload, SalePayload, ShiftClosePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan, SHIFT_ID } from '../../test/renderPos';
import { matchesNumber, returnableSales } from './returns';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function signIn(user: ReturnType<typeof renderPos>['user'], name: 'سامر' | 'مريم') {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: new RegExp(name) }));
  await user.keyboard(PINS[name === 'سامر' ? ids.samer : ids.maryam]!);
}

/** Two bottles of oil sold for cash, 500.00 */
async function sellTwoOils(user: ReturnType<typeof renderPos>['user']) {
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(user, PRODUCTS.oil.barcode!.code);
  await scan(user, PRODUCTS.oil.barcode!.code);
  await user.keyboard('{F12}');
  await screen.findByRole('region', { name: 'الدفع' });
  await user.keyboard('500{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('«مرتجع» on the till', () => {
  it('returns one of two pieces with the manager’s code, prints the slip, and the close pays it out', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'سامر');
    await sellTwoOils(user);
    const sale = outbox.find((e) => e.type === 'sale')!;

    await user.keyboard('{Alt>}r{/Alt}');
    expect(await screen.findByRole('heading', { name: 'مرتجع' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('رقم الفاتورة'), '1');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    const record = screen.getByRole('button', { name: 'سجّل المرتجع' });
    expect(record).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.getByRole('status', { name: 'المبلغ المردود' })).toHaveTextContent('250');
    await user.click(record);
    // A cashier without «المرتجعات» needs the manager
    expect(screen.getByRole('region', { name: 'رمز المدير' })).toBeInTheDocument();
    await user.keyboard(PINS[ids.maryam]!);

    expect(await screen.findByRole('heading', { name: 'سُجّل المرتجع' })).toBeInTheDocument();
    expect(window.print).toHaveBeenCalled();
    const ret = outbox.find((e) => e.type === 'return')!;
    expect(ret.doc.number).toBe('SRT-001-002-0000001');
    expect(ret.doc.deps).toEqual([sale.doc.id]);
    const payload = ret.doc.payload as unknown as ReturnPayload;
    expect(validateDocumentPayload('return', payload)).toEqual({ ok: true, checked: true });
    expect(payload).toMatchObject({
      saleId: sale.doc.id,
      saleNumber: 'INV-001-002-0000001',
      shiftId: SHIFT_ID,
      cashierId: ids.samer,
      reason: 'تالف أو منتهي الصلاحية',
      lines: [{ saleLineNo: 1, qty: 1000 }],
      totals: { totalMinor: 25_000 },
      refunds: [{ method: 'cash', currency: 'SYP', amountMinor: 25_000, reference: null }],
      approval: { userId: ids.maryam, method: 'pin' },
    });

    // The second piece is all that is left; then nothing is
    await user.click(screen.getByRole('button', { name: 'مرتجع آخر من نفس الفاتورة' }));
    await user.click(await screen.findByRole('button', { name: 'الكل' }));
    expect(screen.getByRole('status', { name: 'المبلغ المردود' })).toHaveTextContent('250');

    await user.click(screen.getByRole('button', { name: 'ارجع للبيع' }));
    await user.click(await screen.findByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    await user.click((await screen.findAllByRole('button', { name: 'تخطَّ العدّ واكتب المجموع' }))[0]!);
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '250');
    await user.click(screen.getByRole('button', { name: 'تابع للملخّص' }));
    await user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    await screen.findByRole('heading', { name: 'من يعمل الآن؟' });
    const close = outbox.find((e) => e.type === 'shift_close')!.doc.payload as unknown as ShiftClosePayload;
    expect(close.cash[0]).toMatchObject({
      cashInMinor: 50_000,
      refundsMinor: 25_000,
      expectedMinor: 25_000,
      differenceMinor: 0,
    });
  });

  it('a manager returns alone, to the card the sale was paid with, with its reference', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /بطاقة/ }));
    const ref = within(pay).queryByLabelText(/رقم العملية|المرجع|الموافقة/);
    if (ref) await user.type(ref, 'A77');
    await user.click(within(pay).getByRole('button', { name: /أكّد|تمّ|إتمام|ادفع/ }));
    await screen.findByRole('region', { name: 'تمت البيعة' });

    await user.keyboard('{Alt>}r{/Alt}');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    expect(screen.getByRole('button', { name: 'إلى البطاقة' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'الكل' }));
    expect(screen.getByRole('button', { name: 'سجّل المرتجع' })).toBeDisabled();
    await user.type(screen.getByLabelText('رقم العملية'), 'R-12');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    const payload = outbox.find((e) => e.type === 'return')!.doc.payload as unknown as ReturnPayload;
    expect(payload.refunds).toEqual([
      { method: 'card', currency: 'SYP', amountMinor: 25_000, reference: 'R-12' },
    ]);
    expect(payload.approval).toBeNull();
  });
});

describe('«استبدال» on the till (03 › الملابس)', () => {
  it('returns a piece on a voucher, sells the other one with it, and takes the rest in cash', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await sellTwoOils(user);

    await user.keyboard('{Alt>}r{/Alt}');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    await user.click(screen.getByRole('button', { name: 'على قسيمة استبدال' }));
    // No reference to type: the voucher's code is the return's number
    expect(screen.queryByLabelText('رقم العملية')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'المبلغ المردود' })).toHaveTextContent('مبلغ القسيمة');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    const ret = outbox.find((e) => e.type === 'return')!;
    expect((ret.doc.payload as unknown as ReturnPayload).refunds).toEqual([
      { method: 'voucher', currency: 'SYP', amountMinor: 25_000, reference: null },
    ]);
    // The slip carries the voucher with its barcode
    const slip = document.querySelector('[data-print-receipt]')!;
    expect(within(slip as HTMLElement).getByRole('region', { name: 'قسيمة الاستبدال' })).toHaveTextContent(
      'SRT-001-002-0000001',
    );
    expect(
      within(slip as HTMLElement).getByRole('img', { name: 'باركود SRT-001-002-0000001' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'بيع البديل بالقسيمة' }));
    expect(await screen.findByText(/تُخصم عند الدفع/)).toBeInTheDocument();
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    // The voucher's 250 is in; the 100 left is paid in cash
    const parts = await within(pay).findByRole('list', { name: 'الأجزاء المدفوعة' });
    expect(parts).toHaveTextContent('قسيمة استبدال');
    expect(parts).toHaveTextContent('250');
    await user.keyboard('100{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const exchange = outbox.filter((e) => e.type === 'sale')[1]!;
    const payload = exchange.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', payload)).toEqual({ ok: true, checked: true });
    expect(payload.payments).toEqual([
      expect.objectContaining({ method: 'voucher', amountMinor: 25_000, reference: 'SRT-001-002-0000001' }),
      expect.objectContaining({ method: 'cash', amountMinor: 10_000 }),
    ]);
  });

  it('a voucher over the price pays it all, keeps the rest, and is found by its last digits', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await sellTwoOils(user);
    await user.keyboard('{Alt>}r{/Alt}');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    await user.click(screen.getByRole('button', { name: 'الكل' }));
    await user.click(screen.getByRole('button', { name: 'على قسيمة استبدال' }));
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    await user.click(screen.getAllByRole('button', { name: 'ارجع للبيع' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'بيعة جديدة' }));

    // Tea for 350 from a 500 voucher, typed by its last digits
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    let pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'قسيمة استبدال' }));
    await user.type(within(pay).getByLabelText('رقم القسيمة'), '1');
    expect(within(pay).getByRole('status', { name: 'رصيد القسيمة' })).toHaveTextContent('500');
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const first = outbox.filter((e) => e.type === 'sale')[1]!.doc.payload as unknown as SalePayload;
    expect(first.payments).toEqual([
      expect.objectContaining({ method: 'voucher', amountMinor: 35_000, reference: 'SRT-001-002-0000001' }),
    ]);

    // 150 is left on it; more than that is refused
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F12}');
    pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'قسيمة استبدال' }));
    await user.type(within(pay).getByLabelText('رقم القسيمة'), 'SRT-001-002-0000001');
    expect(within(pay).getByRole('status', { name: 'رصيد القسيمة' })).toHaveTextContent('150');
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeDisabled();
    await user.clear(within(pay).getByLabelText('رقم القسيمة'));
    await user.type(within(pay).getByLabelText('رقم القسيمة'), '9');
    expect(within(pay).getByText(/لا قسيمة بهذا الرقم/)).toBeInTheDocument();
  });
});

describe('the invoices a till can return from', () => {
  it('keeps the last week, newest first, with what was already returned', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    const entry = (id: string, type: string, deviceTime: string, payload: unknown, number: string | null) =>
      ({ seq: 1, type, doc: { id, type, number, deviceTime, payload } }) as never;
    const sales = returnableSales(
      [
        entry('a', 'sale', '2026-10-20T10:00:00Z', { totals: {} }, 'INV-001-002-0000001'),
        entry('b', 'sale', '2026-10-30T10:00:00Z', { totals: {} }, 'INV-001-002-0000002'),
        entry('c', 'sale', '2026-10-31T10:00:00Z', { totals: {} }, 'INV-001-002-0000003'),
        entry(
          'r',
          'return',
          '2026-10-31T11:00:00Z',
          { saleId: 'b', lines: [{ saleLineNo: 1, qty: 1000, refund: { totalMinor: 5 } }] },
          'SRT-001-002-0000001',
        ),
      ],
      now,
    );
    expect(sales.map((s) => s.id)).toEqual(['c', 'b']);
    expect(sales[1]!.returned).toEqual([{ saleLineNo: 1, qty: 1000, totalMinor: 5 }]);
    expect(matchesNumber('INV-001-002-0000154', '154')).toBe(true);
    expect(matchesNumber('INV-001-002-0000154', '١٥٤')).toBe(true);
    expect(matchesNumber('INV-001-002-0000154', '155')).toBe(false);
  });
});
