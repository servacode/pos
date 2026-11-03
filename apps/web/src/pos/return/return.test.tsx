import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReturnPayload, ShiftClosePayload } from '@serva/core/contracts/documents';
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
