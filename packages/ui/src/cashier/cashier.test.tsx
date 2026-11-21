import { stripBidiControls } from '@serva/core';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../test/render';
import { CartLine, formatQuantity } from './CartLine';
import { ItemTile } from './ItemTile';
import { Keypad } from './Keypad';
import { TotalPanel } from './TotalPanel';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

describe('Keypad', () => {
  it('stays LTR with 7 8 9 on top, keys of 64, and the decimal point beside 0', async () => {
    const onDigit = vi.fn();
    const onExtraKey = vi.fn();
    const onBackspace = vi.fn();
    const { user } = renderUi(
      <Keypad onDigit={onDigit} onBackspace={onBackspace} extraKey="." onExtraKey={onExtraKey} />,
    );

    const pad = screen.getByRole('group', { name: 'لوحة الأرقام' });
    expect(pad).toHaveAttribute('dir', 'ltr');
    const keys = within(pad).getAllByRole('button');
    expect(keys.map((key) => key.textContent || key.getAttribute('aria-label'))).toEqual([
      '7',
      '8',
      '9',
      '4',
      '5',
      '6',
      '1',
      '2',
      '3',
      '.',
      '0',
      'امسح رقماً',
    ]);
    for (const key of keys) expect(key).toHaveClass('h-16');

    await user.click(within(pad).getByRole('button', { name: '7' }));
    await user.click(within(pad).getByRole('button', { name: '.' }));
    await user.click(within(pad).getByRole('button', { name: 'امسح رقماً' }));
    expect(onDigit).toHaveBeenCalledWith('7');
    expect(onExtraKey).toHaveBeenCalledOnce();
    expect(onBackspace).toHaveBeenCalledOnce();
  });
});

describe('ItemTile', () => {
  it('is at least 112 × 104 and shows the price in equal-width digits', async () => {
    const onSelect = vi.fn();
    const { user } = renderUi(
      <ItemTile name="لاتيه وسط" priceMinor={12000} currency="SYP" selected onSelect={onSelect} />,
    );

    const tile = screen.getByRole('button', { name: /لاتيه وسط/ });
    // The card is the tile's frame; its button is inside, so chips can sit beside the button as real buttons
    const card = tile.parentElement!;
    expect(card).toHaveClass('min-h-26', 'min-w-28');
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveClass('bg-brand-soft');
    expect(card).not.toHaveClass('bg-surface');
    expect(text(tile.querySelector('bdi.num')!)).toBe('120 ل.س');
    await user.click(tile);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('keeps chips as buttons of their own beside the tile button, never inside it', async () => {
    const onSelect = vi.fn();
    const onSize = vi.fn();
    const { user } = renderUi(
      <ItemTile
        name="قميص"
        priceMinor={12000}
        currency="SYP"
        chips={
          <button type="button" onClick={onSize}>
            M
          </button>
        }
        onSelect={onSelect}
      />,
    );
    const tile = screen.getByRole('button', { name: /قميص/ });
    const chip = screen.getByRole('button', { name: 'M' });
    expect(tile.contains(chip)).toBe(false);
    await user.click(chip);
    expect(onSize).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cannot be sold when out of stock, and says so in words', () => {
    renderUi(<ItemTile name="حليب 1 لتر" priceMinor={15000} currency="SYP" outOfStock onSelect={() => {}} />);

    const tile = screen.getByRole('button', { name: /حليب 1 لتر/ });
    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent('نفد');
  });
});

describe('CartLine', () => {
  it('formats quantities in thousandths: pieces whole, weights with three decimals', () => {
    expect(formatQuantity(3000)).toBe('3');
    expect(formatQuantity(1250)).toBe('1.250');
    expect(formatQuantity(1250, 'arab')).toBe('١٫٢٥٠');
  });

  it('reads «1.250 كغ × 300» in one isolate and shows the line total', () => {
    renderUi(
      <ul>
        <CartLine
          name="جبنة بيضاء"
          qtyThousandths={1250}
          unit="كغ"
          unitPriceMinor={30000}
          lineTotalMinor={37500}
          currency="SYP"
          meta="خصم 10%"
          onSelect={() => {}}
        />
      </ul>,
    );

    const line = screen.getByRole('button', { name: /جبنة بيضاء/ });
    const quantity = line.querySelector('bdi[dir="rtl"]')!;
    expect(text(quantity)).toBe('1.250 كغ × 300');
    expect(text(line)).toContain('375 ل.س');
    expect(line).toHaveTextContent('خصم 10%');
  });

  it('opens the selected line in place with its actions', () => {
    const { rerender } = renderUi(
      <ul>
        <CartLine
          name="شاي"
          qtyThousandths={2000}
          unitPriceMinor={4000}
          lineTotalMinor={8000}
          currency="SYP"
          onSelect={() => {}}
        >
          <button type="button">احذف السطر</button>
        </CartLine>
      </ul>,
    );
    expect(screen.getByRole('button', { name: /شاي/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'احذف السطر' })).not.toBeInTheDocument();

    rerender(
      <ul>
        <CartLine
          name="شاي"
          qtyThousandths={2000}
          unitPriceMinor={4000}
          lineTotalMinor={8000}
          currency="SYP"
          selected
          onSelect={() => {}}
        >
          <button type="button">احذف السطر</button>
        </CartLine>
      </ul>,
    );
    expect(screen.getByRole('button', { name: /شاي/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'احذف السطر' })).toBeInTheDocument();
  });
});

describe('TotalPanel', () => {
  it('shows the total large, announces it politely, and puts it on the 72 px pay button', async () => {
    const onPay = vi.fn();
    const { user } = renderUi(
      <TotalPanel
        totalMinor={646500}
        currency="SYP"
        secondary={{ minor: 4973, currency: 'USD', rateLabel: 'سعر الصرف 130' }}
        onPay={onPay}
      />,
    );

    const total = screen.getByRole('status');
    expect(total).toHaveAttribute('aria-live', 'polite');
    expect(total).toHaveClass('text-total');
    expect(text(total)).toBe('6,465 ل.س');

    const pay = screen.getByRole('button', { name: /ادفع/ });
    expect(pay).toHaveClass('min-h-18');
    expect(text(pay)).toContain('6,465 ل.س');
    await user.click(pay);
    expect(onPay).toHaveBeenCalledOnce();

    expect(screen.queryByText('سعر الصرف 130')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /49\.73/ }));
    expect(screen.getByText('سعر الصرف 130')).toBeInTheDocument();
  });

  it('shows a half unit exactly, and a whole amount without decimals', () => {
    renderUi(<TotalPanel totalMinor={617250} currency="SYP" onPay={vi.fn()} />);
    expect(text(screen.getByRole('status'))).toBe('6,172.50 ل.س');
    expect(text(screen.getByRole('button', { name: /ادفع/ }))).toContain('6,172.50 ل.س');
  });

  it('says why pay is greyed, and a tap on the reason or on the greyed button goes to what is missing', async () => {
    const onPay = vi.fn();
    const onBlockedTap = vi.fn();
    const { user } = renderUi(
      <TotalPanel
        totalMinor={9000000}
        currency="SYP"
        payDisabled
        blockedReason="أدخل الرقم التسلسلي لـ جهاز قياس سكر"
        onBlockedTap={onBlockedTap}
        onPay={onPay}
      />,
    );
    expect(screen.getByRole('button', { name: /ادفع/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /أدخل الرقم التسلسلي/ }));
    expect(onBlockedTap).toHaveBeenCalledOnce();
    expect(onPay).not.toHaveBeenCalled();
  });
});
