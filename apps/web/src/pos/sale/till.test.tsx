import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, product } from '../../test/pos';
import { openShift, renderPos, saleScreen, scan } from '../../test/renderPos';
import { StatusBar } from '../StatusBar';
import { explainAdjust, MAX_QTY, parseAdjust } from './AdjustPanel';
import { orderValues, sizeRank } from './models';
import { useScanner } from './useScanner';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });
const due = () => screen.getByRole('status', { name: 'المطلوب' });

/** A shirt model whose pieces are given as [size, colour, stock in pieces] in the order the product lists them. */
function shirtSets(pieces: readonly (readonly [string, string, number | null])[]) {
  const base = product('قميص كتان', 45_000, null);
  const variants = pieces.map(([size, colour], index) => ({
    ...base.variant,
    id: `00000000-0000-4000-8000-00000000b0${String(index).padStart(2, '0')}`,
    label: `${size} ${colour}`,
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    sortOrder: index,
  }));
  const sets = posSets();
  return {
    ...sets,
    products: [...sets.products, base.product],
    variants: [...sets.variants, ...variants],
    prices: [...sets.prices, ...variants.map((v) => ({ ...base.price, id: v.id, variantId: v.id }))],
    stock_levels: pieces.flatMap(([, , qty], index) =>
      qty === null
        ? []
        : [
            {
              id: `00000000-0000-4000-8000-00000000c0${String(index).padStart(2, '0')}`,
              branchId: ids.branch,
              variantId: variants[index]!.id,
              qty: qty * 1000,
              reservedQty: 0,
              version: 1,
            },
          ],
    ),
  };
}

describe('the scanner loses no keystroke', () => {
  it('keeps one listener for the life of the screen, however often it is switched off and on', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const onScan = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useScanner({ enabled, onScan }), {
      initialProps: { enabled: true },
    });
    const keydowns = () => add.mock.calls.filter(([type]) => type === 'keydown').length;
    const afterMount = keydowns();
    rerender({ enabled: false });
    rerender({ enabled: true });
    rerender({ enabled: false });
    rerender({ enabled: true });
    // No listener added again: a gap between removing and adding one is where the first key got lost.
    expect(keydowns()).toBe(afterMount);
  });

  it('takes the very first key as soon as the state says it is on, and drops what a keypad took', () => {
    const onScan = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useScanner({ enabled, onScan }), {
      initialProps: { enabled: false },
    });
    const press = (key: string) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    // Typed while a keypad is open: not part of a later scan
    press('7');
    press('7');
    rerender({ enabled: true });
    for (const ch of '2900000000131') press(ch);
    press('Enter');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('2900000000131');
  });

  it('the first scan after a hold keeps its first digit', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F4}');
    await scan(user, PRODUCTS.milk.barcode!.code);
    expect(screen.queryByText(/غير معروف/)).not.toBeInTheDocument();
    expect(cartLines()).toHaveTextContent('حليب');
  });

  it('the first scan right after a panel closes keeps its first digit', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /شاي/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'خصم' }));
    const panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.click(within(panel).getByRole('button', { name: /ارجع للأصناف/ }));
    // No blur: the keys go straight on, as a scanner types them.
    await user.keyboard(`${PRODUCTS.milk.barcode!.code}{Enter}`);
    expect(screen.queryByText(/غير معروف/)).not.toBeInTheDocument();
    expect(cartLines()).toHaveTextContent('حليب');
  });
});

describe('the cart in progress survives a refresh', () => {
  it('comes back after the same cashier signs in again, and goes once the sale is saved', async () => {
    const local = memoryLocal();
    const first = await saleScreen({ local });
    await scan(first.user, PRODUCTS.tea.barcode!.code);
    await scan(first.user, PRODUCTS.milk.barcode!.code);
    await waitFor(async () => expect(await local.get('currentCart')).not.toBeNull());
    first.view.unmount();

    const second = await saleScreen({ local });
    expect(cartLines()).toHaveTextContent('شاي أحمر');
    expect(cartLines()).toHaveTextContent('حليب');
    await second.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await second.user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await second.user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(second.outbox.filter((e) => e.type === 'sale')).toHaveLength(1);
    // Saved: nothing is kept, so a refresh now cannot bring the cart back as a second sale
    await waitFor(async () => expect(await local.get('currentCart')).toBeNull());
    second.view.unmount();

    const third = await saleScreen({ local });
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();
    expect(third.outbox.filter((e) => e.type === 'sale')).toHaveLength(0);
  });

  it('keeps the discount and the order type with it', async () => {
    const local = memoryLocal();
    const first = await saleScreen({ local });
    await scan(first.user, PRODUCTS.sugar.barcode!.code);
    await first.user.keyboard('{Alt>}1{/Alt}');
    await screen.findByRole('region', { name: 'خصم على الفاتورة' });
    await first.user.keyboard('10{Enter}');
    await waitFor(() => expect(screen.getByRole('status', { name: 'خصم الفاتورة' })).toBeInTheDocument());
    await waitFor(async () => {
      const saved = await local.get<{ cart: { invoiceDiscount: unknown } }>('currentCart');
      expect(saved?.cart.invoiceDiscount).toEqual({ type: 'percent', bp: 1000 });
    });
    first.view.unmount();

    await saleScreen({ local });
    expect(screen.getByRole('status', { name: 'خصم الفاتورة' })).toBeInTheDocument();
    expect(plain(due())).toContain('711 ل.س');
  });

  it("another cashier's unfinished cart is kept, and offered with the held ones", async () => {
    const local = memoryLocal();
    const first = await saleScreen({ local });
    await scan(first.user, PRODUCTS.tea.barcode!.code);
    await waitFor(async () => expect(await local.get('currentCart')).not.toBeNull());
    first.view.unmount();

    await openShift(local, ids.maryam);
    const second = renderPos({ local });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await second.user.click(within(list).getByRole('button', { name: /مريم/ }));
    await second.user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();
    await second.user.click(screen.getByRole('button', { name: 'افتح الفواتير المعلّقة' }));
    const held = await screen.findByRole('list', { name: 'الفواتير المعلّقة', hidden: false });
    expect(held).toHaveTextContent('فاتورة سامر');
    await second.user.click(within(held).getByRole('button', { name: /استرجع فاتورة سامر/ }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
  });
});

describe('held carts are a list', () => {
  it('«علّق» asks for a name, F4 on an empty cart opens the list, and a pick brings its cart back', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: /^علّق/ }));
    const name = await screen.findByRole('textbox', { name: 'اسم الفاتورة (اختياري)' });
    await user.type(name, 'أم أحمد');
    await user.click(screen.getByRole('button', { name: 'علّق الفاتورة' }));
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();

    await scan(user, PRODUCTS.milk.barcode!.code);
    await scan(user, PRODUCTS.milk.barcode!.code);
    await user.click(screen.getByRole('button', { name: /^علّق/ }));
    // Left empty: held without a name
    await user.click(await screen.findByRole('button', { name: 'علّق الفاتورة' }));
    expect(screen.getByText('2 فواتير معلّقة')).toBeInTheDocument();

    await user.keyboard('{F4}');
    const list = await screen.findByRole('list', { name: 'الفواتير المعلّقة' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Name, how many pieces, the total and when
    expect(plain(rows[0]!)).toContain('أم أحمد');
    expect(plain(rows[0]!)).toContain('قطعة واحدة');
    expect(plain(rows[0]!)).toContain('350 ل.س');
    expect(plain(rows[1]!)).toContain('بدون اسم');
    expect(plain(rows[1]!)).toContain('قطعتان');
    expect(plain(rows[1]!)).toContain('1,000 ل.س');

    await user.click(within(list).getByRole('button', { name: /استرجع أم أحمد/ }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
    expect(screen.getByText('فاتورة معلّقة')).toBeInTheDocument();
  });

  it('a single held cart still comes back with one press of «استرجع المعلّقة»', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F4}');
    await user.click(screen.getByRole('button', { name: /استرجع المعلّقة/ }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
  });

  it('picking a held cart while one is open holds the open one, and a held cart can be dropped', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.keyboard('{F4}');
    await scan(user, PRODUCTS.milk.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'افتح الفواتير المعلّقة' }));
    await user.click(await screen.findByRole('button', { name: /استرجع بدون اسم/ }));
    expect(cartLines()).toHaveTextContent('شاي أحمر');
    expect(screen.getByText('فاتورة معلّقة')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'افتح الفواتير المعلّقة' }));
    await user.click(await screen.findByRole('button', { name: /احذف/ }));
    await user.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    expect(screen.queryByText('فاتورة معلّقة')).not.toBeInTheDocument();
  });
});

describe('the size picker', () => {
  it('lists sizes in their natural order and shows what is left, «نفد» marked and still selectable', async () => {
    const sets = shirtSets([
      ['XL', 'أبيض', 4],
      ['S', 'أبيض', 12],
      ['3XL', 'أبيض', 0],
      ['M', 'أبيض', null],
      ['L', 'أبيض', 7],
    ]);
    const { user } = await saleScreen({ sets });
    await user.click(
      within(screen.getByRole('list', { name: 'الأصناف' })).getByRole('button', { name: /قميص كتان/ }),
    );
    const picker = await screen.findByRole('region', { name: 'اختر من قميص كتان' });
    const sizes = within(within(picker).getByRole('group', { name: 'المقاس' })).getAllByRole('button');
    expect(sizes.map((b) => b.getAttribute('aria-label'))).toEqual(['S', 'M', 'L', 'XL', '3XL']);
    expect(sizes[0]).toHaveTextContent('12');
    expect(sizes[2]).toHaveTextContent('7');
    // No level known for M: nothing is claimed
    expect(sizes[1]).not.toHaveTextContent('نفد');
    expect(sizes[4]).toHaveTextContent('نفد');
    expect(sizes[4]).toBeEnabled();
    // Selling it is still allowed (stock never blocks a sale)
    await user.click(sizes[4]!);
    expect(cartLines()).toHaveTextContent('قميص كتان 3XL أبيض');
  });

  it('takes what the cart already holds off the stock shown', async () => {
    const sets = shirtSets([
      ['S', 'أبيض', 2],
      ['M', 'أبيض', 5],
    ]);
    const { user } = await saleScreen({ sets });
    const open = async () => {
      await user.click(
        within(screen.getByRole('list', { name: 'الأصناف' })).getByRole('button', { name: /قميص كتان/ }),
      );
      return screen.findByRole('region', { name: 'اختر من قميص كتان' });
    };
    let picker = await open();
    await user.click(within(picker).getByRole('button', { name: 'S' }));
    picker = await open();
    await user.click(within(picker).getByRole('button', { name: 'S' }));
    picker = await open();
    const s = within(picker).getByRole('button', { name: 'S' });
    expect(s).toHaveTextContent('نفد');
    expect(within(picker).getByRole('button', { name: 'M' })).toHaveTextContent('5');
  });

  it('orders values: letters, numbers, shoe sizes, ages; colours keep the product order', () => {
    expect(orderValues(['XL', 'S', 'XXL', 'M', 'L', '3XL', 'XS'])).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
      'XXL',
      '3XL',
    ]);
    expect(orderValues(['42', '36', '40', '9'])).toEqual(['9', '36', '40', '42']);
    expect(orderValues(['10 سنوات', '3 سنوات', '3-6 أشهر', 'سنتان', 'حديث الولادة'])).toEqual([
      'حديث الولادة',
      '3-6 أشهر',
      'سنتان',
      '3 سنوات',
      '10 سنوات',
    ]);
    expect(orderValues(['فري سايز', 'S'])).toEqual(['S', 'فري سايز']);
    expect(orderValues(['أزرق', 'أبيض', 'أحمر'])).toEqual(['أزرق', 'أبيض', 'أحمر']);
    expect(orderValues(['M', 'أحمر', 'S'])).toEqual(['M', 'أحمر', 'S']);
    expect(sizeRank('XXXL')).toBe(sizeRank('3XL'));
    expect(sizeRank('٤٢')).toBe(sizeRank('42'));
  });
});

describe('discounts on the cart', () => {
  it('a line discount shows the price before it struck through, and what was taken off', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await user.click(within(cartLines()).getByRole('button', { name: /سكر أبيض/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'خصم' }));
    const panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.keyboard('10');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    const line = within(cartLines()).getAllByRole('listitem')[0]!;
    const struck = line.querySelector('s');
    expect(struck).not.toBeNull();
    expect(plain(struck!)).toBe('790');
    expect(plain(line)).toContain('خصم 10% 79');
  });

  it('an invoice discount says it covers every line, later ones too, and what it is', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await user.keyboard('{Alt>}1{/Alt}');
    const panel = await screen.findByRole('region', { name: 'خصم على الفاتورة' });
    // The old «على سطر واحد» was read as limiting it to one line
    expect(panel).not.toHaveTextContent('على سطر واحد');
    expect(panel).toHaveTextContent('يشمل كل أسطر الفاتورة');
    expect(panel).toHaveTextContent('وما تضيفه بعدها');
    await user.keyboard('10{Enter}');
    const note = await screen.findByRole('status', { name: 'خصم الفاتورة' });
    expect(note).toHaveTextContent('خصم الفاتورة 10%');
    expect(note).toHaveTextContent('وما تضيفه بعد الآن');
    expect(plain(due())).toContain('711 ل.س');
    await scan(user, PRODUCTS.oil.barcode!.code);
    // 790 + 250 = 1,040, less 10%
    expect(plain(due())).toContain('936 ل.س');
  });
});

describe('the quantity keypad says why it refuses', () => {
  async function qtyPanel() {
    const pos = await saleScreen();
    await scan(pos.user, PRODUCTS.tea.barcode!.code);
    await pos.user.click(within(cartLines()).getByRole('button', { name: /شاي/ }));
    await pos.user.click(within(cartLines()).getByRole('button', { name: 'اكتب الكمية' }));
    const panel = await screen.findByRole('region', { name: 'الكمية' });
    return { ...pos, panel };
  }

  it('a minus sign is refused, not turned into a positive number', async () => {
    const { user, panel } = await qtyPanel();
    await user.keyboard('-5');
    expect(within(panel).getByRole('alert')).toHaveTextContent('الكمية لا تكون سالبة');
    expect(within(panel).getByRole('alert')).toHaveTextContent('مرتجع');
  });

  it('zero is explained', async () => {
    const { user, panel } = await qtyPanel();
    await user.keyboard('0');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('الكمية صفر');
    expect(within(panel).getByRole('alert')).toHaveTextContent('احذف السطر');
  });

  it('a quantity over the limit names the maximum', async () => {
    const { user, panel } = await qtyPanel();
    await user.keyboard('1000000');
    expect(panel).toHaveTextContent('الحد الأقصى للسطر الواحد (100000)');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('100000');
  });

  it('explains each refusal in words', () => {
    expect(explainAdjust('qty', '', 'SYP', false)).toBeNull();
    expect(explainAdjust('qty', '3', 'SYP', false)).toBeNull();
    expect(explainAdjust('qty', '-1', 'SYP', false)).toContain('سالبة');
    expect(explainAdjust('percent', '-1', 'SYP', false)).toContain('سالبة');
    expect(explainAdjust('qty', 'ab', 'SYP', false)).toContain('أرقاماً');
    expect(explainAdjust('qty', '1.5', 'SYP', false)).toContain('دون كسور');
    expect(explainAdjust('qty', '1.2345', 'SYP', true)).toContain('ثلاث');
    expect(explainAdjust('qty', '0', 'SYP', false)).toContain('صفر');
    expect(explainAdjust('qty', String(MAX_QTY), 'SYP', false)).toContain('الحد الأقصى');
    expect(explainAdjust('percent', '0', 'SYP', false)).toContain('أكبر من صفر');
    expect(explainAdjust('percent', '101', 'SYP', false)).toContain('100%');
    expect(explainAdjust('percent', '1.234', 'SYP', false)).toContain('منزلتان');
    expect(explainAdjust('amount', '0', 'SYP', false)).toContain('أكبر من صفر');
    expect(parseAdjust('qty', '100000', 'SYP', false)).toEqual({ mode: 'qty', qty: MAX_QTY });
  });
});

describe('the price checker', () => {
  it('shows a scanned item price and stock for every size, and adds nothing to the cart', async () => {
    const sets = shirtSets([
      ['S', 'أبيض', 3],
      ['M', 'أبيض', 0],
    ]);
    const withBarcode = {
      ...sets,
      barcodes: [
        ...sets.barcodes,
        {
          id: '00000000-0000-4000-8000-00000000d000',
          variantId: sets.variants.at(-1)!.id,
          code: '5550001112223',
          kind: 'standard' as const,
          packQty: 1000,
          packName: null,
          packPriceMinor: null,
          version: 1,
        },
      ],
    };
    const { user } = await saleScreen({ sets: withBarcode });
    await user.keyboard('{F9}');
    const check = await screen.findByRole('region', { name: 'سعر صنف' });
    await scan(user, '5550001112223');
    const rows = within(within(check).getByRole('list', { name: 'أسعار الصنف' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(plain(rows[0]!)).toContain('S · أبيض');
    expect(plain(rows[0]!)).toContain('450 ل.س');
    expect(plain(rows[0]!)).toContain('المتوفر 3');
    expect(plain(rows[1]!)).toContain('نفد');
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();

    // A tile shows the same, and a known item says it too
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(within(check).getByRole('list', { name: 'أسعار الصنف' })).toHaveTextContent('شاي أحمر 400 غ');
    expect(within(check).getByRole('list', { name: 'أسعار الصنف' })).toHaveTextContent('المتوفر غير معروف');
    expect(screen.getByText('السلة فارغة')).toBeInTheDocument();

    // Escape leaves it; the next scan sells again
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'سعر صنف' })).not.toBeInTheDocument();
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(cartLines()).toHaveTextContent('شاي أحمر');
  });

  it('opens from its button too, and a model tile lists its pieces', async () => {
    const sets = shirtSets([
      ['S', 'أبيض', 3],
      ['M', 'أزرق', 1],
    ]);
    const { user } = await saleScreen({ sets });
    await user.click(screen.getByRole('button', { name: /سعر صنف/ }));
    await user.click(
      within(screen.getByRole('list', { name: 'الأصناف' })).getByRole('button', { name: /قميص كتان/ }),
    );
    const check = await screen.findByRole('region', { name: 'سعر صنف' });
    expect(within(check).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'اختر من قميص كتان' })).not.toBeInTheDocument();
    await user.click(within(check).getByRole('button', { name: /أغلق/ }));
    expect(screen.queryByRole('region', { name: 'سعر صنف' })).not.toBeInTheDocument();
  });
});

describe('the sale screen layout', () => {
  it('the grid does not scroll sideways, and its tiles keep a picture or a letter', async () => {
    await saleScreen();
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    expect(grid.parentElement).toHaveClass('overflow-x-hidden');
    // No photo in this catalog: every tile has the letter in the picture's place
    expect(grid.querySelectorAll('[aria-hidden="true"].aspect-\\[4\\/3\\]').length).toBeGreaterThan(0);
  });

  it('on a phone the cart and the items are two tabs, never side by side', async () => {
    const { user } = await saleScreen();
    const tabs = screen.getByRole('group', { name: 'عرض الشاشة' });
    expect(within(tabs).getByRole('button', { name: 'عرض الأصناف' })).toHaveAttribute('aria-pressed', 'true');
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(within(tabs).getByRole('button', { name: /عرض السلة/ })).toHaveTextContent('1');
    await user.click(within(tabs).getByRole('button', { name: /عرض السلة/ }));
    expect(screen.getByRole('complementary', { name: 'السلة' })).toHaveClass('flex');
    expect(screen.getByRole('main')).toHaveClass('hidden');
    // Opening a panel (payment) brings the items area back
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    expect(screen.getByRole('main')).toHaveClass('flex');
  });

  it('the quick amounts form an even grid whatever their number', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    const first = within(pay).getByRole('button', { name: /المبلغ تماماً/ });
    const grid = first.parentElement!;
    const buttons = [...grid.children] as HTMLElement[];
    const n = buttons.length;
    const cols = [1, 2, 3, 2, 6, 3][n - 1];
    expect(grid.className).toContain(`grid-cols-${cols}`);
    if (n === 5) {
      expect(buttons.map((b) => (b.className.includes('col-span-2') ? 2 : 3))).toEqual([2, 2, 2, 3, 3]);
    }
  });
});

describe('the install hint', () => {
  const device = null;
  it('can be dismissed, and stays away afterwards', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StatusBar device={device} persisted={false} online />);
    expect(screen.getByRole('alert')).toHaveTextContent('ثبّت التطبيق');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'أخفِ تنبيه التثبيت' }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();
    render(<StatusBar device={device} persisted={false} online />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
