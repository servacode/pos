import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiftVoucherPayload, SalePayload, ShiftClosePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan, SHIFT_ID } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function signIn(user: ReturnType<typeof renderPos>['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
}

describe('«قسيمة هدية» (03 › الألبسة)', () => {
  it('sells a voucher for cash, prints it with its bars, spends part of it, and the close counts its cash', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'قسيمة هدية' }));
    expect(await screen.findByRole('heading', { name: 'قسيمة هدية' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('المبلغ'), '500');
    await user.type(screen.getByLabelText('إلى (اختياري)'), 'سارة');
    await user.click(screen.getByRole('button', { name: /سجّل القسيمة/ }));
    expect(await screen.findByRole('heading', { name: 'سُجّلت القسيمة' })).toBeInTheDocument();
    expect(window.print).toHaveBeenCalled();
    const entry = outbox.find((e) => e.type === 'gift_voucher')!;
    expect(entry.doc.number).toBe('GFT-001-002-0000001');
    const payload = entry.doc.payload as unknown as GiftVoucherPayload;
    expect(validateDocumentPayload('gift_voucher', payload)).toEqual({ ok: true, checked: true });
    expect(payload).toEqual({
      shiftId: SHIFT_ID,
      cashierId: ids.samer,
      currency: 'SYP',
      amountMinor: 50_000,
      method: 'cash',
      reference: null,
      forName: 'سارة',
    });
    const slip = document.querySelector('[data-print-receipt]') as HTMLElement;
    expect(within(slip).getByRole('region', { name: 'قسيمة الهدية' })).toHaveTextContent('إلى سارة');
    expect(within(slip).getByRole('img', { name: 'باركود GFT-001-002-0000001' })).toBeInTheDocument();

    // Oil for 250, paid by the voucher typed by its last digits
    await user.click(screen.getAllByRole('button', { name: 'ارجع للبيع' })[0]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(await within(pay).findByRole('button', { name: 'قسيمة' }));
    await user.type(within(pay).getByLabelText('رقم القسيمة'), '1');
    expect(within(pay).getByRole('status', { name: 'رصيد القسيمة' })).toHaveTextContent('500');
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.payments).toEqual([
      expect.objectContaining({ method: 'voucher', amountMinor: 25_000, reference: 'GFT-001-002-0000001' }),
    ]);

    // The 500 in cash is in the drawer; the sale paid by voucher put none in
    await user.click(screen.getByRole('button', { name: 'بيعة جديدة' }));
    await user.click(await screen.findByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    await user.click((await screen.findAllByRole('button', { name: 'تخطَّ العدّ واكتب المجموع' }))[0]!);
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '500');
    await user.click(screen.getByRole('button', { name: 'تابع للملخّص' }));
    await user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    await screen.findByRole('heading', { name: 'من يعمل الآن؟' });
    const close = outbox.find((e) => e.type === 'shift_close')!.doc.payload as unknown as ShiftClosePayload;
    expect(close.cash[0]).toMatchObject({ receiptsMinor: 50_000, expectedMinor: 50_000, differenceMinor: 0 });
  });

  it('a card payment needs its reference', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await signIn(user);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'قسيمة هدية' }));
    await user.type(await screen.findByLabelText('المبلغ'), '100');
    await user.click(screen.getByRole('button', { name: 'بطاقة' }));
    expect(screen.getByRole('button', { name: /سجّل القسيمة/ })).toBeDisabled();
    await user.type(screen.getByLabelText('رقم العملية'), 'A-1');
    expect(screen.getByRole('button', { name: /سجّل القسيمة/ })).toBeEnabled();
  });
});
