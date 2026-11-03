import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { ids, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/** «البائع» (03 › الملابس: عمولة البائع): the seller of the sale, the cashier unless another is picked. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function pay(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

describe('the seller', () => {
  it('is the cashier by default, and the one picked for the next sales', async () => {
    const { user, outbox } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await pay(user);
    await user.selectOptions(screen.getByLabelText('البائع'), ids.maryam);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await pay(user);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await pay(user);
    const sellers = outbox
      .filter((e) => e.type === 'sale')
      .map((e) => (e.doc.payload as unknown as SalePayload).salespersonId);
    expect(sellers).toEqual([null, ids.maryam, ids.maryam]);
  });
});
