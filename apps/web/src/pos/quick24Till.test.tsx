import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, PRODUCTS, posSets } from '../test/pos';
import { saleScreen, scan } from '../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The catalog with the store's till settings (and extra rights for the cashier role). */
function setsWith(till: Record<string, unknown>, extra: string[] = []) {
  const sets = posSets();
  return {
    ...sets,
    settings: [
      { ...sets.settings[0]!, till: { returnWindowDays: null, cardApprovalRequired: false, ...till } },
    ],
    roles: sets.roles.map((r) =>
      r.id === ids.cashierRole ? { ...r, permissions: [...r.permissions, ...extra] } : r,
    ),
  } as ReturnType<typeof posSets>;
}

describe('unknown barcode: add the product', () => {
  it('offers the new-product form with the code to a user who manages the catalog', async () => {
    const { user } = await saleScreen({ sets: setsWith({}, ['catalog.manage']) });
    await scan(user, '9999999999999');
    const link = within(screen.getByRole('alert')).getByRole('link', { name: 'أضف الصنف' });
    expect(link).toHaveAttribute('href', '/products/new?barcode=9999999999999');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('offers nothing to a cashier without that right', async () => {
    const { user } = await saleScreen();
    await scan(user, '9999999999999');
    expect(within(screen.getByRole('alert')).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('«قفل الكاشير»', () => {
  it('asks a manager’s code before the cashier leaves the sale screen', async () => {
    const { user } = await saleScreen({ sets: setsWith({ cashierLock: true }) });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'الطابعة' }));
    const dialog = await screen.findByRole('dialog', { name: 'رمز المدير' });
    expect(within(dialog).getByText(/مقفل على شاشة البيع/)).toBeInTheDocument();
    // Still on the sale screen
    expect(screen.getByRole('list', { name: 'الأصناف', hidden: true })).toBeInTheDocument();
  });

  it('lets the cashier go where she wants when the lock is off', async () => {
    const { user } = await saleScreen({ sets: setsWith({ cashierLock: false }) });
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'الطابعة' }));
    expect(screen.queryByRole('dialog', { name: 'رمز المدير' })).not.toBeInTheDocument();
  });
});

describe('locking the screen with documents still unsent', () => {
  async function sellOne(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('1000{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
  }

  it('asks a manager’s code while offline, and says how many are waiting', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { user } = await saleScreen();
    await sellOne(user);
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: /اقفل الشاشة/ }));
    const dialog = await screen.findByRole('dialog', { name: 'رمز المدير' });
    expect(within(dialog).getByText(/لم يُرسل \d+ مستنداً بعد/)).toBeInTheDocument();
  });

  it('just locks while online (the documents leave within seconds)', async () => {
    const { user } = await saleScreen();
    await sellOne(user);
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: /اقفل الشاشة/ }));
    expect(screen.queryByRole('dialog', { name: 'رمز المدير' })).not.toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'الموظفون' })).toBeInTheDocument();
  });
});
