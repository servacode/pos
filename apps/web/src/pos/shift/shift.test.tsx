import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashMovementPayload,
  ShiftClosePayload,
  ShiftOpenPayload,
} from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan, SHIFT_ID } from '../../test/renderPos';
import { closeDrawer, shiftActivity } from './shift';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

async function signIn(user: ReturnType<typeof renderPos>['user'], name: 'سامر' | 'مريم') {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: new RegExp(name) }));
  await user.keyboard(PINS[name === 'سامر' ? ids.samer : ids.maryam]!);
}

const docsOf = <T,>(outbox: ReturnType<typeof renderPos>['outbox'], type: string) =>
  outbox.filter((e) => e.type === type).map((e) => ({ entry: e, payload: e.doc.payload as unknown as T }));

describe('shift', () => {
  it('opens with the counted drawers and saves shift_open (SFT) before the first sale', async () => {
    const { user, outbox, local } = renderPos();
    await signIn(user, 'سامر');
    expect(await screen.findByRole('heading', { name: 'افتح الوردية' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('عدد أوراق 500 ل.س'), '2');
    await user.click(screen.getByRole('button', { name: 'زِد 100 ل.س' }));
    await user.type(screen.getByLabelText('عدد أوراق 20 $'), '1');
    await user.click(screen.getByRole('button', { name: 'افتح الوردية' }));

    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    const [open] = docsOf<ShiftOpenPayload>(outbox, 'shift_open');
    expect(open!.entry.doc.number).toBe('SFT-001-002-0000001');
    expect(validateDocumentPayload('shift_open', open!.payload)).toEqual({ ok: true, checked: true });
    expect(open!.payload).toEqual({
      openedBy: ids.samer,
      mode: 'per_cashier',
      handoverFromShiftId: null,
      opening: [
        {
          currency: 'SYP',
          amountMinor: 110_000,
          denominations: [
            { valueMinor: 50_000, count: 2 },
            { valueMinor: 10_000, count: 1 },
          ],
        },
        { currency: 'USD', amountMinor: 2_000, denominations: [{ valueMinor: 2_000, count: 1 }] },
      ],
    });
    expect(await local.get(`shift:${ids.samer}`)).toMatchObject({ id: open!.entry.doc.id });
    expect(screen.getByText(/وردية منذ/)).toBeInTheDocument();
  });

  it('closes blind for a cashier: no expected amount, and shift_close carries every term', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'سامر');
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('1000{Enter}');
    void pay;
    await screen.findByRole('region', { name: 'تمت البيعة' });

    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    expect(
      await screen.findByText('عدّ أعمى: لا يظهر المبلغ المتوقع. عُدّ ما في يدك فقط.'),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'تخطَّ العدّ واكتب المجموع' })[0]!);
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '240');
    await user.click(screen.getByRole('button', { name: 'تابع للملخّص' }));

    expect(await screen.findByRole('heading', { name: 'ملخّص الوردية' })).toBeInTheDocument();
    expect(screen.getByText('المتوقع والفرق يراهما المدير فقط.')).toBeInTheDocument();
    expect(screen.queryByText(/المتوقع/, { selector: 'span' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أغلق الوردية' }));

    expect(await screen.findByRole('heading', { name: 'من يعمل الآن؟' })).toBeInTheDocument();
    const [close] = docsOf<ShiftClosePayload>(outbox, 'shift_close');
    expect(validateDocumentPayload('shift_close', close!.payload)).toEqual({ ok: true, checked: true });
    expect(close!.entry.doc.number).toBeNull();
    expect(close!.payload).toMatchObject({
      shiftId: SHIFT_ID,
      shiftNumber: 'SFT-001-002-0000001',
      closedBy: ids.samer,
    });
    expect(close!.payload.cash[0]).toMatchObject({
      currency: 'SYP',
      openingMinor: 0,
      cashInMinor: 100_000,
      changeOutMinor: 75_000,
      expectedMinor: 25_000,
      countedMinor: 24_000,
      differenceMinor: -1_000,
      differenceBaseMinor: -1_000,
    });
    expect(close!.payload.summary).toEqual({
      saleCount: 1,
      byMethod: [{ method: 'cash', currency: 'SYP', count: 1, amountMinor: 25_000 }],
    });
  });

  it('shows the expected cash and the difference to a manager', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const { user } = renderPos({ local });
    await signIn(user, 'مريم');
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'أغلق الوردية' }));
    await user.click(await screen.findByRole('button', { name: 'تابع للملخّص' }));
    await screen.findByRole('heading', { name: 'ملخّص الوردية' });
    expect(plain(document.body)).toContain('المتوقع 0 ل.س · الفرق 0 ل.س');
  });

  it('records a pay-in with its reason and the manager code (cash_movement)', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    await signIn(user, 'سامر');
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.keyboard('{Alt>}7{/Alt}');

    expect(await screen.findByRole('heading', { name: 'حركات الدرج' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /إيداع في الدرج/ }));
    await user.type(screen.getByLabelText('المبلغ'), '5000');
    const record = screen.getByRole('button', { name: /سجّل الحركة/ });
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText('السبب'), 'فكّة من الخزنة');
    await user.click(screen.getByRole('button', { name: /سجّل الحركة/ }));
    expect(screen.getByRole('region', { name: 'رمز المدير' })).toBeInTheDocument();
    await user.keyboard(PINS[ids.maryam]!);

    const list = await screen.findByRole('region', { name: 'حركات هذه الوردية' });
    await vi.waitFor(() => expect(list).toHaveTextContent('بانتظار الإرسال'));
    const [move] = docsOf<CashMovementPayload>(outbox, 'cash_movement');
    expect(move!.entry.doc.number).toBe('CSH-001-002-0000001');
    expect(validateDocumentPayload('cash_movement', move!.payload)).toEqual({ ok: true, checked: true });
    expect(move!.payload).toMatchObject({
      shiftId: SHIFT_ID,
      kind: 'pay_in',
      currency: 'SYP',
      amountMinor: 500_000,
      baseAmountMinor: 500_000,
      rate: null,
      reason: 'فكّة من الخزنة',
      expenseAccountCode: null,
      performedBy: ids.samer,
      approval: { userId: ids.maryam, method: 'pin', offline: false },
    });
  });
});

describe('the drawer formula (10 › مطابقة الصندوق)', () => {
  it('sums cash in, change, pay-ins, pay-outs and drops per currency', () => {
    const doc = (type: string, payload: Record<string, unknown>, seq: number) =>
      ({ seq, type, doc: { type, payload } }) as never;
    const activity = shiftActivity(SHIFT_ID, [
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          payments: [
            { method: 'cash', currency: 'USD', amountMinor: 900 },
            { method: 'cash', currency: 'SYP', amountMinor: 20_000 },
          ],
          change: { currency: 'SYP', amountMinor: 8_000 },
        },
        1,
      ),
      doc(
        'sale',
        { shiftId: 'other', payments: [{ method: 'cash', currency: 'SYP', amountMinor: 99 }], change: null },
        2,
      ),
      doc('cash_movement', { shiftId: SHIFT_ID, kind: 'pay_in', currency: 'SYP', amountMinor: 5_000 }, 3),
      doc('cash_movement', { shiftId: SHIFT_ID, kind: 'pay_out', currency: 'SYP', amountMinor: 1_000 }, 4),
      doc('cash_movement', { shiftId: SHIFT_ID, kind: 'safe_drop', currency: 'USD', amountMinor: 500 }, 5),
    ]);
    expect(activity.saleCount).toBe(1);
    const rates = [{ unit: 'USD' as const, quote: 'SYP' as const, rate: '130' }];
    const syp = closeDrawer('SYP', 'SYP', rates, 10_000, activity.terms.get('SYP'), {
      currency: 'SYP',
      notes: null,
      totalMinor: 26_000,
    });
    expect(syp).toMatchObject({ expectedMinor: 10_000 + 20_000 - 8_000 + 5_000 - 1_000, differenceMinor: 0 });
    const usd = closeDrawer('USD', 'SYP', rates, 0, activity.terms.get('USD'), {
      currency: 'USD',
      notes: null,
      totalMinor: 300,
    });
    expect(usd).toMatchObject({ expectedMinor: 400, differenceMinor: -100, differenceBaseMinor: -13_000 });
  });
});
