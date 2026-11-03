import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/** Electronics at the till: each phone sold by its IMEI, with its warranty on the receipt. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });

function phoneSets() {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.oil.product.id
      ? { ...p, nameAr: 'هاتف A15', tracksSerial: true, warrantyMonths: 12 }
      : p,
  );
  return sets;
}

describe('serial numbers at the till', () => {
  it('asks for the IMEI of each phone, a line each, and pays only once every phone has one', async () => {
    const { user, outbox } = await saleScreen({ sets: phoneSets() });
    await scan(user, PRODUCTS.oil.barcode!.code);
    let panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.type(within(panel).getByLabelText('الرقم التسلسلي أو IMEI'), 'imei 351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(plain(cartLines())).toContain('IMEI IMEI351');
    expect(plain(cartLines())).toContain('هاتف A15 · كفالة 12 شهراً');

    // The second phone is a line of its own; «لاحقاً» leaves it without a number and payment waits
    await scan(user, PRODUCTS.oil.barcode!.code);
    panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.click(within(panel).getByRole('button', { name: 'لاحقاً' }));
    expect(within(cartLines()).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /ادفع/ })).toBeDisabled();
    await user.click(within(cartLines()).getByRole('button', { name: 'اكتب الرقم التسلسلي' }));
    panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.type(within(panel).getByLabelText('الرقم التسلسلي أو IMEI'), 'IMEI351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(within(panel).getByText('هذا الرقم على سطر آخر في الفاتورة.')).toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('الرقم التسلسلي أو IMEI'));
    await user.type(within(panel).getByLabelText('الرقم التسلسلي أو IMEI'), 'IMEI352');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.lines.map((l) => l.serials)).toEqual([['IMEI351'], ['IMEI352']]);
    expect(document.querySelector('[data-print-receipt]')?.textContent).toContain('IMEI IMEI351');
  });
});
