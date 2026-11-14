import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptPayload, SalePayload, ShiftClosePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan, SHIFT_ID } from '../../test/renderPos';
import { findCustomers } from './CustomerPicker';

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

describe('selling on credit', () => {
  it('a manager picks the customer, sells on credit, and the sale names them', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).queryByRole('button', { name: 'آجل على الحساب' })).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    await user.click(within(pay).getByRole('button', { name: 'آجل على الحساب' }));
    expect(pay).toHaveTextContent('يُسجَّل المبلغ ديناً على أبو خالد');
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });

    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale).toMatchObject({
      customerId: ids.abuKhaled,
      customerName: 'أبو خالد',
      payments: [{ method: 'credit', currency: 'SYP', amountMinor: 25_000, reference: null }],
    });
  });

  it('a cashier without «البيع بالآجل» can name the customer but not sell on credit', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await signIn(user, 'سامر');
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'اختر الزبون' }));
    await user.click(within(pay).getByRole('button', { name: /أم سامر/ }));
    expect(within(pay).queryByRole('button', { name: 'آجل على الحساب' })).not.toBeInTheDocument();
  });

  it('adds a new customer on the till as a customer document', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'مريم');
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.click(within(pay).getByRole('button', { name: 'زبون جديد' }));
    await user.type(within(pay).getByLabelText('اسم الزبون'), 'أبو علي');
    await user.type(within(pay).getByLabelText('الجوال (اختياري)'), '0944555666');
    await user.click(within(pay).getByRole('button', { name: 'احفظ واختره' }));
    expect(await within(pay).findByText('أبو علي')).toBeInTheDocument();
    const created = outbox.find((e) => e.type === 'customer')!;
    expect(created.doc.payload).toEqual({ name: 'أبو علي', phone: '+963944555666', createdBy: ids.maryam });
  });
});

describe('«قبض من زبون»', () => {
  it('takes a payment in cash, prints the voucher, and the close counts it in the drawer', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'سامر');
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'قبض من زبون' }));
    expect(await screen.findByRole('heading', { name: 'قبض من زبون' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /أبو خالد/ }));
    await user.type(screen.getByLabelText('المبلغ'), '100');
    await user.click(screen.getByRole('button', { name: /سجّل القبض/ }));
    expect(await screen.findByRole('heading', { name: 'سُجّل القبض' })).toBeInTheDocument();
    expect(window.print).toHaveBeenCalled();
    const entry = outbox.find((e) => e.type === 'receipt')!;
    expect(entry.doc.number).toBe('RCV-001-002-0000001');
    const payload = entry.doc.payload as unknown as ReceiptPayload;
    expect(validateDocumentPayload('receipt', payload)).toEqual({ ok: true, checked: true });
    expect(payload).toEqual({
      customerId: ids.abuKhaled,
      customerName: 'أبو خالد',
      shiftId: SHIFT_ID,
      cashierId: ids.samer,
      currency: 'SYP',
      amountMinor: 10_000,
      method: 'cash',
      reference: null,
      note: null,
    });

    await user.click(screen.getAllByRole('button', { name: 'ارجع للبيع' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    await user.click((await screen.findAllByRole('button', { name: 'تخطَّ العدّ واكتب المجموع' }))[0]!);
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '100');
    await user.click(screen.getByRole('button', { name: 'تابع للملخّص' }));
    await user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    await user.click(await screen.findByRole('button', { name: 'نعم، أغلق الوردية' }));
    await user.click(await screen.findByRole('button', { name: 'تمّ، اخرج' }));
    await screen.findByRole('heading', { name: 'من يعمل الآن؟' });
    const close = outbox.find((e) => e.type === 'shift_close')!.doc.payload as unknown as ShiftClosePayload;
    expect(close.cash[0]).toMatchObject({ receiptsMinor: 10_000, expectedMinor: 10_000, differenceMinor: 0 });
  });

  it('a wallet payment needs its reference', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'سامر');
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'قبض من زبون' }));
    await user.click(await screen.findByRole('button', { name: /أم سامر/ }));
    await user.type(screen.getByLabelText('المبلغ'), '50');
    await user.click(screen.getByRole('button', { name: 'شام كاش' }));
    expect(screen.getByRole('button', { name: /سجّل القبض/ })).toBeDisabled();
    await user.type(screen.getByLabelText('رقم العملية'), 'SC-9');
    await user.click(screen.getByRole('button', { name: /سجّل القبض/ }));
    await screen.findByRole('heading', { name: 'سُجّل القبض' });
    expect(outbox.find((e) => e.type === 'receipt')!.doc.payload).toMatchObject({
      method: 'wallet',
      reference: 'SC-9',
      customerId: ids.ummSamer,
    });
  });
});

describe('finding a customer', () => {
  it('by part of the name, Arabic letters normalised, or by the phone’s digits', () => {
    const list = [
      {
        id: '1',
        name: 'أبو خالد',
        phone: '+963933111222',
        creditLimitMinor: null,
        priceTier: 'retail' as const,
        loyaltyPoints: 0,
        archived: false,
        version: 1,
      },
      {
        id: '2',
        name: 'مطعم الياسمين',
        phone: null,
        creditLimitMinor: null,
        priceTier: 'retail' as const,
        loyaltyPoints: 0,
        archived: false,
        version: 1,
      },
    ];
    expect(findCustomers(list, 'ابو').map((c) => c.id)).toEqual(['1']);
    expect(findCustomers(list, '0933111').map((c) => c.id)).toEqual(['1']);
    expect(findCustomers(list, '٠٩٣٣').map((c) => c.id)).toEqual(['1']);
    expect(findCustomers(list, 'ياسمين').map((c) => c.id)).toEqual(['2']);
    expect(findCustomers(list, '')).toHaveLength(2);
  });
});
