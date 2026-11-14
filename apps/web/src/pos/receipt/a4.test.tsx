import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

/** The A4 invoice and delivery note from the till's «تمت البيعة» screen. */

/** The A4 sheet as it stood when the print dialog opened (it leaves the page right after) */
let sheet = '';
beforeEach(() => {
  sheet = '';
  vi.spyOn(window, 'print').mockImplementation(() => {
    sheet = stripBidiControls(document.querySelector('[data-print-sheet="A4"]')?.textContent ?? '');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function sold() {
  const local = memoryLocal();
  await openShift(local);
  const pos = renderPos({ local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(pos.user, PRODUCTS.sugar.barcode!.code);
  await pos.user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await pos.user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
  await pos.user.keyboard('790{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
  // The receipt printed by itself when the sale was saved: only what follows counts
  await waitFor(() => expect(window.print).toHaveBeenCalled());
  vi.mocked(window.print).mockClear();
  sheet = '';
  return pos;
}

describe('A4 from the finished sale', () => {
  it('prints a tax invoice with the store’s tax number, the customer block, payment terms, signatures and a stamp area', async () => {
    const { user } = await sold();
    await user.click(screen.getByRole('button', { name: 'اطبع A4' }));
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    for (const part of [
      'فاتورة ضريبية',
      'سوبرماركت الفرات',
      '41875520',
      'INV-001-002-',
      'سكر أبيض 1 كغ',
      'شروط الدفع',
      'نقداً',
      'سلّمها',
      'استلمها',
      'مكان الختم',
    ]) {
      expect(sheet).toContain(part);
    }
    // Not a reprint: no «نسخة» mark on the original
    expect(sheet).not.toContain('نسخة');
    // The sheet leaves the page once printed
    await waitFor(() => expect(document.querySelector('[data-print-sheet="A4"]')).toBeNull());
  });

  it('prints the delivery note without prices', async () => {
    const { user } = await sold();
    await user.click(screen.getByRole('button', { name: 'إشعار تسليم' }));
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    expect(sheet).toContain('إشعار تسليم');
    expect(sheet).toContain('سكر أبيض 1 كغ');
    expect(sheet).toContain('المستلم');
    expect(sheet).not.toContain('المجموع');
  });
});
