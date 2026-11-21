import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('«استبدال / مرتجع» from an invoice in the admin: /pos?return=<number>', () => {
  it('opens the till on the return screen with the invoice number already typed, once', async () => {
    window.history.replaceState(null, '', '/pos?return=INV-001-002-0000001');
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);

    expect(await screen.findByRole('heading', { name: 'مرتجع' })).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الفاتورة')).toHaveValue('INV-001-002-0000001');
    // The address is clean, so a reload does not open the return again
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});
