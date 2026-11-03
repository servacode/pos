import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { stripBidiControls } from '@serva/core/text';
import { posSets, PRODUCTS } from '../../test/pos';
import type { renderPos } from '../../test/renderPos';
import { saleScreen, scan } from '../../test/renderPos';
import { tablesOf } from '../../admin/store/ServiceForm';

/** Restaurants and cafés at the till: choices, order types, tables, the kitchen and the order number. */

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  vi.spyOn(window, 'print').mockImplementation(print);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });
const due = () => screen.getByRole('status', { name: 'المطلوب' });

/** Tea gets «الحجم» (one, +50 for large) and «الإضافات» (several); the store is a café with 3 tables. */
function cafeSets() {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.tea.product.id
      ? {
          ...p,
          modifiers: [
            {
              name: 'الحجم',
              multiple: false,
              required: true,
              options: [
                { name: 'وسط', priceMinor: 0 },
                { name: 'كبير', priceMinor: 5_000 },
              ],
            },
            {
              name: 'الإضافات',
              multiple: true,
              required: false,
              options: [
                { name: 'نعنع', priceMinor: 1_000 },
                { name: 'ليمون', priceMinor: 2_000 },
              ],
            },
          ],
        }
      : p,
  );
  sets.settings = [
    {
      ...sets.settings[0]!,
      service: { tables: ['1', '2', 'VIP'], orderNumbers: true, kitchenTickets: true },
    },
  ];
  return sets;
}

async function payExact(user: ReturnType<typeof renderPos>['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('choices', () => {
  it('asks for the choices beside the cart, names the line with them and adds their prices', async () => {
    const { user, outbox } = await saleScreen({ sets: cafeSets() });
    await scan(user, PRODUCTS.tea.barcode!.code);
    const panel = await screen.findByRole('region', { name: /خيارات شاي/ });
    await user.click(within(panel).getByRole('radio', { name: /كبير/ }));
    await user.click(within(panel).getByRole('checkbox', { name: /نعنع/ }));
    await user.type(within(panel).getByLabelText('ملاحظة للمطبخ'), 'سكر خفيف');
    await user.click(within(panel).getByRole('button', { name: /أضف/ }));
    expect(plain(cartLines())).toContain('شاي أحمر 400 غ · كبير · نعنع · سكر خفيف');
    // 350 + 50 + 10
    expect(plain(due())).toContain('410 ل.س');
    // The same item with other choices is a line of its own
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(
      within(await screen.findByRole('region', { name: /خيارات شاي/ })).getByRole('button', { name: /أضف/ }),
    );
    expect(within(cartLines()).getAllByRole('listitem')).toHaveLength(2);
    expect(plain(due())).toContain('760 ل.س');
    await payExact(user);
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.lines.map((l) => [l.name, l.priceMinor])).toEqual([
      ['شاي أحمر 400 غ · كبير · نعنع · سكر خفيف', 41_000],
      ['شاي أحمر 400 غ · وسط', 35_000],
    ]);
    expect(verifySalePayload(sale)).toEqual([]);
  });

  it('a required group of several needs one choice, and cancel adds nothing', async () => {
    const sets = cafeSets();
    sets.products = sets.products.map((p) =>
      p.id === PRODUCTS.tea.product.id
        ? {
            ...p,
            modifiers: [
              { name: 'النكهة', multiple: true, required: true, options: [{ name: 'نعنع', priceMinor: 0 }] },
            ],
          }
        : p,
    );
    const { user } = await saleScreen({ sets });
    await scan(user, PRODUCTS.tea.barcode!.code);
    const panel = await screen.findByRole('region', { name: /خيارات شاي/ });
    await user.click(within(panel).getByRole('button', { name: /أضف/ }));
    expect(within(panel).getByText('اختر من «النكهة».')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'إلغاء' }));
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).toBeNull();
  });
});

describe('the hall, the kitchen and the call', () => {
  it('takes an order at a table, sends it to the kitchen, opens another table, and comes back', async () => {
    const { user, outbox } = await saleScreen({ sets: cafeSets() });
    await user.click(screen.getByRole('button', { name: 'الطاولات' }));
    const board = await screen.findByRole('region', { name: 'الطاولات' });
    await user.click(within(board).getByRole('button', { name: 'طاولة 2 فارغة' }));
    expect(screen.getByRole('button', { name: 'طاولة 2' })).toBeInTheDocument();
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);

    await user.click(screen.getByRole('button', { name: 'للمطبخ' }));
    expect(print).toHaveBeenCalledOnce();
    // Nothing new: the button goes until something is added
    expect(screen.queryByRole('button', { name: 'للمطبخ' })).toBeNull();
    await scan(user, PRODUCTS.oil.barcode!.code);
    expect(screen.getByRole('button', { name: 'للمطبخ' })).toBeInTheDocument();

    // Another table: table 2 waits with its order
    await user.click(screen.getByRole('button', { name: 'طاولة 2' }));
    const again = await screen.findByRole('region', { name: 'الطاولات' });
    expect(within(again).getByRole('button', { name: 'طاولة 2 مشغولة' })).toBeInTheDocument();
    await user.click(within(again).getByRole('button', { name: 'طاولة VIP فارغة' }));
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'طاولة VIP' }));
    await user.click(
      within(await screen.findByRole('region', { name: 'الطاولات' })).getByRole('button', {
        name: 'طاولة 2 مشغولة',
      }),
    );
    // 2 × 790 + 250
    expect(plain(due())).toContain('1,830 ل.س');

    await payExact(user);
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.service).toEqual({ orderType: 'dine_in', table: '2', orderNo: 1 });
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    const done = screen.getByRole('region', { name: 'تمت البيعة' });
    expect(done).toBeInTheDocument();
  });

  it('numbers takeaway orders 1, 2… and prints the number and «سفري»', async () => {
    const { user, outbox } = await saleScreen({ sets: cafeSets() });
    await user.click(
      within(screen.getByRole('group', { name: 'نوع الطلب' })).getByRole('button', { name: 'سفري' }),
    );
    await scan(user, PRODUCTS.oil.barcode!.code);
    await payExact(user);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await payExact(user);
    const sales = outbox
      .filter((e) => e.type === 'sale')
      .map((e) => (e.doc.payload as unknown as SalePayload).service);
    expect(sales).toEqual([
      { orderType: 'takeaway', table: null, orderNo: 1 },
      { orderType: 'dine_in', table: null, orderNo: 2 },
    ]);
    const receipt = document.querySelector('[data-print-receipt]');
    expect(receipt?.textContent).toContain('رقم الطلب 2');
  });

  it('a shop without the hall shows none of it and sends no service', async () => {
    const { user, outbox } = await saleScreen();
    expect(screen.queryByRole('group', { name: 'نوع الطلب' })).toBeNull();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await payExact(user);
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect('service' in sale).toBe(false);
  });
});

describe('tablesOf', () => {
  it('reads numbers, ranges and names, without repeats', () => {
    expect(tablesOf('1-3، VIP, ٤ 2')).toEqual(['1', '2', '3', 'VIP', '4']);
    expect(tablesOf('')).toEqual([]);
  });
});
