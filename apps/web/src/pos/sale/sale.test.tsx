import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal, type LocalStore } from '../../offline/local';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { renderPos, type RenderPosOptions } from '../../test/renderPos';

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  vi.spyOn(window, 'print').mockImplementation(print);
});
afterEach(() => {
  vi.restoreAllMocks();
});

export const SHIFT_ID = '0192a000-0000-7000-8000-00000000ffff';

export async function openShift(local: LocalStore, userId = ids.samer) {
  await local.set(`shift:${userId}`, {
    key: `shift:${userId}`,
    id: SHIFT_ID,
    number: 'SFT-001-002-0000001',
    openedBy: userId,
    openedByName: 'سامر',
    openedAt: Date.now(),
    mode: 'per_cashier',
    opening: [{ currency: 'SYP', amountMinor: 0, denominations: null }],
  });
}

/** Signed in as سامر (cashier) with an open shift, on the sale screen. */
export async function saleScreen(options: RenderPosOptions = {}) {
  const local = options.local ?? memoryLocal();
  await openShift(local);
  const pos = renderPos({ ...options, local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  return pos;
}

/** What a scanner does: the whole code fast, then Enter, wherever the focus is. */
export async function scan(user: ReturnType<typeof renderPos>['user'], code: string) {
  (document.activeElement as HTMLElement | null)?.blur();
  await user.keyboard(`${code}{Enter}`);
}

/** Text as read, without the direction isolates amounts carry. */
const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const shows = (el: Element, text: string) => expect(plain(el)).toContain(text);
const named = (text: string) => (name: string) => stripBidiControls(name) === text;

const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });
const due = () => screen.getByRole('status', { name: 'المطلوب' });

function savedSale(outbox: ReturnType<typeof renderPos>['outbox']) {
  const entry = outbox.find((e) => e.type === 'sale')!;
  return { entry, sale: entry.doc.payload as unknown as SalePayload };
}

describe('sale screen', () => {
  it('golden first sale: 1,290 paid with 9 $ at 130 and 200 ل.س, 80 back (tab 23)', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.milk.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);
    expect(cartLines()).toHaveTextContent('حليب كامل الدسم 1 لتر');
    shows(cartLines(), 'سكر أبيض 1 كغ');
    shows(due(), '1,290 ل.س');

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'قسّم الدفع' }));
    await user.click(within(pay).getByRole('button', { name: /نقد بالدولار/ }));
    await user.keyboard('9');
    await user.click(within(pay).getByRole('button', { name: 'أضف الجزء' }));
    shows(within(pay).getByRole('list', { name: 'الأجزاء المدفوعة' }), '9.00 $');
    expect(within(pay).getByRole('status')).toHaveTextContent('ناقص من الزبون');
    shows(within(pay).getByRole('status'), '120 ل.س');

    await user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
    await user.keyboard('200');
    expect(within(pay).getByRole('status')).toHaveTextContent('الباقي');
    shows(within(pay).getByRole('status'), '80 ل.س');
    await user.keyboard('{Enter}');

    const done = await screen.findByRole('region', { name: 'تمت البيعة' });
    shows(done, 'فاتورة رقم INV-001-002-0000001');
    shows(within(done).getByRole('status'), '80 ل.س');
    expect(print).toHaveBeenCalledOnce();

    const { entry, sale } = savedSale(outbox);
    expect(entry.doc.number).toBe('INV-001-002-0000001');
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(verifySalePayload(sale)).toEqual([]);
    expect(sale.totals.totalMinor).toBe(129_000);
    expect(sale.payments.map((p) => [p.method, p.currency, p.amountMinor, p.baseAmountMinor])).toEqual([
      ['cash', 'USD', 900, 117_000],
      ['cash', 'SYP', 20_000, 20_000],
    ]);
    expect(sale.change).toEqual({ currency: 'SYP', amountMinor: 8_000, rate: null, baseAmountMinor: 8_000 });
    expect(sale.shiftId).toBe(SHIFT_ID);
    expect(sale.cashierId).toBe(ids.samer);
    expect(sale.customerId).toBeNull();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('takes a quick note, completes with Enter, and the next scan starts the next sale', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('+');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: named('500') }));
    await user.keyboard('{Enter}');
    shows(await screen.findByRole('region', { name: 'تمت البيعة' }), '250 ل.س');

    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByRole('region', { name: 'تمت البيعة' })).not.toBeInTheDocument();
    expect(cartLines()).toHaveTextContent('شاي أحمر');
    expect(outbox.filter((e) => e.type === 'sale')).toHaveLength(1);
  });

  it('a wallet payment needs its transaction number', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.labneh.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'شام كاش' }));
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeDisabled();
    await user.type(within(pay).getByLabelText('رقم العملية'), '48213097');
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const { sale } = savedSale(outbox);
    expect(sale.payments).toMatchObject([{ method: 'wallet', amountMinor: 28_000, reference: '48213097' }]);
    expect(sale.cashRounding).toBeNull();
    expect(validateDocumentPayload('sale', sale).ok).toBe(true);
  });

  it('says so for an unknown barcode, without blocking the screen', async () => {
    const { user } = await saleScreen();
    await scan(user, '9999999999999');
    expect(screen.getByRole('alert')).toHaveTextContent('الباركود 9999999999999 غير معروف على هذا الجهاز');
    await scan(user, PRODUCTS.milk.barcode!.code);
    expect(cartLines()).toHaveTextContent('حليب');
  });

  it('finds names however they are spelled, and Enter adds the only result', async () => {
    const { user } = await saleScreen();
    await user.type(screen.getByPlaceholderText('ابحث باسم الصنف أو امسح الباركود'), 'شاى احمر');
    const items = screen.getByRole('list', { name: 'الأصناف' });
    expect(within(items).getAllByRole('button')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(cartLines()).toHaveTextContent('شاي أحمر 400 غ');
  });

  it('«3 ثم *» sets the quantity of the next scan, and a repeated scan adds one', async () => {
    const { user } = await saleScreen();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('3*');
    expect(screen.getByLabelText('الكمية التالية 3')).toBeInTheDocument();
    await scan(user, PRODUCTS.milk.barcode!.code);
    await scan(user, PRODUCTS.milk.barcode!.code);
    shows(cartLines(), '4 ×');
    shows(due(), '2,000 ل.س');
  });

  it('a weighed item asks for its weight on the keypad', async () => {
    const { user } = await saleScreen();
    await user.click(screen.getByRole('button', { name: /زيتون أخضر/ }));
    const panel = await screen.findByRole('region', { name: 'الوزن' });
    await user.keyboard('1.25');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    shows(cartLines(), '1.250 كغ');
    shows(due(), '375 ل.س');
  });

  it('a dollar price is sold in pounds at the rate in force', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.nescafe.barcode!.code);
    shows(due(), '1,950 ل.س');
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const { sale } = savedSale(outbox);
    expect(sale.lines[0]).toMatchObject({ priceCurrency: 'USD', priceMinor: 1_500, unitPriceMinor: 195_000 });
    expect(sale.exchangeRates).toEqual([{ unit: 'USD', quote: 'SYP', rate: '130' }]);
  });

  it('a discount within the role limit applies at once; over it, the manager code shows inside the panel', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /سكر أبيض/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'خصم' }));
    let panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.keyboard('10');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    shows(due(), '711 ل.س');

    await user.click(within(cartLines()).getByRole('button', { name: 'خصم' }));
    panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.keyboard('25');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    const layer = within(panel).getByRole('region', { name: 'رمز المدير' });
    expect(layer).toHaveTextContent('الخصم أكبر من الحد المسموح لدورك');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard(PINS[ids.maryam]!);
    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    shows(due(), '593 ل.س');

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const { sale } = savedSale(outbox);
    expect(sale.lines[0]!.discount).toMatchObject({
      type: 'percent',
      bp: 2500,
      source: 'manual',
      approval: { userId: ids.maryam, method: 'pin', offline: false },
    });
    expect(validateDocumentPayload('sale', sale).ok).toBe(true);
  });

  it('a price typed in the cart is a discount; under the minimum price it waits for the manager', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.milk.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /حليب/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'السعر' }));
    const panel = await screen.findByRole('region', { name: 'سعر جديد في السلة' });
    await user.keyboard('480');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    shows(due(), '480 ل.س');

    await user.click(within(cartLines()).getByRole('button', { name: 'السعر' }));
    await user.keyboard('400');
    await user.click(
      within(await screen.findByRole('region', { name: 'سعر جديد في السلة' })).getByRole('button', {
        name: 'طبّق',
      }),
    );
    expect(screen.getByRole('region', { name: 'رمز المدير' })).toHaveTextContent('تحت السعر الأدنى');
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    shows(due(), '400 ل.س');

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const { sale } = savedSale(outbox);
    expect(sale.lines[0]).toMatchObject({ priceMinor: 50_000, unitPriceMinor: 50_000 });
    expect(sale.lines[0]!.discount).toMatchObject({
      type: 'amount',
      minor: 10_000,
      source: 'price_override',
    });
    expect(sale.totals.totalMinor).toBe(40_000);
  });

  it('a price over the shelf price is refused', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /زيت/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'السعر' }));
    const panel = await screen.findByRole('region', { name: 'سعر جديد في السلة' });
    await user.keyboard('300');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('السعر الجديد أعلى من سعر الصنف');
  });

  it('holds the cart and brings it back', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F4}');
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();
    expect(screen.getByText('فاتورة معلّقة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'استرجع المعلّقة' }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
  });

  it('removes a line with «تراجع» to bring it back', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /شاي/ }));
    await user.click(screen.getByRole('button', { name: 'احذف السطر' }));
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تراجع' }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
  });

  it('reprints the last receipt marked «نسخة»', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    await user.click(
      within(await screen.findByRole('region', { name: 'الدفع' })).getByRole('button', {
        name: /المبلغ تماماً/,
      }),
    );
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    await user.click(screen.getByRole('button', { name: 'إيصال آخر فاتورة' }));
    expect(print).toHaveBeenCalledTimes(2);
    const printed = document.querySelector('[data-print-receipt]')!;
    expect(printed).toHaveTextContent('نسخة');
    expect(printed).toHaveTextContent('INV-001-002-0000001');
    expect(printed).toHaveTextContent('سوبرماركت الفرات');
    expect(printed).toHaveTextContent('الرقم الضريبي 41875520');
    expect(printed).toHaveTextContent('الاستبدال خلال 7 أيام بالإيصال.');
  });

  it('speed: five scanned products to a printed receipt with no wait beyond rendering', async () => {
    const { user, outbox } = await saleScreen();
    const started = performance.now();
    for (const p of [PRODUCTS.milk, PRODUCTS.sugar, PRODUCTS.oil, PRODUCTS.labneh, PRODUCTS.tea]) {
      await scan(user, p.barcode!.code);
    }
    await user.keyboard('{F12}');
    await user.click(
      within(await screen.findByRole('region', { name: 'الدفع' })).getByRole('button', {
        name: /المبلغ تماماً/,
      }),
    );
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce(), { timeout: 50 });
    expect(savedSale(outbox).sale.lines).toHaveLength(5);
    // Rendering only: no debounce, no polling, no network on the way.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
