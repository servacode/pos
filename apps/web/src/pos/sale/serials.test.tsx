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

const stock = (serial: string, over: Record<string, unknown> = {}) => ({
  id: `0192a3b4-c5d6-7e8f-9a0b-${String(serial.length * 1000 + serial.charCodeAt(serial.length - 1)).padStart(12, '0')}`,
  variantId: PRODUCTS.oil.variant.id,
  serial,
  status: 'in_stock' as const,
  saleNumber: null,
  version: 1,
  ...over,
});

function phoneSets(withStock = true) {
  const sets = posSets();
  sets.serials = withStock
    ? [
        stock('IMEI351'),
        stock('IMEI352'),
        stock('SOLD777', { status: 'sold', saleNumber: 'INV-001-001-0000042' }),
        stock('GL2003', { variantId: PRODUCTS.milk.variant.id }),
      ]
    : [];
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.oil.product.id
      ? { ...p, nameAr: 'هاتف A15', tracksSerial: true, warrantyMonths: 12 }
      : p,
  );
  return sets;
}

describe('serial numbers at the till', () => {
  it('lists the numbers in stock for the product (not sold, not another product) and picks one on a tap', async () => {
    const { user } = await saleScreen({ sets: phoneSets() });
    await scan(user, PRODUCTS.oil.barcode!.code);
    const panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    const list = within(panel).getByRole('list', { name: 'الأرقام المتوفرة' });
    const shown = within(list)
      .getAllByRole('listitem')
      .map((li) => plain(li));
    expect(shown).toEqual(['IMEI351', 'IMEI352']);
    await user.click(within(list).getByRole('button', { name: 'IMEI352' }));
    expect(within(panel).getByLabelText('الرقم التسلسلي للجهاز')).toHaveValue('IMEI352');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(plain(cartLines())).toContain('IMEI352');
  });

  it('asks piece or box when an item with a box barcode is picked from the grid', async () => {
    const sets = posSets();
    sets.barcodes = [
      ...sets.barcodes,
      {
        id: '0192a3b4-c5d6-7e8f-9a0b-0000000000ee',
        variantId: PRODUCTS.oil.variant.id,
        code: '6291001999999',
        kind: 'standard' as const,
        packQty: 12_000,
        packName: 'علبة',
        packPriceMinor: null,
        version: 1,
      },
    ];
    const { user } = await saleScreen({ sets });
    const grid = await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(within(grid).getByText(/زيت دوار الشمس/));
    const panel = await screen.findByRole('region', { name: 'اختر الوحدة' });
    await user.click(within(panel).getByRole('button', { name: /علبة/ }));
    expect(plain(cartLines())).toContain('علبة');
  });

  it('asks for the IMEI of each phone, a line each, and pays only once every phone has one', async () => {
    const { user, outbox } = await saleScreen({ sets: phoneSets() });
    await scan(user, PRODUCTS.oil.barcode!.code);
    let panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.type(within(panel).getByLabelText('الرقم التسلسلي للجهاز'), 'imei 351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(plain(cartLines())).toContain('الرقم التسلسلي IMEI351');
    expect(plain(cartLines())).toContain('هاتف A15 · كفالة 12 شهراً');

    // The second phone is a line of its own; «لاحقاً» leaves it without a number and payment waits
    await scan(user, PRODUCTS.oil.barcode!.code);
    panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.click(within(panel).getByRole('button', { name: 'لاحقاً' }));
    expect(within(cartLines()).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /ادفع/ })).toBeDisabled();
    await user.click(within(cartLines()).getByRole('button', { name: 'اكتب الرقم التسلسلي' }));
    panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.type(within(panel).getByLabelText('الرقم التسلسلي للجهاز'), 'IMEI351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(
      within(panel).getByText('هذا الرقم على سطر آخر في الفاتورة: كل جهاز له رقمه.'),
    ).toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('الرقم التسلسلي للجهاز'));
    await user.type(within(panel).getByLabelText('الرقم التسلسلي للجهاز'), 'IMEI352');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.lines.map((l) => l.serials)).toEqual([['IMEI351'], ['IMEI352']]);
    expect(document.querySelector('[data-print-receipt]')?.textContent).toContain('الرقم التسلسلي IMEI351');
  });

  async function startPhone(sets = phoneSets()) {
    const ctx = await saleScreen({ sets });
    await scan(ctx.user, PRODUCTS.oil.barcode!.code);
    const panel = await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    return { ...ctx, panel };
  }
  const typeSerial = async (
    user: Awaited<ReturnType<typeof saleScreen>>['user'],
    panel: HTMLElement,
    v: string,
  ) => {
    await user.clear(within(panel).getByLabelText('الرقم التسلسلي للجهاز'));
    await user.type(within(panel).getByLabelText('الرقم التسلسلي للجهاز'), v);
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
  };

  it('refuses a number already sold, naming its invoice', async () => {
    const { user, panel } = await startPhone();
    await typeSerial(user, panel, 'sold777');
    expect(within(panel).getByText('هذا الرقم مباع في الفاتورة INV-001-001-0000042.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'اسمح به بمدير' })).not.toBeInTheDocument();
  });

  it('refuses another product’s number', async () => {
    const { user, panel } = await startPhone();
    await typeSerial(user, panel, 'GL2003');
    expect(within(panel).getByText('هذا الرقم لصنف آخر في المحل. تأكد من الجهاز.')).toBeInTheDocument();
  });

  it('refuses an unknown number but offers the manager’s code', async () => {
    const { user, panel } = await startPhone();
    await typeSerial(user, panel, 'ZZ-9999');
    expect(within(panel).getByText('هذا الرقم غير موجود في مخزون هذا الفرع.')).toBeInTheDocument();
    expect(cartLines().textContent).not.toContain('ZZ-9999');
    expect(within(panel).getByRole('button', { name: 'اسمح به بمدير' })).toBeInTheDocument();
  });

  it('hints when the product’s own barcode is scanned as the serial', async () => {
    const { user, panel } = await startPhone();
    await typeSerial(user, panel, PRODUCTS.oil.barcode!.code);
    expect(within(panel).getByText(/هذا باركود الصنف لا الرقم التسلسلي/)).toBeInTheDocument();
  });

  it('asks who the customer is before paying for a device with a warranty (electronics)', async () => {
    const sets = phoneSets();
    sets.settings = sets.settings.map((row) => ({ ...row, sectors: ['electronics'] }));
    const { user, panel } = await startPhone(sets);
    // Electronics call the number «IMEI»
    expect(within(panel).getByLabelText('IMEI للجهاز')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('IMEI للجهاز'), 'IMEI351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    expect(plain(cartLines())).toContain('IMEI IMEI351');
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).getByText(/جهاز بكفالة: اطلب اسم الزبون وجواله/)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: /أتمّ الدفع/ })).toBeDisabled();
  });

  it('does not ask for a customer when the store switched it off', async () => {
    const sets = phoneSets();
    sets.settings = sets.settings.map((row) => ({
      ...row,
      sectors: ['electronics'],
      till: { returnWindowDays: null, cardApprovalRequired: false, warrantyAskCustomer: false },
    }));
    const { user, panel } = await startPhone(sets);
    await user.type(within(panel).getByLabelText('IMEI للجهاز'), 'IMEI351');
    await user.click(within(panel).getByRole('button', { name: 'احفظ الرقم' }));
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).queryByText(/جهاز بكفالة: اطلب/)).not.toBeInTheDocument();
  });
});
