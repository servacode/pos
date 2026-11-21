import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('«أتمّ الدفع» when it is not ready', () => {
  it('says what it waits for beside the button, and says nothing once it is ready', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'قسّم الدفع' }));
    const done = within(pay).getByRole('button', { name: /أتمّ الدفع/ });
    expect(done).toBeDisabled();
    expect(within(pay).getByText(/أدخل المبلغ المدفوع|المبلغ لا يغطي الفاتورة/)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: 'دفعة واحدة' }));
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    expect(within(pay).queryByText(/أدخل المبلغ المدفوع|المبلغ لا يغطي الفاتورة/)).toBeNull();
  });
});
