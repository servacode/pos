import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { memoryLocal, type LocalStore } from '../offline/local';
import type { CatalogSets } from '../pos/catalog';
import { PosSession } from '../pos/PosApp';
import { saveWith, type PosServices } from '../pos/services';
import { ids, linkedDevice, memoryStore, PINS, posSets, staffServer } from './pos';
// Loaded up front so no test waits on a lazy chunk.
import '../pos/CashierApp';
import '../pos/staff/StaffSignIn';
import '../pos/pay/PaymentPanel';
import '../pos/shift/ShiftScreens';

export interface RenderPosOptions {
  sets?: CatalogSets;
  online?: boolean;
  local?: LocalStore;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The cashier screens over an in-memory sync store and local state (no IndexedDB, no network). */
export function renderPos(options: RenderPosOptions = {}) {
  const sets = options.sets ?? posSets();
  const { store, outbox } = memoryStore(linkedDevice, sets);
  const local = options.local ?? memoryLocal();
  let online = options.online ?? true;
  const fetchFn = options.fetch ?? (staffServer(sets) as unknown as typeof fetch);
  const now = options.now ?? Date.now;
  const services: PosServices = {
    store,
    local,
    device: linkedDevice,
    save: saveWith(store, null, now),
    online: () => online,
    now,
    sync: null,
    fetch: fetchFn,
  };
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter>
      <PosSession services={services} persisted={true} />
    </MemoryRouter>,
  );
  return {
    user,
    view,
    store,
    outbox,
    local,
    services,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

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
  await catalogueReady(options.sets ?? posSets());
  return pos;
}

/**
 * The sale screen with its catalogue in: the tiles fill from the device's database after the screen shows, and
 * a code scanned before then reads as unknown (a lost scan the test did not mean to test).
 */
export async function catalogueReady(sets: CatalogSets = posSets()) {
  const tiles = await screen.findByRole('list', { name: 'الأصناف' });
  if (sets.products.length === 0) return;
  await waitFor(() => expect(within(tiles).queryAllByRole('button').length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

/** What a scanner does: the whole code fast, then Enter, wherever the focus is. */
export async function scan(_user: ReturnType<typeof renderPos>['user'], code: string) {
  // On the sale screen, a scan before the catalogue is in reads as unknown: wait for the first tile (a test whose
  // catalogue is empty on purpose goes on after the wait)
  const tiles = screen.queryByRole('list', { name: 'الأصناف' });
  if (tiles && within(tiles).queryAllByRole('button').length === 0) {
    await waitFor(() => expect(within(tiles).queryAllByRole('button').length).toBeGreaterThan(0), {
      timeout: 5_000,
    }).catch(() => undefined);
  }
  (document.activeElement as HTMLElement | null)?.blur();
  // Every key in one go, as a scanner sends them: typed key by key, a busy test machine can pause past the
  // scanner's gap and the code starts over (a lost scan the test did not mean to test).
  await act(async () => {
    for (const key of [...code, 'Enter']) fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
}
