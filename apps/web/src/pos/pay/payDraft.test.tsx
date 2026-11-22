import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { PINS, posSets, PRODUCTS, staffServer, ids } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

/** The pay screen never posts anything but what the cashier chose, even when it opens again (a reload, a rebuilt screen). */

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

async function signIn(local = memoryLocal()) {
  await openShift(local);
  const sets = posSets();
  const pos = renderPos({ local, sets, fetch: staffServer(sets) });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  return { ...pos, local };
}

/** A reload within the idle window: the same device storage, and the cashier is back in without a code */
function reload(local: ReturnType<typeof memoryLocal>) {
  const sets = posSets();
  return { ...renderPos({ local, sets, fetch: staffServer(sets) }), local };
}

describe('the pay screen keeps the cashier’s split parts', () => {
  it('brings the parts back after a reload, and posts them, dollars included, not the whole invoice as cash', async () => {
    const first = await signIn();
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(first.user, PRODUCTS.oil.barcode!.code);
    await first.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await first.user.click(within(pay).getByRole('button', { name: 'قسّم الدفع' }));
    // 10 in pounds, then 1 dollar
    await first.user.click(within(pay).getByRole('button', { name: '1' }));
    await first.user.click(within(pay).getByRole('button', { name: '0' }));
    await first.user.click(within(pay).getByRole('button', { name: /أضف الجزء/ }));
    await first.user.click(within(pay).getByRole('button', { name: /نقد بالدولار/ }));
    await first.user.click(within(pay).getByRole('button', { name: '1' }));
    await first.user.click(within(pay).getByRole('button', { name: /أضف الجزء/ }));
    const before = within(pay).getByRole('list', { name: 'الأجزاء المدفوعة' });
    expect(within(before).getAllByRole('listitem')).toHaveLength(2);
    await vi.waitFor(async () => expect(await first.local.get('pay-draft')).not.toBeNull());

    // The till reloads: a new screen on the same device storage; the pay screen reopens by itself
    cleanup();
    const again = reload(first.local);
    const pay2 = await screen.findByRole('region', { name: 'الدفع' });
    const parts = await within(pay2).findByRole('list', { name: 'الأجزاء المدفوعة' });
    expect(within(parts).getAllByRole('listitem')).toHaveLength(2);
    expect(plain(parts)).toContain('$');
    // The rest, in pounds, completes it
    await again.user.click(within(pay2).getByRole('button', { name: /نقد بالليرة/ }));
    for (const d of ['2', '0', '0']) await again.user.click(within(pay2).getByRole('button', { name: d }));
    await again.user.click(within(pay2).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = again.outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.payments.map((p) => p.currency)).toEqual(['SYP', 'USD', 'SYP']);
    expect(sale.payments.map((p) => p.amountMinor)).toEqual([1000, 100, 20000]);
    expect(await again.local.get('pay-draft')).toBeNull();
  });
});
