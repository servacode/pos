import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

/** The wholesale mode at the till: the wholesale price, cheques and the printed quote. */

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  vi.spyOn(window, 'print').mockImplementation(print);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const due = () => screen.getByRole('status', { name: 'المطلوب' });

async function signedIn(name: 'سامر' | 'مريم') {
  const local = memoryLocal();
  await openShift(local, name === 'مريم' ? ids.maryam : ids.samer);
  const pos = renderPos({ local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: new RegExp(name) }));
  await pos.user.keyboard(PINS[name === 'سامر' ? ids.samer : ids.maryam]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  return pos;
}

describe('the wholesale price', () => {
  it('a manager switches the invoice to the wholesale price and back; lines without one keep theirs', async () => {
    const { user } = await signedIn('مريم');
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.oil.barcode!.code);
    // 790 + 250
    expect(plain(due())).toContain('1,040 ل.س');
    const toggle = screen.getByRole('button', { name: 'سعر الجملة' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // 700 + 250
    expect(plain(due())).toContain('950 ل.س');
    await scan(user, PRODUCTS.sugar.barcode!.code);
    expect(plain(due())).toContain('1,650 ل.س');
    await user.click(toggle);
    expect(plain(due())).toContain('1,830 ل.س');
  });

  it('a cashier without the permission does not see it, but a wholesale customer moves the sale to it', async () => {
    const { user, outbox } = await signedIn('سامر');
    expect(screen.queryByRole('button', { name: 'سعر الجملة' })).not.toBeInTheDocument();
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'النور');
    await user.click(within(pay).getByRole('button', { name: /بقالية النور/ }));
    expect(plain(due())).toContain('700 ل.س');
    expect(screen.getByRole('button', { name: 'سعر الجملة' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.lines[0]).toMatchObject({ priceMinor: 70_000, unitPriceMinor: 70_000 });
    expect(sale.customerId).toBe(ids.alNour);
    expect(verifySalePayload(sale)).toEqual([]);
  });
});

describe('cheques at the till', () => {
  /** A named customer and one cheque of the oil's 250.00, details typed */
  async function toCheque(name: 'سامر' | 'مريم', buttonName: string) {
    const pos = await signedIn(name);
    const { user } = pos;
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).queryByRole('button', { name: /شيك/ })).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    await user.click(within(pay).getByRole('button', { name: buttonName }));
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeDisabled();
    await user.type(within(pay).getByLabelText('البنك'), 'بنك سورية');
    await user.type(within(pay).getByLabelText('رقم الشيك'), '5512');
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeDisabled();
    await user.type(within(pay).getByLabelText('تاريخ الاستحقاق'), '30/11/2030');
    await user.type(within(pay).getByLabelText('اسم الساحب (اختياري)'), 'أبو خالد');
    return { ...pos, pay };
  }

  it('takes a cheque with its bank, number and due date for a named customer, and only then', async () => {
    const { user, outbox, pay } = await toCheque('مريم', 'شيك');
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeEnabled();
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(plain(screen.getByRole('region', { name: 'تمت البيعة' }))).toContain('بشيك');
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.payments).toEqual([
      expect.objectContaining({
        method: 'cheque',
        amountMinor: 25_000,
        reference: 'بنك سورية · 5512 · 2030-11-30',
        cheque: { bank: 'بنك سورية', number: '5512', dueDate: '2030-11-30', drawer: 'أبو خالد' },
      }),
    ]);
  });

  it('a cashier takes the cheque with a manager’s code, recorded on the sale', async () => {
    const { user, outbox, pay } = await toCheque('سامر', 'شيك (بموافقة المدير)');
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    expect(await screen.findByRole('region', { name: 'رمز المدير' })).toBeInTheDocument();
    expect(outbox.some((e) => e.type === 'sale')).toBe(false);
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload & {
      creditApproval: { userId: string };
    };
    expect(sale.payments[0]).toMatchObject({ method: 'cheque' });
    expect(sale.creditApproval.userId).toBe(ids.maryam);
  });
});

describe('the quote', () => {
  it('prints the cart as a quote, with no sale and nothing sent', async () => {
    const { user, outbox } = await signedIn('مريم');
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'عرض سعر' }));
    expect(print).toHaveBeenCalledOnce();
    expect(outbox.filter((e) => e.type === 'sale')).toEqual([]);
    // The cart stays, ready to sell
    expect(plain(due())).toContain('790 ل.س');
  });
});
