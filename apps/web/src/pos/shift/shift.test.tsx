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
import { ids, PINS, posSets, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan, SHIFT_ID } from '../../test/renderPos';
import { closeDrawer, netMethodRows, notesFor, refundVouchers, shiftActivity } from './shift';

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

/** A shift opens on one amount per drawer; the notes are counted one by one behind «عدّ تفصيلي» */
async function countByNotes(user: ReturnType<typeof renderPos>['user']) {
  for (const button of await screen.findAllByRole('button', { name: 'عدّ تفصيلي' })) await user.click(button);
}

describe('shift', () => {
  it('opens with the counted drawers and saves shift_open (SFT) before the first sale', async () => {
    const { user, outbox, local } = renderPos();
    await signIn(user, 'سامر');
    expect(await screen.findByRole('heading', { name: 'افتح الوردية' })).toBeInTheDocument();
    await countByNotes(user);

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

  it('opens on one amount per drawer: «اكتب المجموع» is the default, no note-by-note rows until asked', async () => {
    const { user, outbox } = renderPos();
    await signIn(user, 'سامر');
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    expect(screen.queryByLabelText(/^عدد أوراق/)).not.toBeInTheDocument();
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '5000');
    await user.click(screen.getByRole('button', { name: 'افتح الوردية' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    const [open] = docsOf<ShiftOpenPayload>(outbox, 'shift_open');
    expect(open!.payload.opening[0]).toMatchObject({ currency: 'SYP', amountMinor: 500_000 });
  });

  it('a double click on «افتح الوردية» opens one shift, not two', async () => {
    const { user, outbox } = renderPos();
    await signIn(user, 'سامر');
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    await user.dblClick(screen.getByRole('button', { name: 'افتح الوردية' }));
    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    expect(docsOf<ShiftOpenPayload>(outbox, 'shift_open')).toHaveLength(1);
  });

  it('asks again before saving an opening count far above the usual one', async () => {
    const { user, outbox, local } = renderPos();
    // Last time the drawer opened with 1,100 ل.س; now a slipped key makes it 100 times that
    await local.set('lastOpeningCount', { SYP: 110_000, USD: 0 });
    await signIn(user, 'سامر');
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    await countByNotes(user);
    await user.type(screen.getByLabelText('عدد أوراق 500 ل.س'), '300');
    await user.click(screen.getByRole('button', { name: 'افتح الوردية' }));
    expect(await screen.findByText(/أكبر بكثير من المعتاد/)).toBeInTheDocument();
    expect(docsOf<ShiftOpenPayload>(outbox, 'shift_open')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /نعم، المبلغ صحيح/ }));
    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    expect(docsOf<ShiftOpenPayload>(outbox, 'shift_open')).toHaveLength(1);
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
    // A short neutral line: the drawer holds customers' cash and deposits too (the expected amount stays hidden)
    expect(screen.getByText('عُدّ كل النقد الذي في الدرج.')).toBeInTheDocument();
    // One total per drawer, note by note behind a button, and no jargon line about the chosen note
    await screen.findAllByRole('textbox', { name: 'المجموع' });
    expect(screen.getAllByRole('button', { name: 'عدّ تفصيلي' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/الفئة المختارة/)).not.toBeInTheDocument();
    await user.type(screen.getAllByRole('textbox', { name: 'المجموع' })[0]!, '240');
    await user.click(screen.getByRole('button', { name: 'تابع للمراجعة' }));

    expect(await screen.findByRole('heading', { name: 'ملخّص الوردية' })).toBeInTheDocument();
    expect(screen.getByText('المتوقع والفرق يراهما المدير فقط.')).toBeInTheDocument();
    expect(screen.queryByText(/المتوقع/, { selector: 'span' })).not.toBeInTheDocument();
    // The sellers show whenever a sale was made, even when the cashier sold it himself
    expect(screen.getByLabelText('مرتجعات وقسائم')).toHaveTextContent('البائعون');
    await user.click(screen.getByRole('button', { name: 'أغلق الوردية' }));
    // A confirmation first, then the Z report, then the cashier leaves
    expect(screen.getByRole('alertdialog', { name: 'تأكيد إغلاق الوردية' })).toBeInTheDocument();
    expect(outbox.some((e) => e.type === 'shift_close')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'نعم، أغلق الوردية' }));
    const z = await screen.findByLabelText('تقرير إغلاق الوردية');
    // The cashier has no «shift.view_difference»: the slip carries the count, not the expected cash
    expect(z).toHaveTextContent('البائعون');
    expect(z).toHaveTextContent('المعدود');
    expect(z).not.toHaveTextContent('المتوقع');
    expect(z).not.toHaveTextContent('الفرق');
    await user.click(screen.getByRole('button', { name: 'اطبع' }));
    expect(window.print).toHaveBeenCalled();
    // One way out: «تمّ» beside the slip, and no second «اخرج»
    expect(screen.queryByRole('button', { name: 'اخرج' })).not.toBeInTheDocument();
    expect(z).not.toHaveTextContent('0 مرتجع');
    await user.click(screen.getByRole('button', { name: 'تمّ' }));

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
    await user.click(await screen.findByRole('button', { name: 'تابع للمراجعة' }));
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

describe('the close summary rows', () => {
  it('takes the cash paid back for returns off the cash row and leaves the saved summary alone', () => {
    const doc = (type: string, payload: Record<string, unknown>, seq: number) =>
      ({ seq, type, doc: { type, payload } }) as never;
    const activity = shiftActivity(SHIFT_ID, [
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: 174_100 }],
          change: null,
        },
        1,
      ),
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'cash', currency: 'SYP', amountMinor: 27_000 }] },
        2,
      ),
    ]);
    expect(netMethodRows(activity)).toEqual([
      { method: 'cash', currency: 'SYP', count: 1, amountMinor: 147_100 },
    ]);
    // The saved summary and the drawer's expected cash are what they were
    expect(activity.byMethod[0]!.amountMinor).toBe(174_100);
    expect(activity.terms.get('SYP')!.refundsMinor).toBe(27_000);
    // Cash paid back with no cash sale in the shift still shows, as a minus
    const only = shiftActivity(SHIFT_ID, [
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'cash', currency: 'SYP', amountMinor: 5_000 }] },
        1,
      ),
    ]);
    expect(netMethodRows(only)).toEqual([{ method: 'cash', currency: 'SYP', count: 0, amountMinor: -5_000 }]);
    expect(netMethodRows(null)).toEqual([]);
    // A card sale refunded to the card, and an exchange refunded on a voucher, are taken off too
    const mixed = shiftActivity(SHIFT_ID, [
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          payments: [{ method: 'card', currency: 'SYP', amountMinor: 20_000 }],
          change: null,
        },
        1,
      ),
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'card', currency: 'SYP', amountMinor: 8_000 }] },
        2,
      ),
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'voucher', currency: 'SYP', amountMinor: 3_500 }] },
        3,
      ),
    ]);
    // …but a refund voucher is not a payment taken back: no negative «قسيمة» row, it has its own line
    expect(netMethodRows(mixed)).toEqual([
      { method: 'card', currency: 'SYP', count: 1, amountMinor: 12_000 },
    ]);
    expect(refundVouchers(mixed)).toEqual([{ currency: 'SYP', amountMinor: 3_500 }]);
    expect(refundVouchers(null)).toEqual([]);
  });

  it('keeps what came into the drawer outside a sale, and a dollar payment given back in lira', () => {
    const doc = (type: string, payload: Record<string, unknown>, seq: number) =>
      ({ seq, type, doc: { type, payload } }) as never;
    const a = shiftActivity(SHIFT_ID, [
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          payments: [{ method: 'cash', currency: 'USD', amountMinor: 2_000 }],
          change: { currency: 'SYP', amountMinor: 80_000 },
        },
        1,
      ),
      doc('receipt', { shiftId: SHIFT_ID, method: 'cash', currency: 'SYP', amountMinor: 110_000 }, 2),
      doc('gift_voucher', { shiftId: SHIFT_ID, method: 'cash', currency: 'SYP', amountMinor: 50_000 }, 3),
    ]);
    expect(a.changeBack).toEqual([{ paid: 'USD', change: 'SYP', paidMinor: 2_000, changeMinor: 80_000 }]);
    expect(a.cashIn).toEqual({
      receipts: [{ currency: 'SYP', amountMinor: 110_000 }],
      vouchers: [{ currency: 'SYP', amountMinor: 50_000 }],
    });
  });
});

describe('the banknotes the counter offers', () => {
  const withTill = (till: unknown) => {
    const base = posSets();
    return { ...base, settings: [{ ...base.settings[0]!, till }] } as ReturnType<typeof posSets>;
  };

  it('falls back to the built-in notes when the store set none', () => {
    expect(notesFor(null, 'SYP')).toEqual([
      500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_500, 1_000,
    ]);
    expect(notesFor({ returnWindowDays: null, cardApprovalRequired: false }, 'USD')).toEqual([
      10_000, 5_000, 2_000, 1_000, 500, 100,
    ]);
    // Only the pound was set: the dollar keeps its own list
    const till = { returnWindowDays: null, cardApprovalRequired: false, cashNotes: { SYP: [10, 2000] } };
    expect(notesFor(till, 'SYP')).toEqual([200_000, 1_000]);
    expect(notesFor(till, 'USD')).toEqual([10_000, 5_000, 2_000, 1_000, 500, 100]);
  });

  it('counts the store’s own notes when the shift opens and saves them as before', async () => {
    const till = { returnWindowDays: null, cardApprovalRequired: false, cashNotes: { SYP: [2000, 500, 10] } };
    const { user, outbox } = renderPos({ sets: withTill(till) });
    await signIn(user, 'سامر');
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    await countByNotes(user);
    expect(screen.getByLabelText('عدد أوراق 2000 ل.س')).toBeInTheDocument();
    expect(screen.queryByLabelText('عدد أوراق 200 ل.س')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('عدد أوراق 25 ل.س')).not.toBeInTheDocument();
    // The dollar keeps the built-in list
    expect(screen.getByLabelText('عدد أوراق 20 $')).toBeInTheDocument();
    await user.type(screen.getByLabelText('عدد أوراق 2000 ل.س'), '1');
    await user.click(screen.getByRole('button', { name: 'افتح الوردية' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    const [open] = docsOf<ShiftOpenPayload>(outbox, 'shift_open');
    expect(validateDocumentPayload('shift_open', open!.payload)).toEqual({ ok: true, checked: true });
    expect(open!.payload.opening[0]).toEqual({
      currency: 'SYP',
      amountMinor: 200_000,
      denominations: [{ valueMinor: 200_000, count: 1 }],
    });
  });

  it('offers the built-in notes when no setting was pulled', async () => {
    const { user } = renderPos({ sets: withTill(null) });
    await signIn(user, 'سامر');
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    await countByNotes(user);
    expect(screen.getByLabelText('عدد أوراق 200 ل.س')).toBeInTheDocument();
  });
});
