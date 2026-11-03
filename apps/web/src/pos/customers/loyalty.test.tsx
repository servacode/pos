import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A point per 1,000, worth 10; Abu Khaled has 12 points (120) */
function loyalSets() {
  const sets = posSets();
  sets.settings = sets.settings.map((s) => ({
    ...s,
    loyalty: { earnEveryMinor: 100_000, pointValueMinor: 1_000 },
  }));
  sets.customers = sets.customers.map((c) => (c.id === ids.abuKhaled ? { ...c, loyaltyPoints: 12 } : c));
  return sets;
}

describe('«نقاط» at payment (03 › الألبسة: نقاط الولاء)', () => {
  it('spends a picked customer’s points at their value, up to what they are worth, and the rest in cash', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local, sets: loyalSets() });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).queryByRole('button', { name: /نقاط/ })).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.type(within(pay).getByLabelText('ابحث بالاسم أو الجوال'), 'خالد');
    await user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
    await user.click(within(pay).getByRole('button', { name: 'قسّم الدفع' }));
    await user.click(within(pay).getByRole('button', { name: 'نقاط (12)' }));
    expect(within(pay).getByRole('status', { name: 'نقاط الزبون' })).toHaveTextContent('120');
    await user.click(within(pay).getByRole('button', { name: 'أضف الجزء' }));
    await user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
    await user.keyboard('130{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.customerId).toBe(ids.abuKhaled);
    expect(sale.payments).toEqual([
      expect.objectContaining({ method: 'points', amountMinor: 12_000 }),
      expect.objectContaining({ method: 'cash', amountMinor: 13_000 }),
    ]);
  });
});
